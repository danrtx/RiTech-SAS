import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import type { MarketTick } from '../market-data/dto/market-tick.dto';
import type { PriceAlert } from '../market-data/dto/price-alert.dto';
import type { TickInvalidationReason } from '../market-data/ports/tick-consumer.interface';
import type { MarketDataFeed } from '../market-data/market-data.config';
import type { InvestmentUpdate } from '../hedging/investment-analysis.service';

export interface TelemetrySubscriptionDto {
  symbol: string; // e.g. 'NDX' or 'QQQ'
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'telemetry',
})
export class TelemetryGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Telemetry client connected: ${client.id}`);
    client.emit('connection_ack', {
      status: 'connected',
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Telemetry client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe_symbol')
  @UsePipes(new ValidationPipe())
  handleSubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TelemetrySubscriptionDto,
  ) {
    const room = `symbol:${data.symbol.toUpperCase()}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);

    client.emit('subscribed', {
      symbol: data.symbol.toUpperCase(),
      room,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('unsubscribe_symbol')
  handleUnsubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TelemetrySubscriptionDto,
  ) {
    const room = `symbol:${data.symbol.toUpperCase()}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
  }

  // Method called by MarketDataService or HedgingService to broadcast tick or alert
  broadcastTick(symbol: string, tick: Record<string, any>) {
    const room = `symbol:${symbol.toUpperCase()}`;
    this.server.to(room).emit('telemetry_tick', {
      symbol: symbol.toUpperCase(),
      ...tick,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastHedgingAlert(alert: Record<string, any>) {
    this.server.emit('hedging_alert', {
      ...alert,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastMarketTick(tick: MarketTick): void {
    this.server.to(`symbol:${tick.symbol}`).emit('telemetry_tick', {
      ...tick,
      timestamp: tick.eventTime,
      emittedAtMs: Date.now(),
    });
  }

  broadcastPriceAlert(alert: PriceAlert): void {
    this.server.to(`symbol:${alert.symbol}`).emit('price_alert', alert);
  }

  broadcastInvestmentUpdate(update: InvestmentUpdate): void {
    this.server.to(`symbol:${update.symbol}`).emit('investment_update', update);
  }

  broadcastMarketDataQuality(event: {
    symbol: string;
    feed: MarketDataFeed;
    reason: TickInvalidationReason;
    occurredAtMs: number;
  }): void {
    this.server
      ?.to(`symbol:${event.symbol}`)
      .emit('market_data_quality', event);
  }
}
