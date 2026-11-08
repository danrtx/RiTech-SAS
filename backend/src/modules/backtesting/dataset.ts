import { createHash } from "node:crypto";
import { BacktestConfig } from "./backtest";
import { StopLossSample } from "../hedging/dynamic-stop-loss";

export interface BacktestDataset {
  provenance: { source: string; version: string; synthetic: boolean };
  config: BacktestConfig;
  samples: StopLossSample[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate external input before allocating an equity curve or running the engine. */
export function parseDataset(raw: string): BacktestDataset {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Dataset must be valid JSON");
  }
  if (!object(value) || !object(value.provenance))
    throw new Error("Dataset requires provenance");
  const provenance = value.provenance;
  for (const field of ["source", "version"]) {
    if (typeof provenance[field] !== "string" || !provenance[field].trim())
      throw new Error(`provenance.${field} must be a nonempty string`);
  }
  if (typeof provenance.synthetic !== "boolean")
    throw new Error("provenance.synthetic must be boolean");
  const config = value.config;
  if (!object(config)) throw new Error("Dataset requires config");
  for (const field of [
    "initialCapital",
    "maxGapMs",
    "costBps",
    "slippageBps",
  ]) {
    const n = config[field];
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      (field === "initialCapital" || field === "maxGapMs"
        ? n <= 0
        : n < 0 || n >= 10000)
    )
      throw new Error(`Invalid config.${field}`);
  }
  if (!Array.isArray(value.samples) || value.samples.length < 2)
    throw new Error("Dataset requires at least two samples");
  let symbol: string | undefined;
  let previous = -Infinity;
  value.samples.forEach((sample: unknown, index: number) => {
    if (
      !object(sample) ||
      typeof sample.symbol !== "string" ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(sample.symbol)
    )
      throw new Error(`samples[${index}]: invalid symbol`);
    symbol ??= sample.symbol;
    if (sample.symbol !== symbol)
      throw new Error(`samples[${index}]: mixed symbols`);
    if (
      typeof sample.price !== "number" ||
      !Number.isFinite(sample.price) ||
      sample.price <= 0
    )
      throw new Error(`samples[${index}]: price must be positive and finite`);
    const time = sample.eventTimeMs;
    if (
      typeof time !== "number" ||
      !Number.isSafeInteger(time) ||
      !Number.isFinite(new Date(time).getTime())
    )
      throw new Error(`samples[${index}]: invalid UTC epoch milliseconds`);
    if (time <= previous)
      throw new Error(
        `samples[${index}]: timestamps must be strictly increasing (no duplicates)`,
      );
    previous = time;
  });
  return value as unknown as BacktestDataset;
}

export function inspectDataset(raw: string) {
  const dataset = parseDataset(raw);
  const { samples, config, provenance } = dataset;
  const from = samples[0].eventTimeMs;
  const to = samples[samples.length - 1].eventTimeMs;
  const requiredEnd = new Date(from);
  requiredEnd.setUTCFullYear(requiredEnd.getUTCFullYear() + 2);
  const spans24Months =
    Number.isFinite(requiredEnd.getTime()) && to >= requiredEnd.getTime();
  let minIntervalMs = Infinity;
  let maxIntervalMs = 0;
  let discontinuities = 0;
  const gapExamples: { from: number; to: number; durationMs: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const interval = samples[i].eventTimeMs - samples[i - 1].eventTimeMs;
    minIntervalMs = Math.min(minIntervalMs, interval);
    maxIntervalMs = Math.max(maxIntervalMs, interval);
    if (interval > config.maxGapMs) {
      discontinuities++;
      if (gapExamples.length < 20)
        gapExamples.push({
          from: samples[i - 1].eventTimeMs,
          to: samples[i].eventTimeMs,
          durationMs: interval,
        });
    }
  }
  const symbol = samples[0].symbol;
  const blockers: string[] = [];
  if (provenance.synthetic) blockers.push("SYNTHETIC_DATA");
  if (!spans24Months) blockers.push("LESS_THAN_24_MONTHS");
  if (symbol.toUpperCase() !== "NDX")
    blockers.push("INSTRUMENT_REQUIRES_APPROVAL");
  if (minIntervalMs >= 86400000) blockers.push("NO_INTRADAY_OBSERVATIONS");
  return {
    dataset,
    report: {
      schemaVersion: 1,
      sha256: createHash("sha256").update(raw).digest("hex"),
      provenance,
      config,
      symbol,
      samples: samples.length,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      spans24Months,
      instrument: symbol.toUpperCase() === "QQQ" ? "QQQ_PROXY_NOT_NDX" : symbol,
      minIntervalMs,
      maxIntervalMs,
      discontinuities,
      gapExamples,
      blockers,
      historicalAcceptance: blockers.length
        ? "NOT_DEMONSTRATED"
        : "REQUIRES_SOURCE_AND_COVERAGE_REVIEW",
      limitations: [
        "Provenance is a declaration, not independent verification of source or license.",
        "Endpoint span does not prove 24 months of trading-session coverage.",
        "Discontinuities include market closures; no exchange calendar or missing-session percentage is inferred.",
        "Intraday observations do not prove sufficient resolution for the live two-second freshness rule.",
        "Changing maxGapMs changes engine freshness; it does not recreate observations.",
        "The evaluator is a long-only liquidation benchmark, not the full portfolio hedging strategy.",
      ],
    },
  };
}
