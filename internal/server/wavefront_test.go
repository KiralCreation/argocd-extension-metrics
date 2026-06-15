package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	wavefront "github.com/WavefrontHQ/go-wavefront-management-api"
	"github.com/argoproj-labs/argocd-metric-ext-server/internal/logging"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testWavefrontConfig(includeThreshold bool) *MetricsConfigProvider {
	graph := &Graph{
		Name:            "cpu",
		MetricName:      "pod",
		QueryExpression: "ts(main)",
	}
	if includeThreshold {
		graph.Thresholds = []Threshold{
			{
				Name:            "critical",
				Key:             "critical",
				Color:           "red",
				Value:           "ts(threshold)",
				Unit:            "ms",
				QueryExpression: "",
			},
		}
	}
	return &MetricsConfigProvider{
		Applications: []Application{
			{
				Name:    "my-app",
				Default: true,
				Dashboards: []*Dashboard{
					{
						GroupKind: "deployment",
						Rows: []*Row{
							{
								Name: "workload",
								Graphs: []*Graph{
									graph,
								},
							},
						},
					},
				},
			},
		},
	}
}

func wavefrontProviderForTest(config *MetricsConfigProvider) *WaveFrontProvider {
	logger := logging.NewLogger().Named("wavefront-test")
	return NewWavefrontProvider(config, "token", logger)
}

func mockWavefrontResponse(label string, groupBy string) *wavefront.QueryResponse {
	return &wavefront.QueryResponse{
		Query:       "raw-query",
		Name:        label,
		Granularity: 60,
		TimeSeries: []wavefront.TimeSeries{
			{
				Label: label,
				Tags: map[string]string{
					groupBy: label,
				},
				DataPoints: []wavefront.DataPoint{
					{1710000000, 0.2},
					{1710000060, 0.3},
				},
			},
		},
	}
}

func TestWavefrontExecuteReturnsDataAndThresholds(t *testing.T) {
	w := httptest.NewRecorder()
	ctx := GetTestGinContext(w)
	MockJsonGet(ctx, map[string][]string{}, map[string]string{
		"application": "my-app",
		"groupkind":   "deployment",
		"row":         "workload",
		"graph":       "cpu",
	}, map[string]string{
		"name":      "my-app.*",
		"namespace": "default",
		"duration":  "1h",
	})

	wf := wavefrontProviderForTest(testWavefrontConfig(true))
	wf.queryFn = func(queryExpression string, env map[string][]string, duration time.Duration, wf *WaveFrontProvider) (*wavefront.QueryResponse, error) {
		if queryExpression == "ts(main)" {
			return mockWavefrontResponse("main", "pod"), nil
		}
		return mockWavefrontResponse("critical", "pod"), nil
	}

	wf.execute(ctx)
	require.Equal(t, http.StatusOK, w.Code)

	var resp AggregatedResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.NotEmpty(t, resp.Data)
	require.Len(t, resp.Thresholds, 1)
	assert.Equal(t, "critical", resp.Thresholds[0].Name)
	assert.Equal(t, "critical", resp.Thresholds[0].Key)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	_, hasData := body["data"]
	_, hasThresholds := body["thresholds"]
	assert.True(t, hasData)
	assert.True(t, hasThresholds)
}

func TestWavefrontExecuteReturnsDataWithoutThresholds(t *testing.T) {
	w := httptest.NewRecorder()
	ctx := GetTestGinContext(w)
	MockJsonGet(ctx, map[string][]string{}, map[string]string{
		"application": "my-app",
		"groupkind":   "deployment",
		"row":         "workload",
		"graph":       "cpu",
	}, map[string]string{
		"duration": "1h",
	})

	wf := wavefrontProviderForTest(testWavefrontConfig(false))
	wf.queryFn = func(queryExpression string, env map[string][]string, duration time.Duration, wf *WaveFrontProvider) (*wavefront.QueryResponse, error) {
		return mockWavefrontResponse("main", "pod"), nil
	}

	wf.execute(ctx)
	require.Equal(t, http.StatusOK, w.Code)

	var resp AggregatedResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.Data)
	assert.Len(t, resp.Thresholds, 0)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	_, hasData := body["data"]
	_, hasThresholds := body["thresholds"]
	assert.True(t, hasData)
	assert.False(t, hasThresholds)
}

func TestWavefrontExecuteInvalidDuration(t *testing.T) {
	w := httptest.NewRecorder()
	ctx := GetTestGinContext(w)
	MockJsonGet(ctx, map[string][]string{}, map[string]string{
		"application": "my-app",
		"groupkind":   "deployment",
		"row":         "workload",
		"graph":       "cpu",
	}, map[string]string{
		"duration": "bad",
	})

	wf := wavefrontProviderForTest(testWavefrontConfig(false))
	wf.execute(ctx)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
