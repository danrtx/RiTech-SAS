import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BrokerStore } from "./broker.store";
import { IbkrClient, IocOrder } from "./ibkr.client";

@Injectable()
export class IocExecutionService {
  constructor(
    private readonly broker: IbkrClient,
    private readonly store: BrokerStore,
  ) {}
  async execute(order: IocOrder) {
    if (process.env.EXECUTION_MODE !== "ibkr-paper")
      throw new Error("IBKR paper execution disabled");
    if (
      !/^[\w.-]{1,128}$/.test(order.correlationId) ||
      !Number.isSafeInteger(order.conid) ||
      order.conid <= 0 ||
      !["BUY", "SELL"].includes(order.side) ||
      !Number.isSafeInteger(order.quantity) ||
      order.quantity <= 0 ||
      !Number.isFinite(order.limitPrice) ||
      order.limitPrice <= 0
    )
      throw new Error("Invalid IOC order");
    // A copy prevents caller mutation during network/database awaits.
    order = {
      correlationId: order.correlationId,
      conid: order.conid,
      side: order.side,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
    };
    const id = createHash("sha256")
      .update(`${this.broker.account}:${order.correlationId}`)
      .digest("hex")
      .slice(0, 32);
    await this.broker.preflight();
    if (!(await this.store.claim(id, this.broker.account, order))) {
      const existing = await this.store.read(id);
      if (
        !existing ||
        Object.keys(order).some((key) => existing.request[key] !== order[key])
      )
        throw new Error("Idempotency key already used for another order");
      return existing;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Durable intent BEFORE every POST. A crash leaves SUBMITTING for manual reconciliation.
      await this.store.record(
        id,
        { state: "SUBMITTING", reason: "SEND_INTENT" },
        attempt,
      );
      const result = await this.broker.submit(order, id);
      await this.store.record(id, result, attempt);
      if (
        result.reason !== "RATE_LIMIT" ||
        attempt === 3 ||
        (result.retryAfterMs || 0) > 30000
      )
        break;
      await delay(
        Math.max(result.retryAfterMs || 0, 1000 * 2 ** (attempt - 1)),
      );
    }
    return this.store.read(id);
  }
  /** Read-only broker reconciliation: never resubmit an accepted or ambiguous order. */
  async refresh(clientId: string) {
    if (process.env.EXECUTION_MODE !== "ibkr-paper")
      throw new Error("IBKR paper execution disabled");
    const row = await this.store.read(clientId);
    if (!row || row.account !== this.broker.account)
      throw new Error("Unknown paper order");
    if (
      !row.broker_order_id ||
      ["FILLED", "REJECTED", "EXPIRED", "CANCELLED"].includes(row.state)
    )
      return row;
    await this.broker.preflight();
    const result = await this.broker.status(row.broker_order_id);
    // An unavailable status must not overwrite a known broker state.
    if (result.state !== "UNKNOWN")
      await this.store.record(clientId, result, 0);
    return this.store.read(clientId);
  }
}
