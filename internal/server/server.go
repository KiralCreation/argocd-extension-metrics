package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	tls2 "github.com/argoproj-labs/argocd-metric-ext-server/internal/tls"
)

const PROMETHEUS_TYPE = "prometheus"
const WAVEFRONT_TYPE = "wavefront"

type O11yServer struct {
	logger      *zap.SugaredLogger
	config      O11yConfig
	provider    MetricsProvider
	port        int
	enableTLS   bool
	configPath  string
	tlsCertFile string
	tlsKeyFile  string
	limiter     *appRateLimiter
}

type MetricsProvider interface {
	init() error
	execute(ctx *gin.Context)
	getDashboard(ctx *gin.Context)
	getType() string
}

func validateHeader(header http.Header, headerName string) error {
	val, ok := header[headerName]
	if !ok {
		errMsg := headerName + " header not sent"
		return errors.New(errMsg)
	}
	if len(val) != 1 {
		errMsg := "Multiple values for " + headerName + " header sent. Only one is allowed"
		return errors.New(errMsg)
	}
	return nil
}

func validateQueryParam(queryParam string, queryParamName string) error {
	if len(queryParam) == 0 {
		errMsg := queryParamName + " query param not sent"
		return errors.New(errMsg)
	}
	return nil
}

func validatePathParam(pathParam string, pathParamName string) error {
	if len(pathParam) == 0 {
		errMsg := pathParamName + " path param not sent"
		return errors.New(errMsg)
	}
	return nil
}

type appRateCounter struct {
	windowStart time.Time
	count       int
}

type appRateLimiter struct {
	perMinute int
	mu        sync.Mutex
	counters  map[string]*appRateCounter
}

func newAppRateLimiter(perMinute int) *appRateLimiter {
	if perMinute <= 0 {
		return nil
	}
	return &appRateLimiter{
		perMinute: perMinute,
		counters:  make(map[string]*appRateCounter),
	}
}

func (l *appRateLimiter) allow(application string, now time.Time) bool {
	if l == nil {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	counter, found := l.counters[application]
	if !found || now.Sub(counter.windowStart) >= time.Minute {
		l.counters[application] = &appRateCounter{windowStart: now, count: 1}
		return true
	}
	if counter.count >= l.perMinute {
		return false
	}
	counter.count++
	return true
}

func NewO11yServer(logger *zap.SugaredLogger, port int, enableTLS bool, configPath string, tlsCertFile string, tlsKeyFile string) O11yServer {
	return O11yServer{
		logger:      logger,
		port:        port,
		enableTLS:   enableTLS,
		configPath:  configPath,
		tlsCertFile: tlsCertFile,
		tlsKeyFile:  tlsKeyFile,
	}
}
func (ms *O11yServer) Run(ctx context.Context) error {

	if err := ms.readConfig(); err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if ms.config.Server != nil {
		ms.limiter = newAppRateLimiter(ms.config.Server.QueryRateLimitPerAppPerMinute)
	}
	if ms.config.Prometheus != nil {
		ms.provider = NewPrometheusProvider(ms.config.Prometheus, ms.logger)
		err := ms.provider.init()
		if err != nil {
			ms.logger.Fatalf("prometheus provider init: %v", err)
		}
	} else if ms.config.Wavefront != nil {
		token, found := os.LookupEnv("WAVEFRONT_TOKEN")
		if !found {
			ms.logger.Fatal("WAVEFRONT_TOKEN env not set")
		}
		ms.provider = NewWavefrontProvider(ms.config.Wavefront, token, ms.logger)
		err := ms.provider.init()
		if err != nil {
			ms.logger.Fatalf("wavefront provider init: %v", err)
		}
	}
	handler := gin.Default()
	handler.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "healthy")
	})
	handler.GET("/healthz", func(c *gin.Context) {
		c.String(http.StatusOK, "healthy")
	})
	handler.GET("/api/applications/:application/groupkinds/:groupkind/rows/:row/graphs/:graph", ms.queryMetrics)

	handler.GET("/api/applications/:application/groupkinds/:groupkind/dashboards", ms.dashboardConfig)

	address := fmt.Sprintf(":%d", ms.port)
	ms.logger.Infof("Server Configs: [address: %s, enableTLS: %t]", address, ms.enableTLS)
	if ms.enableTLS {
		return ms.runWithTLS(address, handler)
	}
	ms.run(address, handler)
	return nil
}
func (ms *O11yServer) run(address string, handler *gin.Engine) {
	ms.logger.Infof("Starting Argo Metrics Server.. %s", address)
	server := http.Server{
		Addr:    address,
		Handler: handler,
	}
	if err := server.ListenAndServe(); err != nil {
		ms.logger.Fatal(err)
	}
}

func (ms *O11yServer) runWithTLS(address string, handler *gin.Engine) error {
	ms.logger.Infof("Starting Argo Metrics Server with TLS.. %s", address)
	var cert tls.Certificate
	var err error
	if ms.tlsCertFile != "" || ms.tlsKeyFile != "" {
		if ms.tlsCertFile == "" || ms.tlsKeyFile == "" {
			return errors.New("both tls cert and key file must be provided")
		}
		cert, err = tls.LoadX509KeyPair(ms.tlsCertFile, ms.tlsKeyFile)
		if err != nil {
			return fmt.Errorf("loading TLS certificate files: %w", err)
		}
	} else {
		selfSignedCert, err := tls2.GenerateX509KeyPair()
		if err != nil {
			return fmt.Errorf("generating TLS certificate: %w", err)
		}
		cert = *selfSignedCert
	}
	server := http.Server{
		Addr:      address,
		Handler:   handler,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
	}
	if err := server.ListenAndServeTLS("", ""); err != nil {
		ms.logger.Fatal(err)
	}
	return nil
}

func parseApplicationHeaderValue(headerValue string) (string, error) {
	parts := strings.SplitN(headerValue, ":", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return "", errors.New("invalid Argocd-Application-Name header format")
	}
	return strings.TrimSpace(parts[1]), nil
}

func (ms *O11yServer) queryMetrics(ctx *gin.Context) {
	headers := ctx.Request.Header

	if err := validateHeader(headers, "Argocd-Application-Name"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}
	val := headers["Argocd-Application-Name"]
	applicationNameHeader, err := parseApplicationHeaderValue(val[0])
	if err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if err := validateHeader(headers, "Argocd-Project-Name"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}
	temp := headers["Argocd-Project-Name"]
	projectHeader := temp[0]

	applicationNameQueryParam := ctx.Query("application_name")

	if err := validateQueryParam(applicationNameQueryParam, "application_name"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	projectQueryParam := ctx.Query("project")

	if err := validateQueryParam(projectQueryParam, "project"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if applicationNameHeader != applicationNameQueryParam {
		msg := "application name mismatch: value from the header is different from the url"
		err := errors.New(msg)
		ms.logger.Warn(msg)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if projectHeader != projectQueryParam {
		msg := "project mismatch: value from the header is different from the url"
		err := errors.New(msg)
		ms.logger.Warn(msg)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if !ms.limiter.allow(applicationNameQueryParam, time.Now()) {
		ctx.JSON(http.StatusTooManyRequests, gin.H{"error": "query rate limit exceeded for application"})
		return
	}
	ms.provider.execute(ctx)
}

func (ms *O11yServer) dashboardConfig(ctx *gin.Context) {
	headers := ctx.Request.Header

	if err := validateHeader(headers, "Argocd-Application-Name"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	val := headers["Argocd-Application-Name"]
	applicationNameHeader, err := parseApplicationHeaderValue(val[0])
	if err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}

	applicationNamePathParam := ctx.Param("application")

	if err := validatePathParam(applicationNamePathParam, "application"); err != nil {
		ms.logger.Warn(err)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if applicationNameHeader != applicationNamePathParam {
		msg := "application name mismatch: value from the header is different from the url"
		err := errors.New(msg)
		ms.logger.Warn(msg)
		ctx.JSON(400, gin.H{"error": err.Error()})
		return
	}
	ms.provider.getDashboard(ctx)
}

func (ms *O11yServer) readConfig() error {
	yamlFile, err := os.ReadFile(ms.configPath)
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}
	if err = json.Unmarshal(yamlFile, &ms.config); err != nil {
		return fmt.Errorf("unmarshaling config: %w", err)
	}
	return nil
}
