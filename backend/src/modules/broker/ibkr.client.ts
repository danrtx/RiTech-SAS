import { Injectable } from "@nestjs/common";

export interface IocOrder {
  correlationId: string;
  conid: number;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
}
export type OrderState =
  | "SUBMITTING"
  | "ACCEPTED"
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "UNKNOWN"
  | "CONFIRMATION_REQUIRED";
export interface BrokerResult {
  state: OrderState;
  brokerOrderId?: string;
  reason: string;
  retryAfterMs?: number;
}

export function mapStatus(status: unknown): OrderState {
  switch (status) {
    case "Submitted":
    case "PreSubmitted":
    case "PendingSubmit":
      return "ACCEPTED";
    case "Filled":
      return "FILLED";
    case "PartiallyFilled":
      return "PARTIALLY_FILLED";
    case "Cancelled":
    case "ApiCancelled":
      return "CANCELLED";
    case "Expired":
      return "EXPIRED";
    case "Inactive":
    case "Rejected":
      return "REJECTED";
    default:
      return "UNKNOWN";
  }
}

/** Client Portal Gateway owns login/MFA; credentials never enter order payloads. */
@Injectable()
export class IbkrClient {
  readonly account: string;
  private readonly base: string;
  constructor() {
    this.account = process.env.IBKR_PAPER_ACCOUNT || "";
    this.base = process.env.IBKR_GATEWAY_URL || "https://localhost:5000/v1/api";
    if (process.env.EXECUTION_MODE === "ibkr-paper") {
      const url = new URL(this.base);
      if (
        !/^DU\d+$/.test(this.account) ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ) {
        throw new Error(
          "IBKR requires a DU paper account and a local HTTPS Gateway",
        );
      }
    }
  }
  private request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.base.replace(/\/$/, "")}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json" },
    });
  }
  async preflight(): Promise<void> {
    const auth = await this.request("/iserver/auth/status", { method: "POST" });
    if (!auth.ok) throw new Error("IBKR authentication unavailable");
    const session = await auth.json();
    if (
      session.authenticated !== true ||
      session.connected !== true ||
      session.competing === true
    )
      throw new Error("IBKR authenticated session required");
    const response = await this.request("/iserver/accounts");
    if (!response.ok) throw new Error("IBKR accounts unavailable");
    const accounts = await response.json();
    if (
      !Array.isArray(accounts.accounts) ||
      !accounts.accounts.includes(this.account)
    )
      throw new Error("Configured paper account is unavailable");
  }
  async submit(order: IocOrder, clientId: string): Promise<BrokerResult> {
    try {
      const response = await this.request(
        `/iserver/account/${this.account}/orders`,
        {
          method: "POST",
          body: JSON.stringify({
            orders: [
              {
                acctId: this.account,
                conid: order.conid,
                cOID: clientId,
                orderType: "LMT",
                tif: "IOC",
                side: order.side,
                quantity: order.quantity,
                price: order.limitPrice,
                outsideRTH: false,
              },
            ],
          }),
        },
      );
      // Only explicit throttling can be resubmitted. 5xx/timeouts are ambiguous.
      if (response.status === 429) {
        const raw = response.headers.get("retry-after");
        const seconds = raw === null ? NaN : Number(raw);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(raw || "") - Date.now();
        return {
          state: "REJECTED",
          reason: "RATE_LIMIT",
          retryAfterMs: Number.isFinite(delay) ? Math.max(1000, delay) : 10000,
        };
      }
      if (response.status >= 500)
        return { state: "UNKNOWN", reason: "BROKER_UNAVAILABLE" };
      if (!response.ok)
        return { state: "REJECTED", reason: `HTTP_${response.status}` };
      const payload = await response.json();
      const item = Array.isArray(payload) ? payload[0] : payload;
      if (item?.order_id !== undefined)
        return {
          state: mapStatus(item.order_status),
          brokerOrderId: String(item.order_id),
          reason: "BROKER_RESPONSE",
        };
      if (item?.id && item?.message)
        return { state: "CONFIRMATION_REQUIRED", reason: "BROKER_WARNING" };
      if (typeof item?.error === "string")
        return { state: "REJECTED", reason: "BROKER_REJECTION" };
      return { state: "UNKNOWN", reason: "INVALID_RESPONSE" };
    } catch {
      return { state: "UNKNOWN", reason: "NETWORK_OR_RESPONSE_ERROR" };
    }
  }
  async status(id: string): Promise<BrokerResult> {
    try {
      const response = await this.request(
        `/iserver/account/order/status/${encodeURIComponent(id)}`,
      );
      if (!response.ok)
        return { state: "UNKNOWN", reason: "STATUS_UNAVAILABLE" };
      const body = await response.json();
      return {
        state: mapStatus(body.order_status),
        brokerOrderId: id,
        reason: "STATUS_RESPONSE",
      };
    } catch {
      return { state: "UNKNOWN", reason: "STATUS_UNAVAILABLE" };
    }
  }
}
