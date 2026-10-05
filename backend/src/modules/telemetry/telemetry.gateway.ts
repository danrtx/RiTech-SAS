import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, UsePipes, ValidationPipe } from "@nestjs/common";
import { IsString, Matches } from "class-validator";
import { AtrResult, MarketClock, Tick } from "../market-data/market.types";
import { AtrConfig } from "../atr/atr.config";
import type { MarketTick } from '../market-data/dto/market-tick.dto';
import type { PriceAlert } from '../market-data/dto/price-alert.dto';
import type { TickInvalidationReason } from '../market-data/ports/tick-consumer.interface';
import type { MarketDataFeed } from '../market-data/market-data.config';
import type { InvestmentUpdate } from '../hedging/investment-analysis.service';

export class TelemetrySubscriptionDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{1,32}$/)
  symbol: string; // e.g. 'NDX' or 'QQQ'
}

@WebSocketGateway({
  cors: {
    origin: "*",
  },
  namespace: "telemetry",
})
export class TelemetryGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);
  private readonly latestAtr = new Map<string, AtrResult>();
  constructor(
    private readonly clock: MarketClock,
    private readonly config: AtrConfig,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Telemetry client connected: ${client.id}`);
    client.emit("connection_ack", {
      status: "connected",
      timestamp: new Date(this.clock.now()).toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Telemetry client disconnected: ${client.id}`);
  }

  @SubscribeMessage("subscribe_symbol")
  @UsePipes(new ValidationPipe())
  handleSubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TelemetrySubscriptionDto,
  ) {
    if (!this.config.options.symbols.includes(data.symbol.toUpperCase()))
      return;
    const room = `symbol:${data.symbol.toUpperCase()}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);

    client.emit("subscribed", {
      symbol: data.symbol.toUpperCase(),
      room,
      timestamp: new Date(this.clock.now()).toISOString(),
    });
    const latest = this.latestAtr.get(data.symbol.toUpperCase());
    if (latest) client.emit("atr_result", latest);
  }

  @SubscribeMessage("unsubscribe_symbol")
  @UsePipes(new ValidationPipe())
  handleUnsubscribeSymbol(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TelemetrySubscriptionDto,
  ) {
    const room = `symbol:${data.symbol.toUpperCase()}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
  }

  // Method called by MarketDataService or HedgingService to broadcast tick or alert
  broadcastTick(symbol: string, tick: Tick) {
    const room = `symbol:${symbol.toUpperCase()}`;
    this.server?.to(room).emit("telemetry_tick", {
      ...tick,
      symbol: symbol.toUpperCase(),
      timestamp: new Date(tick.eventTime).toISOString(),
      emittedAt: this.clock.now(),
    });
  }

  broadcastHedgingAlert(alert: Record<string, unknown>) {
    this.server?.emit("hedging_alert", {
      ...alert,
      emittedAt: this.clock.now(),
    });
  }

  broadcastAtr(result: AtrResult) {
    this.latestAtr.set(result.symbol, result);
    this.server?.to(`symbol:${result.symbol}`).emit("atr_result", result);
    if (result.alert)
      this.server
        ?.to(`symbol:${result.symbol}`)
        .emit("volatility_alert", result);
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
