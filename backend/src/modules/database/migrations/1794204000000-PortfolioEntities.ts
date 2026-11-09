import { MigrationInterface, QueryRunner } from 'typeorm';
export class PortfolioEntities1794204000000 implements MigrationInterface {
async up(q: QueryRunner): Promise<void> {
await q.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
await q.query("CREATE TABLE \"hedge_execution_logs\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"hedgeRuleId\" uuid NOT NULL, \"positionId\" uuid NOT NULL, \"actionTaken\" character varying NOT NULL, \"hedgeRatioApplied\" numeric(5,2) NOT NULL, \"triggerValue\" numeric(14,4) NOT NULL, \"executedPrice\" numeric(14,4) NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_bbb102acb93d25911febe916b15\" PRIMARY KEY (\"id\"))");
await q.query("CREATE TABLE \"hedge_rules\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"userId\" uuid NOT NULL, \"assetId\" uuid NOT NULL, \"ruleName\" character varying NOT NULL, \"atrThreshold\" numeric(10,4) NOT NULL, \"maxDrawdownPct\" numeric(5,2) NOT NULL, \"targetHedgeRatio\" numeric(5,2) NOT NULL DEFAULT '1', \"isActive\" boolean NOT NULL DEFAULT true, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_44c8883a4ace2c1a2ee71bdf1ff\" PRIMARY KEY (\"id\")); COMMENT ON COLUMN \"hedge_rules\".\"atrThreshold\" IS 'ATR Volatility threshold trigger'; COMMENT ON COLUMN \"hedge_rules\".\"maxDrawdownPct\" IS 'Max drawdown percentage trigger'; COMMENT ON COLUMN \"hedge_rules\".\"targetHedgeRatio\" IS '1.0 = 100% hedge ratio'");
await q.query("CREATE TYPE \"public\".\"assets_assettype_enum\" AS ENUM('INDEX', 'ETF', 'EQUITY')");
await q.query("CREATE TABLE \"assets\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"symbol\" character varying NOT NULL, \"name\" character varying NOT NULL, \"assetType\" \"public\".\"assets_assettype_enum\" NOT NULL DEFAULT 'EQUITY', \"isTradable\" boolean NOT NULL DEFAULT true, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"UQ_9b4bd5b9c6fe49cd3b4342fb914\" UNIQUE (\"symbol\"), CONSTRAINT \"PK_da96729a8b113377cfb6a62439c\" PRIMARY KEY (\"id\"))");
await q.query("CREATE TYPE \"public\".\"orders_side_enum\" AS ENUM('BUY', 'SELL')");
await q.query("CREATE TYPE \"public\".\"orders_type_enum\" AS ENUM('MARKET', 'LIMIT', 'STOP_LOSS')");
await q.query("CREATE TYPE \"public\".\"orders_status_enum\" AS ENUM('PENDING', 'FILLED', 'CANCELLED', 'REJECTED')");
await q.query("CREATE TABLE \"orders\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"userId\" uuid NOT NULL, \"positionId\" uuid, \"symbol\" character varying NOT NULL, \"side\" \"public\".\"orders_side_enum\" NOT NULL, \"type\" \"public\".\"orders_type_enum\" NOT NULL, \"quantity\" numeric(14,4) NOT NULL, \"price\" numeric(14,4), \"status\" \"public\".\"orders_status_enum\" NOT NULL DEFAULT 'PENDING', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_710e2d4957aa5878dfe94e4ac2f\" PRIMARY KEY (\"id\"))");
await q.query("CREATE TYPE \"public\".\"positions_side_enum\" AS ENUM('LONG', 'SHORT')");
await q.query("CREATE TYPE \"public\".\"positions_status_enum\" AS ENUM('OPEN', 'CLOSED', 'HEDGED')");
await q.query("CREATE TABLE \"positions\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"userId\" uuid NOT NULL, \"assetId\" uuid NOT NULL, \"side\" \"public\".\"positions_side_enum\" NOT NULL, \"quantity\" numeric(14,4) NOT NULL, \"entryPrice\" numeric(14,4) NOT NULL, \"currentPrice\" numeric(14,4), \"unrealizedPnl\" numeric(14,4) NOT NULL DEFAULT '0', \"status\" \"public\".\"positions_status_enum\" NOT NULL DEFAULT 'OPEN', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_17e4e62ccd5749b289ae3fae6f3\" PRIMARY KEY (\"id\"))");
await q.query("CREATE TYPE \"public\".\"users_role_enum\" AS ENUM('ADMIN', 'TRADER', 'ANALYST')");
await q.query("CREATE TABLE \"users\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"email\" character varying NOT NULL, \"passwordHash\" character varying NOT NULL, \"fullName\" character varying NOT NULL, \"role\" \"public\".\"users_role_enum\" NOT NULL DEFAULT 'TRADER', \"isActive\" boolean NOT NULL DEFAULT true, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"UQ_97672ac88f789774dd47f7c8be3\" UNIQUE (\"email\"), CONSTRAINT \"PK_a3ffb1c0c8416b9fc6f907b7433\" PRIMARY KEY (\"id\"))");
await q.query("ALTER TABLE \"hedge_execution_logs\" ADD CONSTRAINT \"FK_3cda3b0ab39192df3a27337d2b0\" FOREIGN KEY (\"hedgeRuleId\") REFERENCES \"hedge_rules\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"hedge_execution_logs\" ADD CONSTRAINT \"FK_d2d2c30eed4453d49e6748c0b78\" FOREIGN KEY (\"positionId\") REFERENCES \"positions\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"hedge_rules\" ADD CONSTRAINT \"FK_fc0a7c2471d1194c72d1dd60179\" FOREIGN KEY (\"userId\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"hedge_rules\" ADD CONSTRAINT \"FK_514535a61ac17ace0178e771052\" FOREIGN KEY (\"assetId\") REFERENCES \"assets\"(\"id\") ON DELETE RESTRICT ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"orders\" ADD CONSTRAINT \"FK_151b79a83ba240b0cb31b2302d1\" FOREIGN KEY (\"userId\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"orders\" ADD CONSTRAINT \"FK_9d9037f1b5b0a439dc8ea90c56d\" FOREIGN KEY (\"positionId\") REFERENCES \"positions\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"positions\" ADD CONSTRAINT \"FK_0cf2caecfba00a6746ec1ff87a3\" FOREIGN KEY (\"userId\") REFERENCES \"users\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION");
await q.query("ALTER TABLE \"positions\" ADD CONSTRAINT \"FK_46ec4f7f43eebb5e5fcfebdae8a\" FOREIGN KEY (\"assetId\") REFERENCES \"assets\"(\"id\") ON DELETE RESTRICT ON UPDATE NO ACTION");
}
async down(q: QueryRunner): Promise<void> {
await q.query("ALTER TABLE \"positions\" DROP CONSTRAINT \"FK_46ec4f7f43eebb5e5fcfebdae8a\"");
await q.query("ALTER TABLE \"positions\" DROP CONSTRAINT \"FK_0cf2caecfba00a6746ec1ff87a3\"");
await q.query("ALTER TABLE \"orders\" DROP CONSTRAINT \"FK_9d9037f1b5b0a439dc8ea90c56d\"");
await q.query("ALTER TABLE \"orders\" DROP CONSTRAINT \"FK_151b79a83ba240b0cb31b2302d1\"");
await q.query("ALTER TABLE \"hedge_rules\" DROP CONSTRAINT \"FK_514535a61ac17ace0178e771052\"");
await q.query("ALTER TABLE \"hedge_rules\" DROP CONSTRAINT \"FK_fc0a7c2471d1194c72d1dd60179\"");
await q.query("ALTER TABLE \"hedge_execution_logs\" DROP CONSTRAINT \"FK_d2d2c30eed4453d49e6748c0b78\"");
await q.query("ALTER TABLE \"hedge_execution_logs\" DROP CONSTRAINT \"FK_3cda3b0ab39192df3a27337d2b0\"");
await q.query("DROP TABLE \"users\"");
await q.query("DROP TYPE \"public\".\"users_role_enum\"");
await q.query("DROP TABLE \"positions\"");
await q.query("DROP TYPE \"public\".\"positions_status_enum\"");
await q.query("DROP TYPE \"public\".\"positions_side_enum\"");
await q.query("DROP TABLE \"orders\"");
await q.query("DROP TYPE \"public\".\"orders_status_enum\"");
await q.query("DROP TYPE \"public\".\"orders_type_enum\"");
await q.query("DROP TYPE \"public\".\"orders_side_enum\"");
await q.query("DROP TABLE \"assets\"");
await q.query("DROP TYPE \"public\".\"assets_assettype_enum\"");
await q.query("DROP TABLE \"hedge_rules\"");
await q.query("DROP TABLE \"hedge_execution_logs\"");
}
}

