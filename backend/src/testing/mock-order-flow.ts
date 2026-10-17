import { StopLossTrigger } from "../modules/hedging/dynamic-stop-loss";

export interface MockOrder {
  clientOrderId: string;
  symbol: string;
  side: "sell";
  quantity: number;
  timeInForce: "ioc";
  submittedAtMs: number;
}
export interface MockReceipt {
  clientOrderId: string;
  status: "accepted" | "rejected";
  retryable?: boolean;
  acceptedAtMs?: number;
}

/** Test contract only: never configure this harness against a live broker. */
export class MockOrderFlow {
  private readonly jobs = new Map<string, Promise<Record<string, unknown>>>();
  constructor(
    private readonly brokerUrl: string,
    private readonly notify: (
      event: Record<string, unknown>,
    ) => Promise<boolean>,
    private readonly timeoutMs = 100,
  ) {
    const url = new URL(brokerUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("Mock broker must be loopback HTTP");
  }

  run(trigger: StopLossTrigger): Promise<Record<string, unknown>> {
    const existing = this.jobs.get(trigger.correlationId);
    if (existing) return existing;
    const job = this.execute(trigger);
    this.jobs.set(trigger.correlationId, job);
    return job;
  }

  private async request(
    path: string,
    order?: MockOrder,
  ): Promise<MockReceipt | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.brokerUrl + path, {
        method: order ? "POST" : "GET",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: order ? JSON.stringify(order) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("mock_broker_http_error");
      return (await response.json()) as MockReceipt;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async execute(
    trigger: StopLossTrigger,
  ): Promise<Record<string, unknown>> {
    const order: MockOrder = {
      clientOrderId: trigger.correlationId,
      symbol: trigger.symbol,
      side: "sell",
      quantity: 1,
      timeInForce: "ioc",
      submittedAtMs: Date.now(),
    };
    let receipt: MockReceipt | undefined;
    let attempts = 0;
    for (; attempts < 2;) {
      attempts++;
      try {
        receipt = await this.request("/orders", order);
      } catch {
        // An uncertain POST is reconciled, never blindly submitted again.
        try {
          receipt = await this.request(
            `/orders/${encodeURIComponent(order.clientOrderId)}`,
          );
        } catch {
          break;
        }
      }
      if (!receipt || receipt.clientOrderId !== order.clientOrderId) {
        receipt = undefined;
        break;
      }
      if (receipt.status !== "rejected" || !receipt.retryable) break;
    }
    const event = {
      schemaVersion: 1,
      simulated: true,
      correlationId: trigger.correlationId,
      symbol: trigger.symbol,
      trigger,
      order,
      receipt,
      status: receipt?.status ?? "unknown",
      attempts,
      notifiedAtMs: Date.now(),
    };
    const delivered = await this.notify(event);
    return { ...event, notification: delivered ? "DELIVERED" : "NO_DEVICE" };
  }
}
