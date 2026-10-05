import { MarketDataConnectionError } from './market-data.connection';
import { MarketDataService } from './market-data.service';
import { MarketDataWsClient } from './market-data-ws.client';

describe('Bootstrap del feed opcional', () => {
  it('conserva disponible el backend si la conexión falla', async () => {
    const failure = new MarketDataConnectionError({
      reason: 'transport_error',
      retryable: true,
    });
    const client = { start: jest.fn().mockRejectedValue(failure) };
    const service = new MarketDataService(
      client as unknown as MarketDataWsClient,
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(client.start).toHaveBeenCalledTimes(1);
  });
});
