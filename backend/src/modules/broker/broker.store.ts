import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { BrokerResult, IocOrder } from "./ibkr.client";

@Injectable()
export class BrokerStore {
  constructor(private readonly db: DataSource) {}
  async claim(id: string, account: string, order: IocOrder): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO broker_orders(client_id,account,correlation_id,request,state)
       VALUES($1,$2,$3,$4,'SUBMITTING') ON CONFLICT DO NOTHING RETURNING client_id`,
      [id, account, order.correlationId, JSON.stringify(order)],
    );
    return rows.length === 1;
  }
  async read(id: string) {
    const [row] = await this.db.query(
      "SELECT * FROM broker_orders WHERE client_id=$1",
      [id],
    );
    return row;
  }
  async record(
    id: string,
    result: BrokerResult,
    attempt: number,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.query(
        `UPDATE broker_orders SET state=$2,broker_order_id=COALESCE($3,broker_order_id),updated_at=now() WHERE client_id=$1`,
        [id, result.state, result.brokerOrderId || null],
      );
      await manager.query(
        "INSERT INTO broker_order_events(client_id,state,reason,attempt) VALUES($1,$2,$3,$4)",
        [id, result.state, result.reason, attempt],
      );
    });
  }
}
