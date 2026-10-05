import { randomUUID } from "crypto";
import { MockProvider } from "../src/testing/mock-provider";
import {
  MINUTE_MS,
  minuteStart,
} from "../src/modules/market-data/market.types";

async function main() {
  const provider = new MockProvider();
  const run = randomUUID();
  const symbols = (process.env.ATR_SYMBOLS ?? "NDX,QQQ,AAPL,NVDA")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const now = minuteStart(Date.now());
  // Populate warm-up history before clients subscribe. Current minute stays live.
  for (let minute = 40; minute > 0; minute--)
    for (const symbol of symbols) {
      for (const [second, price] of [
        [0, 100],
        [30, minute === 1 ? 120 : 101],
      ]) {
        provider.publish({
          id: `${run}:${symbol}:${minute}:${second}`,
          symbol,
          price,
          volume: 1,
          eventTime: now - minute * MINUTE_MS + second * 1000,
        });
      }
    }
  const url = await provider.start(Number(process.env.MOCK_FEED_PORT ?? 4100));
  console.log(
    `Synthetic provider: ${url}. Start backend with MOCK_FEED_URL=${url}`,
  );
  let sequence = 0;
  const timer = setInterval(() => {
    for (const symbol of symbols)
      provider.publish({
        id: `${run}:live:${sequence++}`,
        symbol,
        price: 100 + (sequence % 10) / 10,
        volume: 1,
        eventTime: Date.now(),
      });
  }, 1000);
  const stop = async () => {
    clearInterval(timer);
    await provider.stop();
  };
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Mock failed");
  process.exitCode = 1;
});
