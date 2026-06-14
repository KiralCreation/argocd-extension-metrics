import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { apiCall, getHeaders } from "../client";
import CustomPie from "../Pie/Pie";
import AnomalyChart from "./AnomalyChart";
import TimeSeriesChart from "./Chart";
import type {
  AllChartDataProps,
} from "./types";
import { formatChartData } from "./dataFormatter";

export const colorArray = [
  "#00A2B3",
  "#f5a337",
  "#0c568f",
  "#8f8f8f",
  "#6e4611",
  "#63b343",
  "#1abe93",
  "#bd19c6",
  "#fb44be",
  "#999966",
  "#9999ff",
  "#80B300",
  "#33FFCC",
  "#ba55ba",
  "#E6B3B3",
  "#43680b",
  "#25b708",
  "#66994D",
  "#1AB399",
];

export const ChartWrapper = ({
  applicationName,
  resource,
  labelKey,
  groupBy,
  name,
  title,
  metric,
  yUnit,
  valueRounding,
  yFormatter = (y: any) => y,
  events,
  graphType,
  queryPath,
  project,
  applicationNamespace,
  filterChart,
  setFilterChart,
  highlight,
  setHighlight,
  description
}: any) => {
  const [chartsData, setChartsData] = useState<AllChartDataProps>({});

  useEffect(() => {
    const url = `${queryPath}`;
    apiCall(
      url,
      getHeaders({
        applicationName,
        applicationNamespace,
        project,
      })
    )
      .then((data) => {
        setChartsData({
          ...chartsData,
          [metric]: formatChartData({ data, groupBy, yFormatter }),
        });
      })
      .catch((err) => {
        console.error("res.data", err);
      });
  }, [queryPath, resource]);

  return useMemo(
    () => (
      <>
        {graphType === "anomaly" && (
          <AnomalyChart
            events={events}
            metric={metric}
            chartData={chartsData[metric]}
            groupBy={groupBy}
            yFormatter={yFormatter}
            title={title}
            yUnit={yUnit}
            valueRounding={valueRounding}
            labelKey={labelKey}
            filterChart={filterChart}
            setFilterChart={setFilterChart}
            highlight={highlight}
            setHighlight={setHighlight}
            description={description}
          />
        )}

        {graphType === "line" && (
          <TimeSeriesChart
            events={events}
            metric={metric}
            chartData={chartsData[metric]}
            groupBy={groupBy}
            yFormatter={yFormatter}
            title={title}
            yUnit={yUnit}
            valueRounding={valueRounding}
            labelKey={labelKey}
            filterChart={filterChart}
            setFilterChart={setFilterChart}
            highlight={highlight}
            setHighlight={setHighlight}
            description={description}
          />
        )}
        {graphType === "pie" && (
          <CustomPie
            metric={metric}
            groupBy={groupBy}
            labelKey={labelKey}
            filterChart={filterChart}
            highlight={highlight}
            yUnit={yUnit}
            valueRounding={valueRounding}
            setHighlight={setHighlight}
            chartData={chartsData[metric]}
            yFormatter={yFormatter}
            description={description}
          />
        )}
      </>
    ),
    [
      metric,
      groupBy,
      labelKey,
      filterChart[groupBy],
      highlight[groupBy],
      chartsData[metric],
    ]
  );
};

export default ChartWrapper;
