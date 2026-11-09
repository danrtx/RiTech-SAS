/** Explicit test harness: only synthetic fixtures; never production market/broker access. */
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { InvestmentRecommendations1794186000000 } from "../../database/migrations/1794186000000-InvestmentRecommendations";
import {
  InvestmentController,
  InvestmentGuard,
} from "../investment.controller";
import { InvestmentConfig } from "../investment.config";
import { InvestmentStore } from "../investment.store";
import { InvestmentService } from "../investment.service";
import { InvestmentMarket } from "../investment.market";
import { GeminiClient } from "../gemini.client";
import { analysis, fixture } from "./fixtures";
async function main() {
  if (process.env.RUN_INVESTMENT_DB_TESTS !== "1")
    throw new Error("Explicit test mode required");
  const schema = "investment_ui_" + randomUUID().replace(/-/g, "");
  const options = {
    type: "postgres" as const,
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
  const admin = await new DataSource(options).initialize();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = await new DataSource({
    ...options,
    extra: { options: `-c search_path=${schema}` },
  }).initialize();
  const runner = db.createQueryRunner();
  try {
    await new InvestmentRecommendations1794186000000().up(runner);
  } finally {
    await runner.release();
  }
  const module = await Test.createTestingModule({
    controllers: [InvestmentController],
    providers: [
      InvestmentConfig,
      InvestmentStore,
      InvestmentService,
      InvestmentGuard,
      { provide: DataSource, useValue: db },
      { provide: ConfigService, useValue: new ConfigService({}) },
      {
        provide: InvestmentMarket,
        useValue: { snapshot: () => fixture().market },
      },
      {
        provide: GeminiClient,
        useValue: {
          generate: async (kind: string) => ({
            data:
              kind === "analysis"
                ? analysis
                : {
                    answer:
                      "QQQ es un ETF; NDX es un índice. No hay posiciones verificadas.",
                    requiresNewEvaluation: false,
                  },
            modelVersion: "E2E_SIMULATED",
          }),
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  await app.listen(0, "127.0.0.1");
  console.log(JSON.stringify({ url: await app.getUrl(), synthetic: true }));
  const close = async () => {
    await app.close();
    await db.destroy();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.destroy();
    process.exit(0);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}
void main().catch(() => {
  console.error("E2E harness failed");
  process.exitCode = 1;
});
