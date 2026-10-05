import { parseMarketDataConfig } from '../market-data.config';
import { MarketDataConnectionError } from '../market-data.connection';
import { MarketDataWsClient } from '../market-data-ws.client';

/** Prueba de autenticación/suscripción, sin PostgreSQL, Redis ni decisiones. */
async function main(): Promise<void> {
  let client: MarketDataWsClient | undefined;
  try {
    const config = parseMarketDataConfig(process.env);
    if (!config.enabled) {
      console.error(
        'Activa MARKET_DATA_ENABLED=true para ejecutar la prueba de conexión',
      );
      process.exitCode = 1;
      return;
    }
    client = new MarketDataWsClient(config);
    await client.start();
    console.log(
      JSON.stringify({ event: 'market_data_probe_ok', ...client.getStatus() }),
    );
  } catch (error) {
    // También los errores de configuración se reducen a un motivo permitido.
    console.error(
      JSON.stringify({
        event: 'market_data_probe_failed',
        reason:
          error instanceof MarketDataConnectionError
            ? error.failure.reason
            : 'invalid_configuration',
      }),
    );
    process.exitCode = 1;
  } finally {
    await client?.onModuleDestroy();
  }
}

if (require.main === module) void main();
