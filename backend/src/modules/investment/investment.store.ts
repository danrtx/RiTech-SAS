import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { EvaluationInput } from "./investment.types";
import { InvestmentConfig } from "./investment.config";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class InvestmentStore {
  constructor(
    readonly db: DataSource,
    private readonly config: InvestmentConfig,
  ) {}
  async consume(buckets: { key: string; limit: number; seconds: number }[]) {
    await this.db.transaction(async (tx) => {
      for (const b of buckets) {
        const [row] = await tx.query(
          `INSERT INTO investment_quotas(bucket,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
          ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN investment_quotas.expires_at<=now() THEN 1 ELSE investment_quotas.hits+1 END,
          expires_at=CASE WHEN investment_quotas.expires_at<=now() THEN EXCLUDED.expires_at ELSE investment_quotas.expires_at END RETURNING hits`,
          [b.key, b.seconds],
        );
        if (row.hits > b.limit) throw new HttpException("CUOTA_EXCEDIDA", 429);
      }
    });
  }
  async context() {
    // Twelve Data supplies market prices, not private account balances.
    return { context: null, contextVersion: null };
  }
  async claim(scope: string, key: string, kind: string, payload: unknown) {
    const fingerprint = digest(JSON.stringify({ kind, payload }));
    const id = randomUUID();
    const rows = await this.db.query(
      `INSERT INTO investment_requests(id,scope,idempotency_key,kind,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scope,idempotency_key) DO NOTHING RETURNING id`,
      [id, scope, key, kind, fingerprint],
    );
    if (rows.length) return { id, cached: false, result: undefined };
    const [row] = await this.db.query(
      "SELECT * FROM investment_requests WHERE scope=$1 AND idempotency_key=$2",
      [scope, key],
    );
    if (row.fingerprint !== fingerprint)
      throw new ConflictException("CLAVE_REUTILIZADA");
    if (row.state === "PROCESSING")
      throw new ConflictException("SOLICITUD_EN_PROCESO_O_INCIERTA");
    return { id: row.id as string, cached: true, result: row.result };
  }
  async finish(
    scope: string,
    id: string,
    result: Record<string, unknown>,
    input?: EvaluationInput,
  ) {
    return this.db.transaction(async (tx) => {
      if (input) {
        await tx.query(
          "INSERT INTO investment_recommendations(id,scope,input,result) VALUES($1,$2,$3,$4)",
          [id, scope, JSON.stringify(input), JSON.stringify(result)],
        );
      }
      await tx.query(
        "UPDATE investment_requests SET state='DONE',result=$3 WHERE id=$1 AND scope=$2",
        [id, scope, JSON.stringify(result)],
      );
      await tx.query(
        "INSERT INTO investment_audit(scope,recommendation_id,correlation_id,event,details) VALUES($1,$2,$3,$4,$5)",
        [
          scope,
          input ? id : null,
          id,
          input ? "RECOMMENDATION_GENERATED" : "QUESTION_ANSWERED",
          JSON.stringify({
            status: result.status,
            decision: result.decision,
            recommendationId: result.recommendationId,
          }),
        ],
      );
      return result;
    });
  }
  async owned(scope: string, id: string) {
    const [row] = await this.db.query(
      "SELECT id,input,result,created_at FROM investment_recommendations WHERE id=$1 AND scope=$2",
      [id, scope],
    );
    if (!row) throw new NotFoundException("RECOMENDACION_NO_ENCONTRADA");
    return row;
  }
  async audit(
    scope: string,
    id: string,
    event: string,
    correlation = randomUUID(),
  ) {
    await this.db.query(
      "INSERT INTO investment_audit(scope,recommendation_id,correlation_id,event) VALUES($1,$2,$3,$4)",
      [scope, id, correlation, event],
    );
  }
  async decision(scope: string, id: string, decision: string) {
    await this.owned(scope, id);
    return this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO investment_decisions(recommendation_id,scope,decision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, scope, decision],
      );
      const [row] = await tx.query(
        "SELECT decision,created_at FROM investment_decisions WHERE recommendation_id=$1 AND scope=$2",
        [id, scope],
      );
      if (row.decision !== decision)
        throw new ConflictException("DECISION_YA_REGISTRADA");
      await tx.query(
        "INSERT INTO investment_audit(scope,recommendation_id,correlation_id,event) VALUES($1,$2,$3,'HUMAN_DECISION_RECORDED')",
        [scope, id, randomUUID()],
      );
      return {
        recommendationId: id,
        decision: row.decision,
        decidedAt: row.created_at,
        orderStatus: "NO_ORDER_REQUESTED",
      };
    });
  }
  async purge() {
    // Explicit maintenance command; never delete fresh records to bypass deduplication.
    await this.db.transaction(async (tx) => {
      await tx.query(
        "DELETE FROM investment_requests WHERE created_at < now()-$1*interval '1 day'",
        [this.config.retentionDays],
      );
      await tx.query(
        "DELETE FROM investment_audit WHERE created_at < now()-$1*interval '1 day'",
        [this.config.retentionDays],
      );
      await tx.query("DELETE FROM investment_quotas WHERE expires_at<=now()");
    });
  }
}
