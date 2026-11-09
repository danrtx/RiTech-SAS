import { MigrationInterface, QueryRunner } from "typeorm";

export class BrokerOrders1794153600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE broker_orders (
      client_id varchar(32) PRIMARY KEY,
      account varchar(32) NOT NULL,
      correlation_id varchar(128) NOT NULL,
      request jsonb NOT NULL,
      state varchar(32) NOT NULL,
      broker_order_id varchar(128),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(account, correlation_id)
    );
    CREATE TABLE broker_order_events (
      id bigserial PRIMARY KEY,
      client_id varchar(32) NOT NULL REFERENCES broker_orders(client_id),
      state varchar(32) NOT NULL,
      reason varchar(64) NOT NULL,
      attempt integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE broker_order_events; DROP TABLE broker_orders",
    );
  }
}
