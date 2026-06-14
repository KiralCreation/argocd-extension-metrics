/* eslint-disable jsx-a11y/anchor-is-valid */
import * as React from "react";
import { useState, useEffect, useMemo } from "react";

import ChartWrapper from "./Chart/ChartWrapper";
import "./Metrics.scss";
import { getDashBoard } from "./client";

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
      providerType: dashboard?.providerType || "unknown",
    };
  }, [visibleRows, events, dashboard?.providerType]);

  return (
    <div>
      {dashboard?.rows?.length > 0 && (
        <div className="application-metrics__HealthSummary">
          <div className="application-metrics__HealthSummaryItem">
            <span className="application-metrics__HealthSummaryLabel">Provider</span>
            <span className="application-metrics__HealthSummaryValue">
              {healthSummary.providerType}
            </span>
          </div>
          <div className="application-metrics__HealthSummaryItem">
            <span className="application-metrics__HealthSummaryLabel">Rows</span>
            <span className="application-metrics__HealthSummaryValue">{healthSummary.rows}</span>
          </div>
          <div className="application-metrics__HealthSummaryItem">
            <span className="application-metrics__HealthSummaryLabel">Charts</span>
            <span className="application-metrics__HealthSummaryValue">{healthSummary.graphs}</span>
          </div>
          <div className="application-metrics__HealthSummaryItem">
            <span className="application-metrics__HealthSummaryLabel">Threshold charts</span>
            <span className="application-metrics__HealthSummaryValue">
              {healthSummary.thresholdGraphs}
            </span>
          </div>
          <div className="application-metrics__HealthSummaryItem">
            <span className="application-metrics__HealthSummaryLabel">Recent events</span>
            <span className="application-metrics__HealthSummaryValue">
              {healthSummary.recentEvents}
            </span>
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
          <>
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
                  />
                );
              })}
            </div>
          </>
        );
      })}
    </div>
  );
};

export default Metrics;
