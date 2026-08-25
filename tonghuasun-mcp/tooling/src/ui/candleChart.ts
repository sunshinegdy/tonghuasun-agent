import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";

type CandlePeriod = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1w" | "1mo";
type Adjustment = "forward" | "none" | "backward";
type ChartSecurity = { market: string; code: string; fullCode: string; name: string; type?: string; currency?: string };
type CandleBar = {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};
type CandleChartData = {
  schemaVersion: 1;
  chartType: "candlestick";
  security: ChartSecurity;
  period: CandlePeriod;
  periodLabel: string;
  adjustment: Adjustment;
  requestedLimit: number;
  pointCount: number;
  fetchedAtUtc: string;
  latest: CandleBar & { change: number | null; changePercent: number | null };
  bars: CandleBar[];
};
type OpenAiBridge = {
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  notifyIntrinsicHeight?: () => void;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
};

declare global {
  interface Window { openai?: OpenAiBridge; }
}

const periods: Array<{ value: CandlePeriod; label: string }> = [
  { value: "1m", label: "1分" },
  { value: "5m", label: "5分" },
  { value: "15m", label: "15分" },
  { value: "30m", label: "30分" },
  { value: "60m", label: "60分" },
  { value: "1d", label: "日K" },
  { value: "1w", label: "周K" },
  { value: "1mo", label: "月K" }
];

const elements = {
  chart: required("chart"),
  periods: required("periods"),
  refresh: button("refresh"),
  toggleMa: button("toggle-ma"),
  loading: required("loading"),
  securityName: required("security-name"),
  securityCode: required("security-code"),
  latestPrice: required("latest-price"),
  priceChange: required("price-change"),
  latestTime: required("latest-time"),
  statOpen: required("stat-open"),
  statHigh: required("stat-high"),
  statLow: required("stat-low"),
  statVolume: required("stat-volume"),
  statAmount: required("stat-amount"),
  dataStatus: required("data-status")
};

const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
let nextRequestId = 1;
let latestInput: Record<string, unknown> | null = null;
let currentData: CandleChartData | null = null;
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let volumeSeries: ISeriesApi<"Histogram"> | null = null;
let movingAverageSeries: Array<ISeriesApi<"Line">> = [];
let showMovingAverages = true;

renderPeriodButtons();
installBridgeListeners();
installControls();
window.addEventListener("resize", resizeChart, { passive: true });
setTimeout(readCompatibilityGlobals, 0);

function installBridgeListeners(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = asRecord(event.data);
    if (!message || message.jsonrpc !== "2.0") return;

    if (typeof message.id === "number" && pendingRequests.has(message.id)) {
      const pending = pendingRequests.get(message.id)!;
      pendingRequests.delete(message.id);
      if (message.error) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "ui/notifications/tool-input") {
      latestInput = asRecord(message.params);
    }
    if (message.method === "ui/notifications/tool-result") {
      applyToolEnvelope(message.params);
    }
  }, { passive: true });

  window.addEventListener("openai:set_globals", (event) => {
    const detail = asRecord((event as CustomEvent).detail);
    const globals = asRecord(detail?.globals);
    if (globals?.toolInput) latestInput = asRecord(globals.toolInput);
    applyToolEnvelope(globals?.toolResponseMetadata ?? globals?.toolOutput);
  });
}

function installControls(): void {
  elements.refresh.addEventListener("click", () => refreshData(currentData?.period ?? "1d"));
  elements.toggleMa.addEventListener("click", () => {
    showMovingAverages = !showMovingAverages;
    elements.toggleMa.classList.toggle("active", showMovingAverages);
    elements.toggleMa.setAttribute("aria-pressed", String(showMovingAverages));
    for (const series of movingAverageSeries) series.applyOptions({ visible: showMovingAverages });
  });
}

function renderPeriodButtons(): void {
  for (const period of periods) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "period-button";
    control.dataset.period = period.value;
    control.textContent = period.label;
    control.addEventListener("click", () => refreshData(period.value));
    elements.periods.append(control);
  }
}

async function refreshData(period: CandlePeriod): Promise<void> {
  const source = currentData ?? chartDataFromInput(latestInput);
  if (!source) {
    showError("缺少证券参数，请在会话中重新生成图表。");
    return;
  }

  setBusy(true);
  try {
    const args = {
      security: source.security.fullCode,
      period,
      adjustment: source.adjustment,
      limit: source.requestedLimit || 160
    };
    const result = await callTool("ths_chart_candle_data", args);
    if (!applyToolEnvelope(result)) {
      throw new Error("同花顺未返回可渲染的图表数据。");
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function applyToolEnvelope(envelope: unknown): boolean {
  const data = findChartData(envelope);
  if (!data) return false;
  renderChart(data);
  return true;
}

function renderChart(data: CandleChartData): void {
  currentData = data;
  latestInput = {
    security: data.security.fullCode,
    period: data.period,
    adjustment: data.adjustment,
    limit: data.requestedLimit
  };
  updateActivePeriod(data.period);
  updateQuote(data.latest, data);
  destroyChart();

  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue("--muted").trim();
  const lineColor = styles.getPropertyValue("--line").trim();
  const riseColor = styles.getPropertyValue("--rise").trim();
  const fallColor = styles.getPropertyValue("--fall").trim();
  chart = createChart(elements.chart, {
    width: elements.chart.clientWidth,
    height: elements.chart.clientHeight,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor },
    grid: { vertLines: { color: lineColor }, horzLines: { color: lineColor } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: lineColor },
    timeScale: { borderColor: lineColor, timeVisible: data.period.endsWith("m") && data.period !== "1mo", secondsVisible: false },
    localization: { locale: "zh-CN", priceFormatter: (price: number) => formatPrice(price) }
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: riseColor,
    downColor: fallColor,
    borderVisible: false,
    wickUpColor: riseColor,
    wickDownColor: fallColor,
    priceLineVisible: false
  });
  volumeSeries = chart.addSeries(HistogramSeries, {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false
  });
  candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  const candleData = data.bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close
  }));
  candleSeries.setData(candleData);
  volumeSeries.setData(data.bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: `${bar.close >= bar.open ? riseColor : fallColor}70`
  })));

  movingAverageSeries = [
    addMovingAverage(data.bars, 5, styles.getPropertyValue("--ma5").trim()),
    addMovingAverage(data.bars, 10, styles.getPropertyValue("--ma10").trim()),
    addMovingAverage(data.bars, 20, styles.getPropertyValue("--ma20").trim())
  ];
  chart.timeScale().fitContent();
  chart.subscribeCrosshairMove((parameter) => {
    if (!parameter.time || !candleSeries || !currentData) {
      updateQuote(currentData?.latest ?? data.latest, currentData ?? data);
      return;
    }
    const candle = parameter.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
    const time = typeof parameter.time === "number" ? parameter.time : null;
    const bar = time === null ? undefined : currentData.bars.find((item) => item.time === time);
    if (candle && bar) updateQuote(bar, currentData);
  });

  elements.loading.classList.add("hidden");
  elements.loading.classList.remove("error");
  elements.dataStatus.textContent = `${data.periodLabel} · ${data.pointCount} 点 · ${formatFetchedAt(data.fetchedAtUtc)}`;
  window.openai?.notifyIntrinsicHeight?.();
}

function addMovingAverage(bars: CandleBar[], period: number, color: string): ISeriesApi<"Line"> {
  const series = chart!.addSeries(LineSeries, {
    color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: showMovingAverages
  });
  const values: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let index = 0; index < bars.length; index++) {
    sum += bars[index]!.close;
    if (index >= period) sum -= bars[index - period]!.close;
    if (index >= period - 1) values.push({ time: bars[index]!.time as UTCTimestamp, value: sum / period });
  }
  series.setData(values);
  return series;
}

function updateQuote(bar: CandleBar | CandleChartData["latest"], data: CandleChartData): void {
  const isLatest = bar.time === data.latest.time;
  const change = isLatest ? data.latest.change : null;
  const changePercent = isLatest ? data.latest.changePercent : null;
  elements.securityName.textContent = data.security.name || data.security.code || "同花顺行情";
  elements.securityCode.textContent = data.security.fullCode;
  elements.latestPrice.textContent = formatPrice(bar.close);
  elements.latestPrice.className = change === null ? "" : change >= 0 ? "rise" : "fall";
  elements.priceChange.className = `price-change ${change === null ? "neutral" : change >= 0 ? "rise" : "fall"}`;
  elements.priceChange.textContent = change === null
    ? "—"
    : `${signed(change)}  ${signed(changePercent ?? 0)}%`;
  elements.latestTime.textContent = `${bar.label} · ${data.periodLabel}`;
  elements.statOpen.textContent = formatPrice(bar.open);
  elements.statHigh.textContent = formatPrice(bar.high);
  elements.statLow.textContent = formatPrice(bar.low);
  elements.statVolume.textContent = formatCompact(bar.volume);
  elements.statAmount.textContent = formatCurrency(bar.amount);
}

function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (window.parent !== window) {
    const id = nextRequestId++;
    window.parent.postMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, "*");
    return new Promise((resolve, reject) => pendingRequests.set(id, { resolve, reject }));
  }
  if (window.openai?.callTool) return window.openai.callTool(name, args);
  return Promise.reject(new Error("当前宿主不支持从图表刷新 MCP 数据。"));
}

function findChartData(value: unknown, depth = 0): CandleChartData | null {
  if (depth > 6) return null;
  const record = asRecord(value);
  if (!record) return null;
  if (isChartData(record.chartData)) return record.chartData;
  if (isChartData(record)) return record;
  for (const key of ["structuredContent", "_meta", "result", "mcp_tool_result", "call_tool_result", "toolResponseMetadata", "params"]) {
    const found = findChartData(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function isChartData(value: unknown): value is CandleChartData {
  const record = asRecord(value);
  return record?.schemaVersion === 1 && record.chartType === "candlestick" && Array.isArray(record.bars);
}

function chartDataFromInput(input: Record<string, unknown> | null): CandleChartData | null {
  const securityRecord = asRecord(input?.security);
  const securityText = typeof input?.security === "string" ? input.security : null;
  const fullCode = typeof securityRecord?.fullCode === "string" ? securityRecord.fullCode : securityText;
  if (!fullCode) return null;
  const [code = fullCode, market = ""] = fullCode.split(".");
  return {
    schemaVersion: 1,
    chartType: "candlestick",
    security: {
      market: String(securityRecord?.market ?? market),
      code: String(securityRecord?.code ?? code),
      fullCode,
      name: String(securityRecord?.name ?? fullCode)
    },
    period: isPeriod(input?.period) ? input.period : "1d",
    periodLabel: "",
    adjustment: isAdjustment(input?.adjustment) ? input.adjustment : "forward",
    requestedLimit: Number(input?.limit ?? 160),
    pointCount: 0,
    fetchedAtUtc: "",
    latest: { time: 0, label: "", open: 0, high: 0, low: 0, close: 0, volume: 0, amount: 0, change: null, changePercent: null },
    bars: []
  };
}

function readCompatibilityGlobals(): void {
  if (window.openai?.toolInput) latestInput = asRecord(window.openai.toolInput);
  applyToolEnvelope(window.openai?.toolResponseMetadata);
  applyToolEnvelope(window.openai?.toolOutput);
}

function setBusy(busy: boolean): void {
  for (const control of elements.periods.querySelectorAll("button")) (control as HTMLButtonElement).disabled = busy;
  elements.refresh.disabled = busy;
  if (busy) {
    elements.loading.textContent = "正在刷新同花顺行情…";
    elements.loading.classList.remove("hidden", "error");
  }
}

function showError(message: string): void {
  elements.loading.textContent = message;
  elements.loading.classList.remove("hidden");
  elements.loading.classList.add("error");
}

function updateActivePeriod(period: CandlePeriod): void {
  for (const control of elements.periods.querySelectorAll("button")) {
    control.classList.toggle("active", (control as HTMLElement).dataset.period === period);
  }
}

function isPeriod(value: unknown): value is CandlePeriod {
  return typeof value === "string" && ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1mo"].includes(value);
}

function isAdjustment(value: unknown): value is Adjustment {
  return value === "forward" || value === "none" || value === "backward";
}

function resizeChart(): void {
  chart?.applyOptions({ width: elements.chart.clientWidth, height: elements.chart.clientHeight });
}

function destroyChart(): void {
  chart?.remove();
  chart = null;
  candleSeries = null;
  volumeSeries = null;
  movingAverageSeries = [];
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number): string {
  return `¥${formatCompact(value)}`;
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date)
    : "本地同花顺数据";
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPrice(value)}`;
}

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing widget element: ${id}`);
  return element;
}

function button(id: string): HTMLButtonElement {
  return required(id) as HTMLButtonElement;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
