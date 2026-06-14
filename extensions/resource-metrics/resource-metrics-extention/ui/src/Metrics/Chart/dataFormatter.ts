import type {
  ChartDataProps,
  CustomPrometheusResponse,
  CustomWavefrontResponse,
  PrometheusResponse,
  WavefrontThresholdResponse,
  WavefrontTS,
} from "./types";

const defaultYFormatter = (y: any): number => (isNaN(y) ? 0 : y * 1);
const defaultXFormatter = (x: any): number => Math.floor(x * 1);

const formatPrometheusSeries = ({
  obj,
  groupBy,
  isThreshold,
  yFormatter = defaultYFormatter,
  xFormatter = defaultXFormatter,
  thresholdMeta,
}: {
  obj: PrometheusResponse;
  groupBy: string;
  isThreshold: boolean;
  yFormatter?: (arg0: number) => number;
  xFormatter?: (arg0: number) => number;
  thresholdMeta?: {
    key?: string;
    value?: string;
    color?: string;
    unit?: string;
    name?: string;
  };
}) => {
  if (!obj?.metric?.[groupBy] && !obj?.values?.length) {
    return null;
  }
  const metricObj: ChartDataProps = {
    ...obj,
    name: isThreshold
      ? thresholdMeta?.name
      : obj?.metric && typeof obj?.metric?.[groupBy] === "string"
      ? (obj?.metric?.[groupBy] as string)
      : Object.values(obj?.metric || {}).join(":"),
    data: [],
    key: thresholdMeta?.key || "",
    color: thresholdMeta?.color || "",
    unit: thresholdMeta?.unit || "",
    value: thresholdMeta?.value || "",
    isThreshold,
  };

  obj?.values?.forEach((kp: [any, any], i: number) => {
    const previousX =
      typeof metricObj.data?.[i - 1]?.x === "number"
        ? metricObj.data[i - 1].x
        : undefined;
    if (obj?.values?.length && previousX !== undefined && previousX < kp[0] - 61) {
      metricObj.data?.push({
        x: previousX + 60,
        y: null,
      });
      return;
    }
    metricObj.data?.push({
      x: xFormatter(kp[0]),
      y: yFormatter(kp[1]),
    });
  });
  return metricObj;
};

const formatWavefrontSeries = ({
  obj,
  groupBy,
  isThreshold,
  threshold,
}: {
  obj: WavefrontTS;
  groupBy: string;
  isThreshold: boolean;
  threshold?: WavefrontThresholdResponse;
}) => {
  if (!obj?.tags?.[groupBy] && !obj?.data?.length) {
    return null;
  }
  const metricObj: ChartDataProps = {
    ...obj,
    name: isThreshold ? threshold?.name : obj?.tags && Object.values(obj?.tags).join(":"),
    data: [],
    key: threshold?.key || "",
    value: threshold?.value || "",
    color: threshold?.color || "",
    unit: threshold?.unit || "",
    isThreshold,
  };
  metricObj.data = obj?.data;
  return metricObj;
};

export const formatChartData = ({
  data,
  groupBy,
  yFormatter = defaultYFormatter,
  xFormatter = defaultXFormatter,
}: {
  data: CustomPrometheusResponse & CustomWavefrontResponse;
  groupBy: string;
  yFormatter?: (arg0: number) => number;
  xFormatter?: (arg0: number) => number;
}) => {
  const formattedData: Array<ChartDataProps> = [];
  const formattedThresholdData: Array<ChartDataProps> = [];

  if (data?.data?.granularity) {
    data?.data?.timeseries?.forEach((obj: WavefrontTS) => {
      const metricObj = formatWavefrontSeries({ obj, groupBy, isThreshold: false });
      if (metricObj) {
        formattedData.push(metricObj);
      }
    });
    data?.thresholds?.forEach((temp: WavefrontThresholdResponse) => {
      temp?.data?.timeseries?.forEach((obj: WavefrontTS) => {
        const metricObj = formatWavefrontSeries({
          obj,
          groupBy,
          isThreshold: true,
          threshold: temp,
        });
        if (metricObj) {
          formattedThresholdData.push(metricObj);
        }
      });
    });
    return { data: formattedData, thresholds: formattedThresholdData };
  }

  data?.data?.forEach((obj: PrometheusResponse) => {
    const metricObj = formatPrometheusSeries({
      obj,
      groupBy,
      isThreshold: false,
      yFormatter,
      xFormatter,
    });
    if (metricObj) {
      formattedData.push(metricObj);
    }
  });

  data?.thresholds?.forEach((temp) => {
    temp?.data?.forEach((obj: PrometheusResponse) => {
      const metricObj = formatPrometheusSeries({
        obj,
        groupBy,
        isThreshold: true,
        yFormatter,
        xFormatter,
        thresholdMeta: {
          name: temp?.name,
          key: temp?.key,
          value: temp?.value,
          color: temp?.color,
          unit: temp?.unit,
        },
      });
      if (metricObj) {
        formattedThresholdData.push(metricObj);
      }
    });
  });

  return { data: formattedData, thresholds: formattedThresholdData };
};

