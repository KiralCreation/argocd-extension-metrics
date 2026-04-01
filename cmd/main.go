package main

import (
	"context"
	"flag"

	"github.com/argoproj-labs/argocd-metric-ext-server/internal/logging"
	"github.com/argoproj-labs/argocd-metric-ext-server/internal/server"
)

func main() {
	var port int
	var enableTLS bool
	var configPath string
	flag.IntVar(&port, "port", 9003, "Listening Port")
	flag.BoolVar(&enableTLS, "enableTLS", true, "Run server with TLS (default true)")
	flag.StringVar(&configPath, "config", "app/config.json", "Path to config file")
	flag.Parse()
	logger := logging.NewLogger().Named("metric-sever")
	ctx := context.Background()

	metricsServer := server.NewO11yServer(logger, port, enableTLS, configPath)
	if err := metricsServer.Run(ctx); err != nil {
		logger.Fatalf("server error: %v", err)
	}
}
