import { AlpacaMockServer } from './alpaca-mock.server';
import { createTradeFixture } from './alpaca.fixtures';

async function main(): Promise<void> {
  const rawPort = process.env.MARKET_DATA_MOCK_PORT || '8765';
  if (!/^[1-9]\d*$/.test(rawPort)) throw new Error('Puerto inválido');
  const server = new AlpacaMockServer({ port: Number(rawPort) });
  const url = await server.start();
  console.log(`Mock Alpaca iniciado: ${url}; símbolo QQQ; datos sintéticos`);
  // A new local mock process must not reuse earlier IDs on the same UTC date.
  let id = Date.now() * 1000;
  const timer = setInterval(() => {
    id++;
    server.publish([
      createTradeFixture({
        i: id,
        p: 550 + (id % 20) / 100,
        t: new Date().toISOString(),
      }),
    ]);
  }, 250);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    server.stop().catch(() => {
      console.error('No se pudo cerrar el mock');
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(() => {
    console.error(
      'No se pudo iniciar el mock; verifica el puerto y su disponibilidad',
    );
    process.exitCode = 1;
  });
}
