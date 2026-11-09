import { MigrationInterface, QueryRunner } from "typeorm";
export class InvestmentRecommendations1794186000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE investment_requests (id uuid PRIMARY KEY, scope varchar(20) NOT NULL, idempotency_key uuid NOT NULL, kind varchar(20) NOT NULL, fingerprint char(64) NOT NULL, state varchar(20) NOT NULL DEFAULT 'PROCESSING', result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope,idempotency_key));
      CREATE TABLE investment_recommendations (id uuid PRIMARY KEY REFERENCES investment_requests(id) ON DELETE CASCADE, scope varchar(20) NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE investment_decisions (recommendation_id uuid PRIMARY KEY REFERENCES investment_recommendations(id) ON DELETE CASCADE, scope varchar(20) NOT NULL, decision varchar(20) NOT NULL CHECK(decision IN ('SEGUIR','DESCARTAR','POSPONER')), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE investment_audit (id bigserial PRIMARY KEY, scope varchar(20) NOT NULL, recommendation_id uuid REFERENCES investment_recommendations(id) ON DELETE CASCADE, correlation_id uuid NOT NULL, event varchar(40) NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE investment_quotas (bucket varchar(180) PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
      CREATE INDEX investment_recommendations_scope ON investment_recommendations(scope,created_at);
      CREATE INDEX investment_requests_retention ON investment_requests(created_at);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE investment_quotas,investment_audit,investment_decisions,investment_recommendations,investment_requests",
    );
  }
}
