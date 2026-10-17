import { DynamicStopLoss } from "./dynamic-stop-loss";
import { StopLossService } from "./stop-loss.service";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";

describe("dynamic stop loss", () => {
  const sample = (price: number, eventTimeMs: number) => ({
    symbol: "QQQ",
    price,
    eventTimeMs,
  });
  it.each([
    [0.05, 300000, "SLOW"],
    [0.1, 60000, "INTERMEDIATE"],
    [0.3, 60000, "INTERMEDIATE"],
    [0.5, 60000, "INTERMEDIATE"],
    [0.6, 0, "FAST"],
  ])("rate %s triggers after %s ms with policy %s", (rate, delay, policy) => {
    const engine = new DynamicStopLoss();
    engine.accept(sample(100, 0), 0);
    const price = 100 - Number(rate) / 60;
    let results = engine.accept(sample(price, 1000), 1000);
    if (delay) {
      expect(results).toEqual([]);
      for (let t = 2000; t < 1000 + Number(delay); t += 1000)
        expect(engine.accept(sample(price, t), t)).toEqual([]);
      results = engine.accept(
        sample(price, 1000 + Number(delay)),
        1000 + Number(delay),
      );
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      policy,
      triggeredAtMs: 1000 + Number(delay),
    });
    expect(
      engine.accept(
        sample(price - 0.1, 2000 + Number(delay)),
        2000 + Number(delay),
      ),
    ).toEqual([]);
  });
  it("escalates slow falls immediately and rearms only on recovery", () => {
    const engine = new DynamicStopLoss();
    engine.accept(sample(100, 0), 0);
    expect(engine.accept(sample(99.999, 1000), 1000)).toEqual([]);
    expect(engine.accept(sample(99, 2000), 2000)[0].policy).toBe("FAST");
    expect(engine.accept(sample(98, 3000), 3000)).toEqual([]);
    engine.accept(sample(100, 4000), 4000);
    expect(engine.accept(sample(99, 5000), 5000)).toHaveLength(1);
  });
  it("cancels on recovery, missing data and explicit invalidation", () => {
    for (const reason of ["recovery", "gap", "reset"]) {
      const engine = new DynamicStopLoss();
      engine.accept(sample(100, 0), 0);
      engine.accept(sample(99.999, 1000), 1000);
      if (reason === "recovery") engine.accept(sample(100, 2000), 2000);
      if (reason === "reset") engine.reset();
      expect(engine.poll(301000)).toEqual([]);
    }
  });
  it("ignores duplicates, invalid prices, future timestamps and cross-symbol falls", () => {
    const engine = new DynamicStopLoss();
    engine.accept(sample(100, 1000), 1000);
    expect(engine.accept(sample(90, 1000), 1000)).toEqual([]);
    expect(engine.accept(sample(NaN, 1500), 1500)).toEqual([]);
    expect(
      engine.accept({ ...sample(1, 1500), symbol: "OTHER" }, 1500),
    ).toEqual([]);
    expect(engine.accept(sample(90, 3000), 2000)).toEqual([]);
  });
  it("queues outside ingestion and cancels queued work on invalidation", async () => {
    const broadcastHedgingAlert = jest.fn();
    const service = new StopLossService({
      broadcastHedgingAlert,
    } as unknown as TelemetryGateway);
    const now = Date.now();
    service.enqueue(sample(100, now - 1000));
    service.enqueue(sample(99, now));
    expect(broadcastHedgingAlert).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(broadcastHedgingAlert).toHaveBeenCalledTimes(1);
    service.enqueue(sample(100, now + 1));
    service.invalidate();
    service.onModuleDestroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(broadcastHedgingAlert).toHaveBeenCalledTimes(1);
  });
});
