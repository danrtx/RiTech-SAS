import { IocExecutionService } from "./ioc-execution.service";
import { IbkrClient } from "./ibkr.client";
import { BrokerStore } from "./broker.store";

const order = {
  correlationId: "hedge-1",
  conid: 123,
  side: "SELL" as const,
  quantity: 2,
  limitPrice: 100,
};
describe("IOC durable execution", () => {
  const env = { ...process.env };
  let row: any;
  let broker: any;
  let store: any;
  let service: IocExecutionService;
  beforeEach(() => {
    process.env.EXECUTION_MODE = "ibkr-paper";
    row = undefined;
    broker = {
      account: "DU123",
      preflight: jest.fn().mockResolvedValue(undefined),
      submit: jest
        .fn()
        .mockResolvedValue({
          state: "ACCEPTED",
          brokerOrderId: "42",
          reason: "BROKER_RESPONSE",
        }),
      status: jest
        .fn()
        .mockResolvedValue({ state: "EXPIRED", reason: "STATUS_RESPONSE" }),
    };
    store = {
      claim: jest.fn(async (id, account, request) => {
        if (row) return false;
        row = { client_id: id, account, request, state: "SUBMITTING" };
        return true;
      }),
      read: jest.fn(async () => row),
      record: jest.fn(async (_id, result) => {
        row.state = result.state;
        row.broker_order_id = result.brokerOrderId || row.broker_order_id;
      }),
    };
    service = new IocExecutionService(
      broker as IbkrClient,
      store as BrokerStore,
    );
  });
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });
  it("claims concurrent duplicates once, including service restart", async () => {
    await Promise.all([service.execute(order), service.execute(order)]);
    await new IocExecutionService(broker, store).execute(order);
    expect(broker.submit).toHaveBeenCalledTimes(1);
  });
  it("rejects changed payload under the same correlation", async () => {
    await service.execute(order);
    await expect(service.execute({ ...order, quantity: 3 })).rejects.toThrow(
      "Idempotency",
    );
    expect(broker.submit).toHaveBeenCalledTimes(1);
  });
  it("limits throttling to three attempts with the same ID", async () => {
    jest.useFakeTimers();
    broker.submit.mockResolvedValue({
      state: "REJECTED",
      reason: "RATE_LIMIT",
      retryAfterMs: 1000,
    });
    const pending = service.execute(order);
    await jest.runAllTimersAsync();
    await pending;
    expect(broker.submit).toHaveBeenCalledTimes(3);
    expect(new Set(broker.submit.mock.calls.map((call) => call[1])).size).toBe(
      1,
    );
    expect(store.record).toHaveBeenCalledTimes(6);
  });
  it.each(["UNKNOWN", "REJECTED", "CONFIRMATION_REQUIRED", "EXPIRED"])(
    "never resends %s",
    async (state) => {
      broker.submit.mockResolvedValue({ state, reason: "BROKER_RESPONSE" });
      await service.execute(order);
      await service.execute(order);
      expect(broker.submit).toHaveBeenCalledTimes(1);
    },
  );
  it("does not submit without durable intent", async () => {
    store.record.mockRejectedValue(new Error("database down"));
    await expect(service.execute(order)).rejects.toThrow();
    expect(broker.submit).not.toHaveBeenCalled();
  });
  it("honors a long Retry-After by stopping retries", async () => {
    broker.submit.mockResolvedValue({
      state: "REJECTED",
      reason: "RATE_LIMIT",
      retryAfterMs: 60000,
    });
    await service.execute(order);
    expect(broker.submit).toHaveBeenCalledTimes(1);
  });
  it("refreshes expiration without another order", async () => {
    await service.execute(order);
    expect((await service.refresh(row.client_id)).state).toBe("EXPIRED");
    expect(broker.submit).toHaveBeenCalledTimes(1);
  });
  it("fails closed when disabled or quantity is invalid", async () => {
    await expect(service.execute({ ...order, quantity: 0 })).rejects.toThrow();
    process.env.EXECUTION_MODE = "paper";
    await expect(service.execute(order)).rejects.toThrow("disabled");
    expect(broker.submit).not.toHaveBeenCalled();
  });
});
