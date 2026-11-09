/** Twelve Data is requested explicitly with timezone=UTC and interval=1min. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseQqqBars(
  body: unknown,
  start: string,
  cursor: string,
  quarantine?: (bar: Record<string, unknown>) => void,
) {
  if (
    !record(body) ||
    !record(body.meta) ||
    body.meta.symbol !== "QQQ" ||
    body.meta.interval !== "1min" ||
    body.meta.exchange_timezone !== "America/New_York" ||
    !Array.isArray(body.values)
  )
    throw new Error(
      "Unexpected provider instrument, interval, exchange timezone or values",
    );
  return body.values.flatMap(
    (
      bar: unknown,
    ): { openTime: number; eventTimeMs: number; price: number } | [] => {
      if (
        !record(bar) ||
        typeof bar.datetime !== "string" ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(bar.datetime)
      )
        throw new Error("Invalid provider UTC bar date");
      const openTime = Date.parse(bar.datetime.replace(" ", "T") + "Z");
      const price = Number(bar.close);
      const high = Number(bar.high),
        low = Number(bar.low),
        open = Number(bar.open);
      if (
        !Number.isFinite(openTime) ||
        new Date(openTime).toISOString().slice(0, 19).replace("T", " ") !==
          bar.datetime ||
        ![price, high, low, open].every((n) => Number.isFinite(n) && n > 0) ||
        openTime > Date.parse(cursor.replace(" ", "T") + "Z") ||
        openTime < Date.parse(start)
      )
        throw new Error("Invalid or out-of-range provider bar");
      if (
        low > Math.min(open, price) ||
        high < Math.max(open, price) ||
        low > high
      ) {
        if (!quarantine) throw new Error("Inconsistent provider OHLC");
        quarantine(bar);
        return [];
      }
      return { openTime, eventTimeMs: openTime + 60000, price };
    },
  );
}

/** Counts observed dates only; it deliberately does not invent an exchange calendar. */
export function summarizeQqqCoverage(times: number[]) {
  const dates = new Map<string, number>();
  const months = new Map<string, number>();
  let withinDateMissingMinutes = 0;
  let previous: number | undefined;
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const time of times) {
    const date = dateFormat.format(new Date(time - 60000));
    dates.set(date, (dates.get(date) || 0) + 1);
    months.set(date.slice(0, 7), (months.get(date.slice(0, 7)) || 0) + 1);
    if (
      previous !== undefined &&
      dateFormat.format(new Date(previous - 60000)) === date
    )
      withinDateMissingMinutes += Math.max(
        0,
        Math.floor((time - previous) / 60000) - 1,
      );
    previous = time;
  }
  return {
    observedDates: dates.size,
    byMonth: Object.fromEntries(months),
    byDate: Object.fromEntries(dates),
    withinDateMissingMinutes,
    status: "REQUIRES_EXCHANGE_CALENDAR_REVIEW",
    explanation:
      "Counts are observed QQQ bars. Missing whole sessions, early closes and leading/trailing gaps require an independent exchange calendar.",
  };
}
