import { TwelveDataMockServer } from './twelve-data-mock.server';

async function main(): Promise<void> {
  const port = Number(process.env.MARKET_DATA_MOCK_PORT ?? 8765);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('invalid_mock_port');
  const mock = new TwelveDataMockServer({ port });
  await mock.start();
  console.log(
    `Twelve Data mock QQQ activo en ws://127.0.0.1:${port}/v2/mock (precios sintéticos)`,
  );
  let step = 0;
  const timer = setInterval(
    () => mock.publish(100 + Math.sin(step++ / 10) * 3),
    500,
  );
  const shutdown = async () => {
    clearInterval(timer);
    await mock.stop();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (require.main === module)
  void main().catch(() => {
    console.error('twelve_data_mock_failed');
    process.exitCode = 1;
  });
