/* eslint-disable jsx-a11y/anchor-is-valid */
import * as React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";

import ChartWrapper from "./Chart/ChartWrapper";
import "./Metrics.scss";
import { getDashBoard } from "./client";
import type { AllChartDataProps } from "./Chart/types";

type HealthSignal = "latency" | "error" | "traffic";
type HealthStatus = "healthy" | "elevated" | "critical" | "unknown";

const SIGNAL_PRIORITY: HealthSignal[] = ["latency", "error", "traffic"];
const SPARKLINE_POINTS = 12;

const normalizeText = (...values: Array<string | undefined>) =>
  values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const classifyGraphSignal = ({ graph, row }: { graph: any; row: any }): HealthSignal | null => {
  const rawText = normalizeText(
    graph?.name,
    graph?.title,
    graph?.description,
    row?.name,
    row?.title
  );
  if (
    /(latency|duration|p99|p95|p90|p75|p50|response time)/.test(rawText)
  ) {
    return "latency";
  }
  if (/(error|5xx|4xx|fail|failure)/.test(rawText)) {
    return "error";
  }
  if (/(traffic|request|throughput|rps|qps|connection)/.test(rawText)) {
    return "traffic";
  }
  return null;
};

const parseThresholds = (thresholdSeries: any[] = []) => {
  const warning: number[] = [];
  const critical: number[] = [];
  thresholdSeries.forEach((series) => {
    const value = Number(series?.value);
    if (!Number.isFinite(value)) {
      return;
    }
    const key = normalizeText(series?.key, series?.name);
    if (/(crit|red)/.test(key)) {
      critical.push(value);
      return;
    }
    warning.push(value);
  });
  return {
    warning: warning.length ? Math.min(...warning) : null,
    critical: critical.length ? Math.min(...critical) : null,
  };
};

const compactSeries = (values: number[], size = SPARKLINE_POINTS) => {
  if (!values.length) {
    return [];
  }
  const trimmed = values.slice(-size);
  if (trimmed.length <= size) {
    return trimmed;
  }
  return trimmed.slice(trimmed.length - size);
};

const buildSparkline = (seriesValues: number[][]) => {
  if (!seriesValues.length) {
    return [];
  }
  const sums = new Array<number>(SPARKLINE_POINTS).fill(0);
  const counts = new Array<number>(SPARKLINE_POINTS).fill(0);

  seriesValues.forEach((values) => {
    const compacted = compactSeries(values, SPARKLINE_POINTS);
    const offset = SPARKLINE_POINTS - compacted.length;
    compacted.forEach((value, idx) => {
      if (!Number.isFinite(value)) {
        return;
      }
      const targetIdx = idx + offset;
      sums[targetIdx] += value;
      counts[targetIdx] += 1;
    });
  });

  return sums
    .map((sum, idx) => (counts[idx] > 0 ? sum / counts[idx] : null))
    .filter((value): value is number => value !== null);
};

const aggregateSignalValue = (values: number[], signal: HealthSignal) => {
  if (!values.length) {
    return null;
  }
  if (signal === "latency") {
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }
  return values.reduce((acc, value) => acc + value, 0);
};

const evaluateFallbackSeverity = ({
  signal,
  latest,
  average,
}: {
  signal: HealthSignal;
  latest: number;
  average: number;
}): HealthStatus => {
  if (!Number.isFinite(latest)) {
    return "unknown";
  }
  const baseline = average > 0 ? average : latest || 1;
  const ratio = baseline > 0 ? latest / baseline : 1;
  if (signal === "latency") {
    if (latest >= 1 || ratio >= 2) {
      return "critical";
    }
    if (latest >= 0.5 || ratio >= 1.4) {
      return "elevated";
    }
    return "healthy";
  }
  if (signal === "error") {
    if (latest >= 5 || ratio >= 2) {
      return "critical";
    }
    if (latest > 0.5 || ratio >= 1.4) {
      return "elevated";
    }
    return "healthy";
  }
  if (ratio >= 2.5) {
    return "critical";
  }
  if (ratio >= 1.6) {
    return "elevated";
  }
  return "healthy";
};

const evaluateSeverity = ({
  signal,
  latest,
  average,
  warningThreshold,
  criticalThreshold,
}: {
  signal: HealthSignal;
  latest: number;
  average: number;
  warningThreshold: number | null;
  criticalThreshold: number | null;
}): HealthStatus => {
  if (!Number.isFinite(latest)) {
    return "unknown";
  }
  if (criticalThreshold !== null && latest >= criticalThreshold) {
    return "critical";
  }
  if (warningThreshold !== null && latest >= warningThreshold) {
    return "elevated";
  }
  return evaluateFallbackSeverity({ signal, latest, average });
};

const formatSignalValue = (value: number | null, unit: string, signal: HealthSignal) => {
  if (value === null || !Number.isFinite(value)) {
    return "No data";
  }
  const absValue = Math.abs(value);
  let formatted = "";
  if (absValue >= 1000) {
    formatted = `${(value / 1000).toFixed(1)}k`;
  } else if (absValue >= 100) {
    formatted = value.toFixed(0);
  } else if (absValue >= 10) {
    formatted = value.toFixed(1);
  } else {
    formatted = value.toFixed(2);
  }

  if (unit) {
    return `${formatted}${unit}`;
  }
  if (signal === "error") {
    return `${formatted}/s`;
  }
  if (signal === "traffic") {
    return `${formatted}/s`;
  }
  return formatted;
};

const statusRank: Record<HealthStatus, number> = {
  unknown: 0,
  healthy: 1,
  elevated: 2,
  critical: 3,
};

const getGlobalStatus = (statuses: HealthStatus[]): HealthStatus => {
  if (!statuses.length) {
    return "unknown";
  }
  return statuses.reduce((worst, current) =>
    statusRank[current] > statusRank[worst] ? current : worst
  );
};

export const Metrics = ({
  application,
  resource,
  events,
  duration,
  setHasMetrics,
  isLoading,
  setIsLoading,
  setIntervals,
}: any) => {
  const resourceName =
    resource.kind === "Application" ? "" : resource?.metadata?.name;
  const [dashboard, setDashboard] = useState<any>({});
  const [filterChart, setFilterChart] = useState<any>({});
  const [highlight, setHighlight] = useState<any>({});
  const [chartsByQueryPath, setChartsByQueryPath] = useState<Record<string, AllChartDataProps[string]>>({});

  const [selectedTab, setSelectedTab] = useState<string>("");

  const namespace = resource?.metadata?.namespace || "";
  const applicationName = application?.metadata?.name || "";
  const applicationNamespace = application?.metadata?.namespace || "";
  const project = application?.spec?.project || "";
  const uid = application?.metadata?.uid || "";

  useEffect(() => {
    getDashBoard({
      applicationName,
      applicationNamespace,
      resourceType: resource.kind,
      project,
    })
      .then((response) => {
        if (response.status > 399) {
          throw new Error("No metrics");
        }
        return response.json();
      })
      .then((data: any) => {
        setIsLoading(false);
        setHasMetrics(true);
        setDashboard(data);
        setIntervals(data?.intervals || []);
        if (data?.tabs?.length) {
          setSelectedTab(data.tabs[0]);
        }
      })
      .catch((err) => {
        setHasMetrics(false);
        setIsLoading(false);
        console.error("res.data", err);
      });
  }, [applicationName, applicationNamespace, project, resource.kind]);

  const visibleRows = useMemo(() => {
    return (
      dashboard?.rows?.filter(
        (r: any) => !dashboard?.tabs?.length || r?.tab === selectedTab || (!r?.tab && selectedTab === "More")
      ) || []
    );
  }, [dashboard, selectedTab]);

  const visibleGraphs = useMemo(() => {
    return visibleRows.flatMap((row: any) =>
      (row?.graphs || [])
        .filter((graph: any) => graph?.graphType !== "pie")
        .map((graph: any) => {
          const queryPath = `/extensions/metrics/api/applications/${applicationName}/groupkinds/${resource.kind.toLowerCase()}/rows/${row.name}/graphs/${graph.name}?name=${resourceName}.*&namespace=${namespace}&application_name=${applicationName}&project=${project}&uid=${uid}&duration=${duration}`;
          return {
            row,
            graph,
            queryPath,
            signal: classifyGraphSignal({ graph, row }),
          };
        })
    );
  }, [visibleRows, applicationName, resource.kind, resourceName, namespace, project, uid, duration]);

  const handleChartData = useCallback((queryPath: string, chartData: AllChartDataProps[string]) => {
    setChartsByQueryPath((prevData) => ({
      ...prevData,
      [queryPath]: chartData,
    }));
  }, []);

  const summaryBySignal = useMemo(() => {
    const signalState: Record<
      HealthSignal,
      {
        latestValues: number[];
        averageValues: number[];
        sparklineSources: number[][];
        warningThresholds: number[];
        criticalThresholds: number[];
        unit: string;
      }
    > = {
      latency: {
        latestValues: [],
        averageValues: [],
        sparklineSources: [],
        warningThresholds: [],
        criticalThresholds: [],
        unit: "",
      },
      error: {
        latestValues: [],
        averageValues: [],
        sparklineSources: [],
        warningThresholds: [],
        criticalThresholds: [],
        unit: "",
      },
      traffic: {
        latestValues: [],
        averageValues: [],
        sparklineSources: [],
        warningThresholds: [],
        criticalThresholds: [],
        unit: "",
      },
    };

    visibleGraphs.forEach(({ graph, queryPath, signal }) => {
      if (!signal) {
        return;
      }
      const chartData = chartsByQueryPath?.[queryPath];
      if (!chartData?.data?.length) {
        return;
      }

      if (!signalState[signal].unit && graph?.yAxisUnit) {
        signalState[signal].unit = graph.yAxisUnit;
      }

      chartData.data.forEach((series: any) => {
        const numericValues = (series?.data || [])
          .map((point: any) => Number(point?.y))
          .filter((value: number) => Number.isFinite(value));
        if (!numericValues.length) {
          return;
        }
        signalState[signal].latestValues.push(numericValues[numericValues.length - 1]);
        signalState[signal].averageValues.push(
          numericValues.reduce((acc: number, value: number) => acc + value, 0) / numericValues.length
        );
        signalState[signal].sparklineSources.push(compactSeries(numericValues));
      });

      const parsedThresholds = parseThresholds(chartData?.thresholds || []);
      if (parsedThresholds.warning !== null) {
        signalState[signal].warningThresholds.push(parsedThresholds.warning);
      }
      if (parsedThresholds.critical !== null) {
        signalState[signal].criticalThresholds.push(parsedThresholds.critical);
      }
    });

    return SIGNAL_PRIORITY.reduce((acc, signal) => {
      const state = signalState[signal];
      const latest = aggregateSignalValue(state.latestValues, signal);
      const average = aggregateSignalValue(state.averageValues, signal);
      const sparkline = buildSparkline(state.sparklineSources);
      const warningThreshold = state.warningThresholds.length
        ? Math.min(...state.warningThresholds)
        : null;
      const criticalThreshold = state.criticalThresholds.length
        ? Math.min(...state.criticalThresholds)
        : null;
      const status =
        latest === null || average === null
          ? "unknown"
          : evaluateSeverity({
              signal,
              latest,
              average,
              warningThreshold,
              criticalThreshold,
            });
      acc[signal] = {
        signal,
        latest,
        average,
        status,
        sparkline,
        unit: state.unit,
        valueLabel: formatSignalValue(latest, state.unit, signal),
      };
      return acc;
    }, {} as Record<HealthSignal, any>);
  }, [visibleGraphs, chartsByQueryPath]);

  const summaryStatus = useMemo(
    () => getGlobalStatus(SIGNAL_PRIORITY.map((signal) => summaryBySignal[signal]?.status || "unknown")),
    [summaryBySignal]
  );

  const healthSummary = useMemo(() => {
    const totalGraphs = visibleRows.reduce(
      (sum: number, row: any) => sum + (row?.graphs?.length || 0),
      0
    );
    const thresholdGraphs = visibleRows.reduce(
      (sum: number, row: any) =>
        sum +
        (row?.graphs?.filter((graph: any) => (graph?.thresholds || []).length > 0)
          ?.length || 0),
      0
    );
    return {
      rows: visibleRows.length,
      graphs: totalGraphs,
      thresholdGraphs,
      recentEvents: events?.length || 0,
      summaryStatus,
    };
  }, [visibleRows, events, summaryStatus]);

  const signalLabels: Record<HealthSignal, string> = {
    latency: "Latency",
    error: "Errors",
    traffic: "Traffic",
  };

  return (
    <div>
      {dashboard?.rows?.length > 0 && (
        <div className="application-metrics__HealthSummary">
          <div className="application-metrics__HealthSummaryHeader">
            <span className="application-metrics__HealthSummaryTitle">
              Health Summary (last {duration})
            </span>
            <span className={`application-metrics__HealthSummaryStatus application-metrics__HealthSummaryStatus--${healthSummary.summaryStatus}`}>
              {healthSummary.summaryStatus}
            </span>
          </div>
          <div className="application-metrics__HealthSummarySignals">
            {SIGNAL_PRIORITY.map((signal) => (
              <div className="application-metrics__HealthSummaryItem" key={signal}>
                <span className="application-metrics__HealthSummaryLabel">{signalLabels[signal]}</span>
                <span className="application-metrics__HealthSummaryValue">{summaryBySignal[signal]?.valueLabel}</span>
                <div className={`application-metrics__HealthSummaryBadge application-metrics__HealthSummaryBadge--${summaryBySignal[signal]?.status || "unknown"}`}>
                  {summaryBySignal[signal]?.status || "unknown"}
                </div>
                <div className="application-metrics__HealthSummarySparkline">
                  {(summaryBySignal[signal]?.sparkline || []).map((value: number, idx: number, points: number[]) => {
                    const max = Math.max(...points, 0);
                    const min = Math.min(...points, 0);
                    const range = max - min || 1;
                    const height = Math.max(10, ((value - min) / range) * 24 + 6);
                    return (
                      <span
                        className="application-metrics__HealthSummarySpark"
                        key={`${signal}-${idx}`}
                        style={{ height: `${height}px` }}
                      />
                    );
                  })}
                  {!summaryBySignal[signal]?.sparkline?.length && (
                    <span className="application-metrics__HealthSummaryNoData">No series</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="application-metrics__HealthSummaryMeta">
            <span>Rows: {healthSummary.rows}</span>
            <span>Charts: {healthSummary.graphs}</span>
            <span>Threshold charts: {healthSummary.thresholdGraphs}</span>
            <span>Recent events: {healthSummary.recentEvents}</span>
          </div>
        </div>
      )}
      {dashboard?.tabs?.length && (
        <div className="application-metrics__Tabs">
          {dashboard?.tabs?.map((tab: string) => {
            return (
              <div
                className={`application-metrics__Tab ${selectedTab === tab ? "active" : ""
                  }`}
                onClick={() => {
                  setSelectedTab(tab);
                }}
                key={tab}
              >
                {tab}
              </div>
            );
          })}
          {dashboard?.rows?.filter(
            (r: any) => !dashboard?.tabs?.includes(r.tab)
          )?.length > 0 && (
              <div
                className={`application-metrics__Tab ${selectedTab === "More" ? "active" : ""
                  }`}
                onClick={() => {
                  setSelectedTab("More");
                }}
                key={"More"}
              >
                More
              </div>
            )}
        </div>
      )}

      {!isLoading &&
        dashboard?.rows &&
        !dashboard?.rows?.filter(
          (r: any) => dashboard?.tabs?.includes(r.tab) || selectedTab === "More"
        )?.length && (
          <p>
            No charts assigned to the <strong>{selectedTab}</strong> tab.
          </p>
        )}

      {visibleRows?.map((row: any) => {
        return (
          <React.Fragment key={row.name}>
            <div className="application-metrics">
              <span className="application-metrics__RowTitle">{row.title}</span>
            </div>
            <div className="application-metrics__ChartContainerFlex">
              {row?.graphs?.map((graph: any) => {
                const url = `/extensions/metrics/api/applications/${applicationName}/groupkinds/${resource.kind.toLowerCase()}/rows/${row.name
                  }/graphs/${graph.name
                  }?name=${resourceName}.*&namespace=${namespace}&application_name=${applicationName}&project=${project}&uid=${uid}&duration=${duration}`;
                return (
                  <ChartWrapper
                    applicationName={applicationName}
                    filterChart={filterChart}
                    setFilterChart={setFilterChart}
                    highlight={highlight}
                    setHighlight={setHighlight}
                    events={events}
                    queryPath={url}
                    resource={resource}
                    groupBy={graph.metricName}
                    name={resourceName}
                    yUnit={graph.yAxisUnit || ""}
                    valueRounding={graph.valueRounding || 10}
                    labelKey={graph.title}
                    metric={graph.name}
                    graphType={graph.graphType}
                    project={project}
                    applicationNamespace={applicationNamespace}
                    title={graph.title}
                    description={graph.description}
                    onChartData={(chartData: AllChartDataProps[string]) => {
                      handleChartData(url, chartData);
                    }}
                  />
                );
              })}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Metrics;
