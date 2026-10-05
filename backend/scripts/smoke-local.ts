import { NestFactory } from "@nestjs/core";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { io, Socket } from "socket.io-client";
import { AppModule } from "../src/app.module";
import { AtrService } from "../src/modules/atr/atr.service";
import { RedisCacheService } from "../src/modules/redis-cache/redis-cache.service";
import { IngestionState } from "../src/modules/market-data/ingestion.state";
import { MockFeedService } from "../src/modules/market-data/mock-feed.service";
import {
  MINUTE_MS,
  minuteStart,
} from "../src/modules/market-data/market.types";
import { MockProvider, waitUntil } from "../src/testing/mock-provider";

async function main() {
  const provider = new MockProvider();
  const prefix = `ritech:smoke:${randomUUID()}`;
  const minute = minuteStart(Date.now());
  process.env.TICK_KEY_PREFIX = prefix;
  process.env.ATR_SYMBOLS = "NDX";
  process.env.MOCK_FEED_URL = await provider.start();
  for (let i = 40; i > 0; i--) {
    provider.publish({
      id: `history:${i}:open`,
      symbol: "NDX",
      price: 100,
      volume: 1,
      eventTime: minute - i * MINUTE_MS,
    });
    provider.publish({
      id: `history:${i}:close`,
      symbol: "NDX",
      price: i === 1 ? 120 : 101,
      volume: 1,
      eventTime: minute - i * MINUTE_MS + 30000,
    });
  }
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    abortOnError: false,
  }).catch(async (error: unknown) => {
    await provider.stop();
    throw error;
  });
  let client: Socket | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const reportPath =
    process.env.QA_SMOKE_REPORT_PATH ??
    join(__dirname, "../../../reportes/atr_engine/smoke_metrics.json");
  try {
    await app.listen(0, "127.0.0.1");
    await waitUntil(() => !app.get(IngestionState).recovering, 10000);
    const atr = app.get(AtrService);
    await atr.runCycle();
    const base = await app.getUrl();
    const health = await fetch(`${base}/health`);
    if (!health.ok) throw new Error("Health failed");
    const snapshot = await fetch(`${base}/atr`);
    if (!snapshot.ok) throw new Error("ATR endpoint failed");
    const results = atr.snapshot().results;
    if (results[0]?.status !== "ready" || !results[0].alert)
      throw new Error("Warm-up/alert smoke failed");
    client = io(`${base}/telemetry`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    const replay = new Promise((resolve) =>
      client!.once("atr_result", resolve),
    );
    client.emit("subscribe_symbol", { symbol: "NDX" });
    await replay;
    let live = 0;
    client.on("telemetry_tick", () => {
      live++;
    });
    let sequence = 0;
    timer = setInterval(
      () =>
        provider.publish({
          id: `live:${sequence++}`,
          symbol: "NDX",
          price: 102,
          volume: 1,
          eventTime: Date.now(),
        }),
      100,
    );
    await waitUntil(() => live >= 2);
    if (process.argv.includes("--flutter")) {
      const flutter = process.env.FLUTTER_EXECUTABLE ?? "flutter";
      const args = [
        "test",
        "test/telemetry_live_test.dart",
        `--dart-define=TELEMETRY_TEST_URL=${base}/telemetry`,
      ];
      await new Promise<void>((resolve, reject) => {
        const windows = process.platform === "win32";
        const child = spawn(
          windows ? "powershell.exe" : flutter,
          windows
            ? [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                '& $env:RITECH_FLUTTER test test/telemetry_live_test.dart "--dart-define=TELEMETRY_TEST_URL=$env:RITECH_TEST_URL"; exit $LASTEXITCODE',
              ]
            : args,
          {
            cwd: join(__dirname, "../../frontend_mobile"),
            stdio: "inherit",
            windowsHide: true,
            env: {
              ...process.env,
              RITECH_FLUTTER: flutter,
              RITECH_TEST_URL: `${base}/telemetry`,
            },
          },
        );
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Flutter live test exited ${code}`)),
        );
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      health: await health.json(),
      atr: results[0],
      ticksReceived: live,
      flutterLiveClient: process.argv.includes("--flutter"),
      scope:
        "Local synthetic feed, full NestJS AppModule, Redis, PostgreSQL, HTTP and Socket.IO",
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Smoke passed; evidence: ${reportPath}`);
  } finally {
    if (timer) clearInterval(timer);
    client?.disconnect();
    app.get(AtrService).stop();
    await app.get(MockFeedService).onModuleDestroy();
    await provider.stop();
    const cache = app.get(RedisCacheService);
    if (cache.getClient()?.status === "ready")
      await cache.getClient().del(...cache.keys("NDX"));
    await app.close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Smoke failed");
  process.exitCode = 1;
});
