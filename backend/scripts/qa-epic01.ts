import { Test } from "@nestjs/testing";
import { INestApplication, Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { once } from "node:events";
import { io, Socket } from "socket.io-client";
import { MarketDataModule } from "../src/modules/market-data/market-data.module";
import { MarketDataWsClient } from "../src/modules/market-data/market-data-ws.client";
import { MarketDataProcessor } from "../src/modules/market-data/market-data.processor";
import { MarketDataService } from "../src/modules/market-data/market-data.service";
import { parseMarketDataConfig } from "../src/modules/market-data/market-data.config";
import { AlpacaMockServer } from "../src/modules/market-data/testing/alpaca-mock.server";
import { createTradeFixture } from "../src/modules/market-data/testing/alpaca.fixtures";
import { RedisCacheModule } from "../src/modules/redis-cache/redis-cache.module";
import { RedisCacheService } from "../src/modules/redis-cache/redis-cache.service";
import { AtrService } from "../src/modules/atr/atr.service";
import { waitUntil } from "../src/testing/mock-provider";

function integer(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${name}`);
  return n;
}

async function main() {
  const durationMs = integer("QA_DURATION_MS", 30000, 10000, 300000);
  const batchSize = integer("QA_BATCH_SIZE", 20, 1, 100);
  const intervalMs = integer("QA_INTERVAL_MS", 50, 20, 1000);
  const path =
    process.env.QA_EPIC01_REPORT_PATH ??
    join(__dirname, "../../../reportes/epic01/qa_metrics.json");
  const mock = new AlpacaMockServer();
  const url = await mock.start();
  const prefix = `ritech:qa:${randomUUID()}`;
  let app: INestApplication | undefined;
  let dashboard: Socket | undefined;
  let producer: NodeJS.Timeout | undefined;
  let cache: RedisCacheService | undefined;
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source:
      "local Alpaca-protocol mock + actual application modules + real Redis",
    requested: {
      durationMs,
      batchSize,
      intervalMs,
      ticksPerSecond: (batchSize * 1000) / intervalMs,
    },
  };
  Logger.overrideLogger(["error"]);
  try {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: "test",
              MOCK_FEED_URL: "",
              ATR_SYMBOLS: "QQQ",
              TICK_KEY_PREFIX: prefix,
              REDIS_HOST: process.env.REDIS_TEST_HOST ?? "127.0.0.1",
              REDIS_PORT: Number(process.env.REDIS_TEST_PORT ?? 6379),
              REDIS_PASS: process.env.REDIS_TEST_PASSWORD ?? "ritech_dev",
              marketData: parseMarketDataConfig({
                MARKET_DATA_PROVIDER: 'alpaca',
                MARKET_DATA_ENABLED: "true",
                MARKET_DATA_FEED: "mock",
                MARKET_DATA_WS_URL: url,
              }),
            }),
          ],
        }),
        RedisCacheModule,
        MarketDataModule,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, "127.0.0.1");
    cache = app.get<RedisCacheService>(RedisCacheService);
    if (cache.getClient().status !== "ready")
      await Promise.race([
        once(cache.getClient(), "ready"),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Redis unavailable")),
            5000,
          ).unref(),
        ),
      ]);
    const base = await app.getUrl();
    const client = app.get(MarketDataWsClient);
    const processor = app.get(MarketDataProcessor);
    const service = app.get(MarketDataService);
    await waitUntil(() => service.getStatus().continuity?.state === 'LIVE', 10000);
    const events = {
      ticks: 0,
      duplicates: 0,
      atr: 0,
      investment: 0,
      alerts: 0,
      quality: 0,
    };
    const seen = new Set<string>();
    dashboard = io(`${base}/telemetry`, {
      transports: ["websocket"],
      reconnection: false,
    });
    dashboard.on("telemetry_tick", (tick: { eventId: string }) => {
      events.ticks++;
      if (seen.has(tick.eventId)) events.duplicates++;
      seen.add(tick.eventId);
    });
    dashboard.on("atr_result", () => events.atr++);
    dashboard.on("investment_update", () => events.investment++);
    dashboard.on("price_alert", () => events.alerts++);
    dashboard.on("market_data_quality", () => events.quality++);
    await waitUntil(() => !!dashboard?.connected);
    let subscribed = false;
    dashboard.once("subscribed", () => {
      subscribed = true;
    });
    dashboard.emit("subscribe_symbol", { symbol: "QQQ" });
    await waitUntil(() => subscribed);
    const rule = await fetch(`${base}/market-data/rules/qa`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        windowMs: 1000,
        upPercent: 0.01,
        downPercent: 0.01,
        cooldownMs: 0,
        thresholdBasis: "INVESTMENT",
        investedAmount: 10000,
      }),
    });
    if (!rule.ok) throw new Error("Rule endpoint failed");
    let generated = 0;
    let noSubscriber = 0;
    let duplicateFrames = 0;
    let lastBatch: ReturnType<typeof createTradeFixture>[] = [];
    const started = performance.now();
    producer = setInterval(() => {
      lastBatch = Array.from({ length: batchSize }, () =>
        createTradeFixture({
          i: ++generated,
          p: 100 + (Math.floor(generated / 100) % 3),
          t: new Date().toISOString(),
        }),
      );
      if (!mock.publish(lastBatch)) noSubscriber += lastBatch.length;
      if (generated % (batchSize * 10) === 0) {
        mock.publish(lastBatch);
        duplicateFrames += lastBatch.length;
      }
    }, intervalMs);
    const cuts: Record<string, unknown>[] = [];
    for (let index = 0; index < 4; index++) {
      await waitUntil(
        () => performance.now() - started >= (durationMs * (index + 1)) / 5,
        durationMs,
      );
      const before = await cache.getClient().hlen(cache.keys("QQQ")[1]);
      const at = performance.now();
      const previousReconnects = service.getStatus().reconnects;
      if (index < 3) mock.disconnectClients();
      else mock.setSilent(true);
      await waitUntil(() => client.getStatus().state === "DEGRADED", 2000);
      const detectionMs = performance.now() - at;
      const failure = client.getStatus().lastError?.reason;
      const history = (await (
        await fetch(`${base}/market-data/history?limit=1`)
      ).json()) as { points: number };
      const cachedDuringCut = await cache
        .getClient()
        .hlen(cache.keys("QQQ")[1]);
      if (index === 3) mock.setSilent(false);
      await waitUntil(
        () =>
          service.getStatus().reconnects > previousReconnects &&
          client.getStatus().state === "LIVE" && service.getStatus().continuity?.state === 'LIVE',
        2000,
      );
      // Explicit provider duplicate immediately after resubscription; no fake backfill.
      if (lastBatch.length) {
        mock.publish(lastBatch);
        duplicateFrames += lastBatch.length;
      }
      cuts.push({
        kind: index < 3 ? "visible" : "silent",
        failure,
        detectionMs,
        cutToLiveMs: performance.now() - at,
        degradedToLiveMs: service.getStatus().lastRecoveryDurationMs,
        cacheBefore: before,
        cacheDuringCut: cachedDuringCut,
        analysisPointsDuringCut: history.points,
        continuityRecoveryMs: service.getStatus().continuity?.lastDurationMs,
      });
    }
    await waitUntil(
      () => performance.now() - started >= durationMs,
      durationMs,
    );
    clearInterval(producer);
    producer = undefined;
    await new Promise((r) => setTimeout(r, 100));
    await processor.whenIdle();
    const elapsedMs = performance.now() - started;
    const status = processor.getStatus();
    const stored = await cache.getClient().hlen(cache.keys("QQQ")[1]);
    const indexed = await cache.getClient().zcard(cache.keys("QQQ")[0]);
    const finalHistory = await (await fetch(`${base}/market-data/history?limit=1`)).json() as { points: number };
    const checks = {
      latencyUnder200ms:
        status.receiptToConsumerLatencyMs.max !== null &&
        status.receiptToConsumerLatencyMs.max < 200,
      repeatedRecoveryUnder2s:
        cuts.length === 4 && cuts.every((c) => Number(c.cutToLiveMs) < 2000),
      noDuplicateCacheOrTelemetry:
        stored === indexed &&
        stored === cache.metrics.accepted &&
        events.duplicates === 0,
      persistedWindowRetained: cuts.every(
        (c) => Number(c.cacheDuringCut) >= Number(c.cacheBefore),
      ),
      ruleAndTelemetryFlow:
        events.ticks > 0 &&
        events.investment > 0 &&
        events.alerts > 0 &&
        events.quality >= 4 &&
        events.atr > 0,
      mobileWindowContinuous:
        cuts.every((c) => Number(c.analysisPointsDuringCut) > 0) &&
        stored === generated && finalHistory.points === generated,
    };
    Object.assign(report, {
      elapsedMs,
      generated,
      achievedTicksPerSecond: (generated * 1000) / elapsedMs,
      noSubscriberOrSilentTicks: noSubscriber,
      injectedDuplicates: duplicateFrames,
      stored,
      analysisWindowPoints: finalHistory.points,
      missingGeneratedTicks: generated - stored,
      cache: cache.metrics,
      ingestion: status,
      recovery: service.getStatus().continuity,
      cuts,
      events,
      checks,
      defects: checks.mobileWindowContinuous
        ? []
        : [
            {
              id: "EPIC01-QA-001",
              summary:
                "No provider backfill: disconnected ticks are missing and the price window is reset.",
              reproduction:
                "npm run qa:epic01; observe analysisPointsDuringCut=0 and missingGeneratedTicks>0.",
              impact:
                "The ClickUp continuity criterion remains unmet. Redis retains already accepted ticks, but analysis/ATR require fresh complete windows.",
              required:
                "Implement a historical/replay recovery contract with the provider and re-run this scenario.",
            },
          ],
      limitations: [
        "Synthetic local QQQ only, no external credentials or production load claim.",
        "Latency is socket receipt to consumer completion, not exchange-to-device.",
        "p95 covers the last 512 successful deliveries; max and average cover this entire run.",
      ],
    });
    if (
      Object.entries(checks).some(
        ([key, value]) => key !== "mobileWindowContinuous" && !value,
      )
    )
      throw new Error("QA regression: see checks in the report");
    if (
      process.argv.includes("--strict-continuity") &&
      !checks.mobileWindowContinuous
    )
      throw new Error("EPIC01-QA-001: continuity criterion not met");
    if (!checks.mobileWindowContinuous) {
      console.warn(
        "EPIC01-QA-001 OPEN: connection recovered, but the analysis window and missed ticks were not recovered.",
      );
      if (process.env.GITHUB_ACTIONS === "true")
        console.warn(
          "::warning title=EPIC01-QA-001::Continuity acceptance criterion remains unmet; inspect epic01_metrics.json.",
        );
    }
    console.log(
      `QA completed; continuity=${checks.mobileWindowContinuous}; report=${path}`,
    );
  } catch (error) {
    if (app) report.recoveryAtFailure = app.get(MarketDataService).getStatus();
    report.failure = error instanceof Error ? error.message : "QA failed";
    throw error;
  } finally {
    clearInterval(producer);
    dashboard?.disconnect();
    if (app) {
      app.get(AtrService).stop();
      await app.get(MarketDataService).onModuleDestroy();
      await app.get(MarketDataWsClient).stop();
    }
    await mock.stop();
    if (cache?.getClient().status === "ready")
      await cache.getClient().del(...cache.keys("QQQ"));
    await app?.close();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2));
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "QA failed");
  process.exitCode = 1;
});
