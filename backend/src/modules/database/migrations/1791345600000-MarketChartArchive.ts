import { MigrationInterface, QueryRunner } from "typeorm";

/** Persistent chart data has no TTL; Redis remains the short-lived ATR cache. */
export class MarketChartArchive1791345600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE market_chart_observations (
        id uuid PRIMARY KEY,
        symbol varchar(32) NOT NULL,
        provider varchar(24) NOT NULL CHECK (provider = 'twelvedata'),
        event_time timestamptz NOT NULL,
        received_at timestamptz NOT NULL,
        session_date date NOT NULL,
        price double precision NOT NULL CHECK (price > 0 AND price < 'Infinity'::float8)
      );
      CREATE INDEX market_chart_observations_session
        ON market_chart_observations(symbol, session_date, event_time);
      CREATE TABLE market_chart_candles (
        symbol varchar(32) NOT NULL,
        provider varchar(24) NOT NULL CHECK (provider = 'twelvedata'),
        start_time timestamptz NOT NULL,
        session_date date NOT NULL,
        open double precision NOT NULL,
        high double precision NOT NULL,
        low double precision NOT NULL,
        close double precision NOT NULL,
        volume double precision CHECK (volume >= 0 AND volume < 'Infinity'::float8),
        observations integer NOT NULL DEFAULT 0,
        first_event_at timestamptz,
        last_event_at timestamptz,
        source varchar(24) NOT NULL CHECK (source IN ('stream', 'provider_ohlc')),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (symbol, provider, start_time),
        CHECK (low > 0 AND high < 'Infinity'::float8 AND low <= open AND low <= close AND high >= open AND high >= close)
      );
      CREATE INDEX market_chart_candles_session
        ON market_chart_candles(symbol, session_date, start_time);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE market_chart_candles; DROP TABLE market_chart_observations",
    );
  }
}
