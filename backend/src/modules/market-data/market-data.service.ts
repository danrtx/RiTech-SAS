import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { MarketDataWsClient } from './market-data-ws.client';

@Injectable()
export class MarketDataService implements OnApplicationBootstrap {
  constructor(private readonly client: MarketDataWsClient) {}

  async onApplicationBootstrap(): Promise<void> {
    // Feed opcional: un fallo deja estado FAILED/DEGRADED y no impide servir HTTP.
    // El cliente ya registra el motivo seguro; no propagar stacks al bootstrap.
    await this.client.start().catch(() => undefined);
  }
}
