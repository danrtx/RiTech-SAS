export const CHART_ZONE = "America/New_York";
export const MINUTE = 60_000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHART_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CHART_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const sessionDate = (ms: number): string => dayFormatter.format(ms);
export const sessionTime = (ms: number): string => timeFormatter.format(ms);
export function regularSession(ms: number): boolean {
  const time = sessionTime(ms);
  const weekday = new Date(`${sessionDate(ms)}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && time >= "09:30" && time < "16:00";
}
export function validDate(value: string): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "1900-01-01" &&
    Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
  );
}
export interface ChartCandle {
  symbol: string;
  date: string;
  startTimeMs: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  observations: number;
  source: "stream" | "provider_ohlc";
  updatedAtMs: number;
}
export interface ChartObservation {
  id: string;
  symbol: string;
  price: number;
  eventTimeMs: number;
  receivedAtMs: number;
}
export interface HistoricalBar {
  startTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}
