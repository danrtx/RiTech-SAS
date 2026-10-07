import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  ChartCandle,
  ChartObservation,
  HistoricalBar,
  MINUTE,
  sessionDate,
  sessionTime,
} from "./chart.types";

@Injectable()
export class ChartStore {
  constructor(private readonly db: DataSource) {}

  /** Tick and OHLC are committed together. Retrying an id is idempotent. */
  async record(tick: ChartObservation): Promise<ChartCandle | undefined> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query(
        `
        INSERT INTO market_chart_observations
          (id, symbol, provider, event_time, received_at, session_date, price)
        VALUES ($1, $2, 'twelvedata', $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          tick.id,
          tick.symbol,
          new Date(tick.eventTimeMs),
          new Date(tick.receivedAtMs),
          sessionDate(tick.eventTimeMs),
          tick.price,
        ],
      );
      if (!inserted.length) return;
      const rows = await tx.query(
        `
        INSERT INTO market_chart_candles AS c
          (symbol, provider, start_time, session_date, open, high, low, close, first_event_at, last_event_at, observations, source)
        VALUES ($1, 'twelvedata', $2, $3, $4, $4, $4, $4, $5, $5, 1, 'stream')
        ON CONFLICT (symbol, provider, start_time) DO UPDATE SET
          open = CASE WHEN c.source = 'stream' AND EXCLUDED.first_event_at < c.first_event_at THEN EXCLUDED.open ELSE c.open END,
          high = CASE WHEN c.source = 'stream' THEN GREATEST(c.high, EXCLUDED.high) ELSE c.high END,
          low = CASE WHEN c.source = 'stream' THEN LEAST(c.low, EXCLUDED.low) ELSE c.low END,
          close = CASE WHEN c.source = 'stream' AND EXCLUDED.last_event_at >= c.last_event_at THEN EXCLUDED.close ELSE c.close END,
          first_event_at = LEAST(c.first_event_at, EXCLUDED.first_event_at),
          last_event_at = GREATEST(c.last_event_at, EXCLUDED.last_event_at),
          observations = c.observations + 1, updated_at = clock_timestamp()
        RETURNING *`,
        [
          tick.symbol,
          new Date(Math.floor(tick.eventTimeMs / MINUTE) * MINUTE),
          sessionDate(tick.eventTimeMs),
          tick.price,
          new Date(tick.eventTimeMs),
        ],
      );
      return rows[0] ? this.candle(rows[0]) : undefined;
    });
  }

  /** Only completed, provider-supplied bars replace sampled stream OHLC. */
  async importBars(symbol: string, bars: HistoricalBar[]): Promise<void> {
    if (!bars.length) return;
    await this.db.query(
      `
      INSERT INTO market_chart_candles AS c
        (symbol, provider, start_time, session_date, open, high, low, close, volume, source)
      SELECT $1, 'twelvedata', to_timestamp(b.t / 1000.0), b.d::date,
        b.o, b.h, b.l, b.c, b.v, 'provider_ohlc'
      FROM jsonb_to_recordset($2::jsonb) AS b(t bigint, d text, o float8, h float8, l float8, c float8, v float8)
      ON CONFLICT (symbol, provider, start_time) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, volume = EXCLUDED.volume,
        source = 'provider_ohlc', updated_at = clock_timestamp()`,
      [
        symbol,
        JSON.stringify(
          bars.map((b) => ({
            t: b.startTimeMs,
            d: sessionDate(b.startTimeMs),
            o: b.open,
            h: b.high,
            l: b.low,
            c: b.close,
            v: b.volume,
          })),
        ),
      ],
    );
  }

  async dates(symbol: string): Promise<string[]> {
    const rows = await this.db.query(
      `SELECT DISTINCT session_date::text AS date
      FROM market_chart_candles WHERE symbol = $1 AND provider = 'twelvedata'
      ORDER BY date DESC LIMIT 366`,
      [symbol],
    );
    return rows.map((row: { date: string }) => row.date);
  }

  async day(symbol: string, date: string): Promise<ChartCandle[]> {
    const rows = await this.db.query(
      `SELECT * FROM market_chart_candles
      WHERE symbol = $1 AND session_date = $2::date AND provider = 'twelvedata'
      ORDER BY start_time LIMIT 1440`,
      [symbol, date],
    );
    return rows.map((row: Record<string, unknown>) => this.candle(row));
  }

  private candle(row: Record<string, unknown>): ChartCandle {
    const ms = new Date(row.start_time as string).getTime();
    return {
      symbol: row.symbol as string,
      date: sessionDate(ms),
      startTimeMs: ms,
      timeLabel: sessionTime(ms),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume === null ? null : Number(row.volume),
      observations: Number(row.observations),
      source: row.source as ChartCandle["source"],
      updatedAtMs: new Date(row.updated_at as string).getTime(),
    };
  }
}
