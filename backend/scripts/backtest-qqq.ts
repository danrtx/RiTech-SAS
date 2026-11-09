import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectDataset } from "../src/modules/backtesting/dataset";
import { backtest } from "../src/modules/backtesting/backtest";
import {
  parseQqqBars,
  summarizeQqqCoverage,
} from "../src/modules/backtesting/qqq-history";

// Offline replay: cached provider responses are reused; no broker or Gemini calls.
async function main() {
  const [start, end, directory, pagesText = "1"] = process.argv.slice(2);
  const pages = Number(pagesText);
  if (
    ![start, end].every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "")) ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    start >= end ||
    !directory ||
    !Number.isInteger(pages) ||
    pages < 1 ||
    pages > 100
  )
    throw new Error(
      "Usage: backtest-qqq.ts YYYY-MM-DD YYYY-MM-DD output-directory [max-pages 1..100]",
    );
  if (Date.parse(end) >= Date.now() - 86400000)
    throw new Error(
      "End must be a completed historical date, at least 24 hours ago",
    );
  const output = resolve(directory);
  mkdirSync(output, { recursive: true });
  let cursor = end + " 23:59:59";
  const observations = new Map<number, number>();
  const sources: { file: string; sha256: string }[] = [];
  const rejected: {
    file: string;
    bar: Record<string, unknown>;
    reason: string;
  }[] = [];
  let reachedStart = false;
  let failure: string | undefined;
  let networkCalls = 0;
  for (let page = 0; page < pages; page++) {
    const file = `qqq-1min-${cursor.replace(/[: ]/g, "-")}.json`;
    const path = resolve(output, file);
    let raw: string;
    if (existsSync(path)) raw = readFileSync(path, "utf8");
    else {
      const key = process.env.TWELVE_DATA_API_KEY?.trim();
      if (!key)
        throw new Error("TWELVE_DATA_API_KEY is required for uncached pages");
      if (networkCalls++) await new Promise((r) => setTimeout(r, 9000));
      const url = new URL("https://api.twelvedata.com/time_series");
      Object.entries({
        symbol: "QQQ",
        interval: "1min",
        timezone: "UTC",
        start_date: start,
        end_date: cursor,
        outputsize: "5000",
        order: "desc",
        prepost: "false",
        adjust: "splits",
        apikey: key,
      }).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const body = (await response.json()) as any;
      if (!response.ok || body.status === "error") {
        // Never persist provider messages: they may echo credentials or request URLs.
        failure = `PROVIDER_REQUEST_REJECTED_HTTP_${response.status}_CODE_${Number(body.code) || 0}`;
        break;
      }
      raw = JSON.stringify(body, null, 2);
      writeFileSync(path, raw);
    }
    const body = JSON.parse(raw);
    const bars = parseQqqBars(body, start, cursor, (bar) =>
      rejected.push({ file, bar, reason: "INCONSISTENT_OHLC" }),
    );
    sources.push({
      file,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
    if (!bars.length) break;
    let oldest = Infinity;
    for (const bar of bars) {
      oldest = Math.min(oldest, bar.openTime);
      const time = bar.eventTimeMs,
        price = bar.price;
      if (observations.has(time) && observations.get(time) !== price)
        throw new Error("Conflicting duplicate historical bar");
      observations.set(time, price);
    }
    console.log(
      JSON.stringify({
        page: page + 1,
        bars: observations.size,
        oldest: new Date(oldest).toISOString(),
      }),
    );
    if (body.values.length < 5000 || oldest <= Date.parse(start)) {
      reachedStart = true;
      break;
    }
    cursor = new Date(oldest - 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  }
  const manifest = {
    symbol: "QQQ",
    interval: "1min",
    requestedStart: start,
    requestedEnd: end,
    sources,
    reachedStart,
    failure,
    fetchedAt: new Date().toISOString(),
    bars: observations.size,
    limitations: [
      "Reached start means provider pagination exhausted, not independently verified session coverage.",
      "Minute closing observations cannot reproduce intraminute execution or live two-second freshness.",
      "Split-adjusted prices; dividends excluded. Long-only liquidation benchmark, no re-entry or portfolio hedge.",
    ],
  };
  writeFileSync(
    resolve(output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  if (observations.size < 2)
    throw new Error(failure || "Insufficient observations");
  const dataset = {
    provenance: {
      source: "Twelve Data /time_series QQQ 1min UTC split-adjusted closes",
      version: `${start}/${end}`,
      synthetic: false,
      excludedInvalidBars: rejected.length,
    },
    config: {
      initialCapital: 10000,
      costBps: 5,
      slippageBps: 5,
      maxGapMs: 60000,
    },
    samples: [...observations]
      .sort((a, b) => a[0] - b[0])
      .map(([eventTimeMs, price]) => ({ symbol: "QQQ", eventTimeMs, price })),
  };
  const coverage = summarizeQqqCoverage(
    dataset.samples.map((s) => s.eventTimeMs),
  );
  writeFileSync(
    resolve(output, "coverage.json"),
    JSON.stringify(coverage, null, 2),
  );
  const raw = JSON.stringify(dataset);
  writeFileSync(resolve(output, "dataset.json"), raw);
  const { report: quality } = inspectDataset(raw);
  writeFileSync(
    resolve(output, "quarantine.json"),
    JSON.stringify(rejected, null, 2),
  );
  const result = backtest(dataset.samples, dataset.config);
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        ...result,
        dataQuality: quality,
        coverage,
        manifest,
        riskCriterion:
          "maximumDrawdownPercent >= -2; descriptive result, not acceptance of the full strategy",
      },
      null,
      2,
    ),
  );
  const sensitivity = [0, 5, 10, 25].map((bps) => {
    const r = backtest(dataset.samples, {
      ...dataset.config,
      costBps: bps,
      slippageBps: bps,
    });
    return {
      costBps: bps,
      slippageBps: bps,
      maximumDrawdownPercent: r.maximumDrawdownPercent,
      returnPercent: r.returnPercent,
      finalEquity: r.finalEquity,
      executions: r.executions.length,
      baseline: r.baseline,
      riskLimitWithinTwoPercent: r.riskLimitWithinTwoPercent,
    };
  });
  writeFileSync(
    resolve(output, "sensitivity.json"),
    JSON.stringify(sensitivity, null, 2),
  );
  // Independent monthly starts expose sensitivity to the entry date. They are
  // not compounded and do not imply a re-entry rule in the production strategy.
  const months = new Map<string, typeof dataset.samples>();
  for (const sample of dataset.samples) {
    const month = new Date(sample.eventTimeMs).toISOString().slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push(sample);
  }
  const monthly = [...months]
    .filter(([, samples]) => samples.length > 1)
    .map(([month, samples]) => {
      const r = backtest(samples, dataset.config);
      return {
        month,
        samples: samples.length,
        maximumDrawdownPercent: r.maximumDrawdownPercent,
        returnPercent: r.returnPercent,
        executions: r.executions.length,
        baseline: r.baseline,
        riskLimitWithinTwoPercent: r.riskLimitWithinTwoPercent,
      };
    });
  writeFileSync(
    resolve(output, "monthly-independent.json"),
    JSON.stringify(
      {
        interpretation:
          "Independent fresh-capital runs, including partial boundary months; not a compounded strategy.",
        results: monthly,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      bars: observations.size,
      reachedStart,
      failure,
      drawdown: result.maximumDrawdownPercent,
      returnPercent: result.returnPercent,
      blockers: quality.blockers,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && !/fetch|network/i.test(error.message)
      ? error.message
      : "Historical download failed; no credential details logged",
  );
  process.exitCode = 1;
});
