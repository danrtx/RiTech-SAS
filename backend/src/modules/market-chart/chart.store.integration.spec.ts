import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { MarketChartArchive1791345600000 } from "../database/migrations/1791345600000-MarketChartArchive";
import { ChartStore } from "./chart.store";

const integration =
  process.env.RUN_CHART_DB_TESTS === "1" ? describe : describe.skip;
integration("PostgreSQL chart archive", () => {
  let admin: DataSource;
  let db: DataSource;
  let store: ChartStore;
  const schema = `chart_test_${randomUUID().replace(/-/g, "")}`;
  const start = Date.parse("2026-10-07T14:00:00Z");
  const options = () => ({
    type: "postgres" as const,
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? 5433),
    username: process.env.DB_USER ?? process.env.POSTGRES_USER ?? "ritech",
    password:
      process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? "ritech_dev",
    database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? "ritech",
  });
  const connect = async () => {
    db = await new DataSource({
      ...options(),
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    store = new ChartStore(db);
  };
  beforeAll(async () => {
    admin = await new DataSource(options()).initialize();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await connect();
    const runner = db.createQueryRunner();
    try {
      await new MarketChartArchive1791345600000().up(runner);
    } finally {
      await runner.release();
    }
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.destroy();
    }
  });
  it("persists ordered OHLC, handles duplicates, isolates dates and survives reconnecting to the DB", async () => {
    const tick = {
      id: randomUUID(),
      symbol: "QQQ",
      price: 102,
      eventTimeMs: start + 20_000,
      receivedAtMs: start + 22_000,
    };
    await store.record(tick);
    await store.record(tick);
    await store.record({
      ...tick,
      id: randomUUID(),
      price: 99,
      eventTimeMs: start + 1000,
    });
    await store.record({
      ...tick,
      id: randomUUID(),
      price: 104,
      eventTimeMs: start + 45_000,
    });
    const candles = await store.day("QQQ", "2026-10-07");
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: 99,
      high: 104,
      low: 99,
      close: 104,
      volume: null,
      observations: 3,
      source: "stream",
    });
    expect(await store.day("QQQ", "2026-10-06")).toEqual([]);
    await db.destroy();
    await connect();
    expect(await store.day("QQQ", "2026-10-07")).toEqual(candles);
    expect(await store.dates("QQQ")).toEqual(["2026-10-07"]);
  });
  it("reconciles provider OHLC without allowing a late sampled tick to corrupt it", async () => {
    const bar = {
      startTimeMs: start,
      open: 98,
      high: 106,
      low: 97,
      close: 105,
      volume: 400,
    };
    await store.importBars("QQQ", [bar]);
    await store.importBars("QQQ", [bar]);
    await store.record({
      id: randomUUID(),
      symbol: "QQQ",
      price: 103,
      eventTimeMs: start + 59_000,
      receivedAtMs: start + 60_000,
    });
    const candles = await store.day("QQQ", "2026-10-07");
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: 98,
      high: 106,
      low: 97,
      close: 105,
      volume: 400,
      source: "provider_ohlc",
      observations: 4,
    });
    const rows = await db.query(
      "SELECT count(*)::int AS count FROM market_chart_observations",
    );
    expect(rows[0].count).toBe(4);
  });
  it("rolls back the observation when candle persistence fails", async () => {
    const runner = db.createQueryRunner();
    await runner.query(
      `ALTER TABLE market_chart_candles ADD CONSTRAINT reject_test_price CHECK (high < 1000)`,
    );
    try {
      await expect(
        store.record({
          id: randomUUID(),
          symbol: "QQQ",
          price: 1001,
          eventTimeMs: start + 120_000,
          receivedAtMs: start + 120_001,
        }),
      ).rejects.toThrow();
      const rows = await db.query(
        "SELECT count(*)::int AS count FROM market_chart_observations WHERE price = 1001",
      );
      expect(rows[0].count).toBe(0);
    } finally {
      await runner.query(
        "ALTER TABLE market_chart_candles DROP CONSTRAINT reject_test_price",
      );
      await runner.release();
    }
  });
});
