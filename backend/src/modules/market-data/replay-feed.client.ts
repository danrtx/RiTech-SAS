import { WebSocket } from "ws";
import { IngestionState } from "./ingestion.state";
import { AppendResult, MarketClock, Tick } from "./market.types";

export interface ReplayFeedOptions {
  url: string;
  reconnectMs: number;
  maxPending: number;
  handshakeTimeoutMs: number;
}
/** Development/test wire protocol. Real providers need a separate adapter. */
export class ReplayFeedClient {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private generation = 0;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();
  private lastOffset = 0;
  private disconnectedAt?: number;
  readonly metrics = {
    connections: 0,
    recoveriesMs: [] as number[],
    accepted: 0,
    discarded: 0,
    duplicate: 0,
    errors: 0,
    maxPending: 0,
    latenciesMs: [] as number[],
  };
  constructor(
    private readonly options: ReplayFeedOptions,
    private readonly clock: MarketClock,
    private readonly state: IngestionState,
    private readonly consume: (
      tick: Omit<Tick, "receivedAt">,
    ) => Promise<AppendResult>,
  ) {
    if (
      !Number.isFinite(options.reconnectMs) ||
      options.reconnectMs < 0 ||
      options.maxPending < 1 ||
      options.handshakeTimeoutMs < 1
    )
      throw new Error("Invalid feed options");
  }
  start() {
    if (this.stopped) {
      this.stopped = false;
      this.connect();
    }
  }
  private connect() {
    if (this.stopped) return;
    this.state.beginRecovery();
    const generation = ++this.generation;
    const socket = new WebSocket(this.options.url, {
      handshakeTimeout: this.options.handshakeTimeoutMs,
      maxPayload: 64 * 1024,
    });
    this.socket = socket;
    this.deadline = setTimeout(
      () => socket.terminate(),
      this.options.handshakeTimeoutMs,
    );
    socket.on("open", () => {
      this.metrics.connections++;
      socket.send(JSON.stringify({ type: "resume", after: this.lastOffset }));
    });
    socket.on("message", (bytes) => {
      if (generation !== this.generation || this.stopped) return;
      if (this.pending >= this.options.maxPending) {
        this.metrics.errors++;
        socket.terminate();
        return;
      }
      this.pending++;
      this.metrics.maxPending = Math.max(this.metrics.maxPending, this.pending);
      const received = this.clock.monotonic();
      const payload = bytes.toString();
      this.queue = this.queue
        .then(async () => {
          if (generation !== this.generation || this.stopped) return;
          const frame: unknown = JSON.parse(payload);
          if (!frame || typeof frame !== "object")
            throw new Error("Invalid frame");
          const message = frame as {
            type?: string;
            offset?: number;
            through?: number;
            tick?: Omit<Tick, "receivedAt">;
          };
          if (message.type === "ready") {
            if (
              !Number.isSafeInteger(message.through) ||
              message.through !== this.lastOffset
            )
              throw new Error("Incomplete replay");
            if (this.deadline) clearTimeout(this.deadline);
            this.state.recovered();
            if (this.disconnectedAt !== undefined) {
              this.metrics.recoveriesMs.push(
                this.clock.monotonic() - this.disconnectedAt,
              );
              this.disconnectedAt = undefined;
            }
            return;
          }
          if (
            message.type !== "tick" ||
            !Number.isSafeInteger(message.offset) ||
            message.offset! < 1 ||
            message.offset! > this.lastOffset + 1 ||
            !message.tick
          )
            throw new Error("Invalid tick sequence");
          const result = await this.consume(message.tick);
          if (result.accepted) this.metrics.accepted++;
          else if (result.reason === "duplicate") this.metrics.duplicate++;
          else this.metrics.discarded++;
          // Bound latency samples; this is diagnostics, not an unbounded event log.
          if (this.metrics.latenciesMs.length >= 10000)
            this.metrics.latenciesMs.shift();
          this.metrics.latenciesMs.push(this.clock.monotonic() - received);
          if (generation === this.generation && !this.stopped)
            this.lastOffset = Math.max(this.lastOffset, message.offset!);
        })
        .catch(() => {
          this.metrics.errors++;
          socket.terminate();
        })
        .finally(() => {
          this.pending--;
        });
    });
    socket.on("error", () => {
      this.metrics.errors++;
    });
    socket.on("close", () => {
      if (generation !== this.generation || this.stopped) return;
      this.generation++;
      this.state.beginRecovery();
      if (this.deadline) clearTimeout(this.deadline);
      this.disconnectedAt ??= this.clock.monotonic();
      this.retry = setTimeout(() => this.connect(), this.options.reconnectMs);
    });
  }
  async drain() {
    await this.queue;
  }
  async stop() {
    this.stopped = true;
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    if (this.deadline) clearTimeout(this.deadline);
    this.socket?.terminate();
    await this.queue;
  }
}
