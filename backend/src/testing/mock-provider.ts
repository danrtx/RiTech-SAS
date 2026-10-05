import { once } from "events";
import { WebSocket, WebSocketServer } from "ws";
import { Tick } from "../modules/market-data/market.types";

/** Loopback-only deterministic provider with retained replay and intentional overlap. */
export class MockProvider {
  private readonly history: Array<{
    type: "tick";
    offset: number;
    tick: Omit<Tick, "receivedAt">;
  }> = [];
  private readonly subscribed = new Set<WebSocket>();
  private server?: WebSocketServer;
  async start(port = 0): Promise<string> {
    this.server = new WebSocketServer({ host: "127.0.0.1", port });
    this.server.on("connection", (socket) => {
      socket.on("error", () => undefined);
      socket.on("close", () => this.subscribed.delete(socket));
      socket.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString()) as {
            type?: string;
            after?: number;
          };
          if (
            message.type !== "resume" ||
            !Number.isSafeInteger(message.after) ||
            message.after! < 0 ||
            message.after! > this.history.length
          ) {
            socket.close(1008);
            return;
          }
          for (const tick of this.history.slice(
            Math.max(0, message.after! - 2),
          ))
            socket.send(JSON.stringify(tick));
          socket.send(
            JSON.stringify({ type: "ready", through: this.history.length }),
          );
          this.subscribed.add(socket);
        } catch {
          socket.close(1008);
        }
      });
    });
    await once(this.server, "listening");
    const address = this.server.address();
    if (typeof address === "string" || address === null)
      throw new Error("Missing mock address");
    return `ws://127.0.0.1:${address.port}`;
  }
  publish(tick: Omit<Tick, "receivedAt">) {
    if (this.history.length >= 100_000)
      throw new Error("Mock history limit reached; restart the scenario");
    const frame = {
      type: "tick" as const,
      offset: this.history.length + 1,
      tick,
    };
    this.history.push(frame);
    for (const socket of this.subscribed)
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(frame));
  }
  disconnectClients() {
    for (const socket of this.server?.clients ?? []) socket.terminate();
  }
  async stop() {
    this.disconnectClients();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("Scenario timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
export function percentiles(samples: number[]) {
  const values = [...samples].sort((a, b) => a - b);
  const at = (percent: number) =>
    values[Math.max(0, Math.ceil(values.length * percent) - 1)] ?? 0;
  return { count: values.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}
