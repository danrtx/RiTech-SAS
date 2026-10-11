import { HistoricalBar, MINUTE, regularSession } from "./chart.types";

/** The chart accepts OHLC history; the trading/ATR tick pipeline never sees it. */
export function parseHistory(
  body: unknown,
  symbol: string,
  now: number,
): HistoricalBar[] {
  const data = body as {
    status?: string;
    meta?: Record<string, unknown>;
    values?: Record<string, unknown>[];
  };
  if (
    data?.status !== "ok" ||
    data.meta?.symbol !== symbol ||
    data.meta?.currency !== "USD" ||
    data.meta?.interval !== "1min" ||
    data.meta?.exchange !== "NASDAQ" ||
    !Array.isArray(data.values) ||
    data.values.length > 1000
  ) {
    throw new Error("chart_history_invalid");
  }
  const seen = new Set<number>();
  const bars: HistoricalBar[] = [];
  for (const row of data.values) {
    if (
      !row ||
      typeof row.datetime !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(row.datetime)
    )
      throw new Error("chart_history_invalid");
    const iso = row.datetime.replace(" ", "T") + "Z";
    const startTimeMs = Date.parse(iso);
    const prices = [row.open, row.high, row.low, row.close];
    if (
      !Number.isFinite(startTimeMs) ||
      startTimeMs < 0 ||
      new Date(startTimeMs).toISOString() !== iso.replace("Z", ".000Z") ||
      !prices.every(
        (p) =>
          typeof p === "string" &&
          /^\d+(\.\d+)?$/.test(p) &&
          Number.isFinite(Number(p)) &&
          Number(p) > 0,
      ) ||
      seen.has(startTimeMs)
    )
      throw new Error("chart_history_invalid");
    const [open, high, low, close] = prices.map(Number);
    if (
      row.volume !== undefined &&
      row.volume !== null &&
      !(
        typeof row.volume === "number" ||
        (typeof row.volume === "string" && /^\d+(\.\d+)?$/.test(row.volume))
      )
    ) {
      throw new Error("chart_history_invalid");
    }
    const volume =
      row.volume === undefined || row.volume === null
        ? null
        : Number(row.volume);
    if (
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close) ||
      (volume !== null &&
        (!Number.isFinite(volume) || volume < 0 || row.volume === ""))
    )
      throw new Error("chart_history_invalid");
    seen.add(startTimeMs);
    if (startTimeMs + MINUTE > now || !regularSession(startTimeMs)) continue;
    bars.push({ startTimeMs, open, high, low, close, volume });
  }
  return bars.sort((a, b) => a.startTimeMs - b.startTimeMs);
}

export async function fetchChartHistory(
  symbol: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<HistoricalBar[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  const params = {
    symbol,
    apikey: apiKey,
    exchange: "NASDAQ",
    interval: "1min",
    outputsize: "1000",
    timezone: "UTC",
    order: "asc",
    prepost: "false",
  };
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  // No URLs, network exception messages or provider bodies may be logged.
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("chart_history_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("chart_history_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("chart_history_limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return parseHistory(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    symbol,
    Date.now(),
  );
}
