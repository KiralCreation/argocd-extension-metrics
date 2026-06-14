package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/argoproj-labs/argocd-metric-ext-server/internal/logging"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type MockO11yServer struct {
}

func (ms MockO11yServer) init() error {
	return errors.New("")
}
func (ms MockO11yServer) execute(ctx *gin.Context) {

}

func (ms MockO11yServer) getDashboard(ctx *gin.Context) {

}
func (ms MockO11yServer) getType() string {
	return "test"
}

func TestQueryMetrics(t *testing.T) {
	invalidTests := []struct {
		testName       string
		header         map[string][]string
		params         map[string]string
		queryParams    map[string]string
		expectedResult int
	}{
		{testName: "Header Argocd-Application-Name not sent",
			header:         map[string][]string{"Argocd-Project-Name": []string{"test"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test", "project": "default"},
			expectedResult: 400,
		},
		{testName: "Header Argocd-Application-Name multiple values sent",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test", "argo:test"}, "Argocd-Project-Name": []string{"default"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test", "project": "default"},
			expectedResult: 400,
		},
		{testName: "QueryParam application_name not sent",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}, "Argocd-Project-Name": []string{"default"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"project": "default"},
			expectedResult: 400,
		},
		{testName: "QueryParam project not sent",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}, "Argocd-Project-Name": []string{"default"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test"},
			expectedResult: 400,
		},
		{testName: "Application name mismatch. Value from the header is different from the query param application_name.",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test1"}, "Argocd-Project-Name": []string{"default"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test", "project": "default"},
			expectedResult: 400,
		},
		{testName: "Project name mismatch. Value from the header is different from the query param project.",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}, "Argocd-Project-Name": []string{"defaults"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test", "project": "default"},
			expectedResult: 400,
		},
	}
	//test invalid scenarios
	for _, invalidTest := range invalidTests {
		invalidTest := invalidTest
		t.Run(invalidTest.testName, func(t *testing.T) {
			w := httptest.NewRecorder()
			ctx, ms := createContextAndNewO11yServer(w)
			MockJsonGet(ctx, invalidTest.header, invalidTest.params, invalidTest.queryParams)
			ms.queryMetrics(ctx)
			assert.EqualValues(t, invalidTest.expectedResult, w.Code)
		})
	}

	validTests := []struct {
		testName       string
		header         map[string][]string
		params         map[string]string
		queryParams    map[string]string
		expectedResult int
	}{
		{testName: "All the headers and query params sent and are matched successfully",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}, "Argocd-Project-Name": []string{"default"}},
			params:         map[string]string{},
			queryParams:    map[string]string{"application_name": "test", "project": "default"},
			expectedResult: 200,
		},
	}
	for _, validTest := range validTests {
		validTest := validTest
		t.Run(validTest.testName, func(t *testing.T) {
			w := httptest.NewRecorder()
			ctx, ms := createContextAndNewO11yServer(w)
			MockJsonGet(ctx, validTest.header, validTest.params, validTest.queryParams)
			ms.queryMetrics(ctx)
			assert.EqualValues(t, validTest.expectedResult, w.Code)
		})
	}
}

func createContextAndNewO11yServer(w *httptest.ResponseRecorder) (ctx *gin.Context, ms O11yServer) {
	var port int
	var enableTLS bool
	logger := logging.NewLogger().Named("metric-sever")
	ms = NewO11yServer(logger, port, enableTLS, "app/config.json", "", "")
	var temp MetricsProvider = MockO11yServer{}
	ms.provider = temp
	ctx = GetTestGinContext(w)
	return ctx, ms
}

func TestDashboardConfig(t *testing.T) {
	invalidTests := []struct {
		testName       string
		header         map[string][]string
		params         map[string]string
		queryParams    map[string]string
		expectedResult int
	}{
		{testName: "Header Argocd-Application-Name not sent",
			header:         map[string][]string{"Argocd-Project-Name": []string{"test"}},
			params:         map[string]string{"application": "test"},
			queryParams:    map[string]string{},
			expectedResult: 400,
		},
		{testName: "Header Argocd-Application-Name multiple values sent",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test", "argo:test"}},
			params:         map[string]string{"application": "test"},
			queryParams:    map[string]string{},
			expectedResult: 400,
		},
		{testName: "PathParam application not sent",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}},
			params:         map[string]string{},
			queryParams:    map[string]string{},
			expectedResult: 400,
		},
		{testName: "Application name mismatch. Value from the header is different from the path param application.",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test1"}},
			params:         map[string]string{"application": "test"},
			queryParams:    map[string]string{},
			expectedResult: 400,
		},
	}
	//test invalid scenarios
	for _, invalidTest := range invalidTests {
		invalidTest := invalidTest
		t.Run(invalidTest.testName, func(t *testing.T) {
			w := httptest.NewRecorder()
			ctx, ms := createContextAndNewO11yServer(w)
			MockJsonGet(ctx, invalidTest.header, invalidTest.params, invalidTest.queryParams)
			ms.dashboardConfig(ctx)
			assert.EqualValues(t, invalidTest.expectedResult, w.Code)
		})
	}

	validTests := []struct {
		testName       string
		header         map[string][]string
		params         map[string]string
		queryParams    map[string]string
		expectedResult int
	}{
		{testName: "All Headers and path params are sent and are matched successfully",
			header:         map[string][]string{"Argocd-Application-Name": []string{"argo:test"}},
			params:         map[string]string{"application": "test"},
			queryParams:    map[string]string{},
			expectedResult: 200,
		},
	}
	for _, validTest := range validTests {
		validTest := validTest
		t.Run(validTest.testName, func(t *testing.T) {
			w := httptest.NewRecorder()
			ctx, ms := createContextAndNewO11yServer(w)
			MockJsonGet(ctx, validTest.header, validTest.params, validTest.queryParams)
			ms.dashboardConfig(ctx)
			assert.EqualValues(t, validTest.expectedResult, w.Code)
		})
	}
}

// mock gin context
func GetTestGinContext(w *httptest.ResponseRecorder) *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = &http.Request{
		Header: make(http.Header),
		URL:    &url.URL{},
	}
	return ctx
}

// mock get request
func MockJsonGet(c *gin.Context, header map[string][]string, pathParams map[string]string, queryParams map[string]string) {
	c.Request.Method = "GET"
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header = header
	for key, value := range pathParams {
		c.AddParam(key, value)
	}
	temp := url.Values{}
	for key, value := range queryParams {
		temp.Add(key, value)
	}
	c.Request.URL.RawQuery = temp.Encode()
}

func TestQueryMetricsInvalidApplicationHeaderFormat(t *testing.T) {
	w := httptest.NewRecorder()
	ctx, ms := createContextAndNewO11yServer(w)
	MockJsonGet(ctx, map[string][]string{
		"Argocd-Application-Name": []string{"test"},
		"Argocd-Project-Name":     []string{"default"},
	}, map[string]string{}, map[string]string{
		"application_name": "test",
		"project":          "default",
	})
	ms.queryMetrics(ctx)
	assert.EqualValues(t, http.StatusBadRequest, w.Code)
}

func TestQueryMetricsRateLimitPerApplication(t *testing.T) {
	headers := map[string][]string{
		"Argocd-Application-Name": []string{"argo:test"},
		"Argocd-Project-Name":     []string{"default"},
	}
	queryParams := map[string]string{
		"application_name": "test",
		"project":          "default",
	}

	w1 := httptest.NewRecorder()
	ctx1, ms := createContextAndNewO11yServer(w1)
	ms.limiter = newAppRateLimiter(1)
	MockJsonGet(ctx1, headers, map[string]string{}, queryParams)
	ms.queryMetrics(ctx1)
	assert.EqualValues(t, http.StatusOK, w1.Code)

	w2 := httptest.NewRecorder()
	ctx2 := GetTestGinContext(w2)
	MockJsonGet(ctx2, headers, map[string]string{}, queryParams)
	ms.queryMetrics(ctx2)
	assert.EqualValues(t, http.StatusTooManyRequests, w2.Code)
}

func TestQueryMetricsRateLimitIsPerApplication(t *testing.T) {
	ms := NewO11yServer(logging.NewLogger().Named("metric-sever"), 0, false, "app/config.json", "", "")
	ms.provider = MockO11yServer{}
	ms.limiter = newAppRateLimiter(1)

	headersApp1 := map[string][]string{
		"Argocd-Application-Name": {"argo:app-one"},
		"Argocd-Project-Name":     {"default"},
	}
	headersApp2 := map[string][]string{
		"Argocd-Application-Name": {"argo:app-two"},
		"Argocd-Project-Name":     {"default"},
	}

	w1 := httptest.NewRecorder()
	ctx1 := GetTestGinContext(w1)
	MockJsonGet(ctx1, headersApp1, map[string]string{}, map[string]string{
		"application_name": "app-one",
		"project":          "default",
	})
	ms.queryMetrics(ctx1)
	assert.EqualValues(t, http.StatusOK, w1.Code)

	w2 := httptest.NewRecorder()
	ctx2 := GetTestGinContext(w2)
	MockJsonGet(ctx2, headersApp2, map[string]string{}, map[string]string{
		"application_name": "app-two",
		"project":          "default",
	})
	ms.queryMetrics(ctx2)
	assert.EqualValues(t, http.StatusOK, w2.Code)
}

type providerErrorMock struct{}

func (providerErrorMock) init() error { return nil }
func (providerErrorMock) execute(ctx *gin.Context) {
	ctx.JSON(http.StatusBadGateway, gin.H{"error": "upstream query failed"})
}
func (providerErrorMock) getDashboard(ctx *gin.Context) {
	ctx.JSON(http.StatusBadGateway, gin.H{"error": "upstream dashboard failed"})
}
func (providerErrorMock) getType() string { return "error" }

func TestQueryMetricsProviderErrorIsPropagated(t *testing.T) {
	ms := NewO11yServer(logging.NewLogger().Named("metric-sever"), 0, false, "app/config.json", "", "")
	ms.provider = providerErrorMock{}

	w := httptest.NewRecorder()
	ctx := GetTestGinContext(w)
	MockJsonGet(ctx, map[string][]string{
		"Argocd-Application-Name": {"argo:test"},
		"Argocd-Project-Name":     {"default"},
	}, map[string]string{}, map[string]string{
		"application_name": "test",
		"project":          "default",
	})
	ms.queryMetrics(ctx)
	assert.EqualValues(t, http.StatusBadGateway, w.Code)
	assert.Contains(t, w.Body.String(), "upstream query failed")
}
