import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { envConfig } from "../src/config/env.config";
import { DatabaseModule } from "../src/modules/database/database.module";
import { InvestmentStore } from "../src/modules/investment/investment.store";
import { InvestmentConfig } from "../src/modules/investment/investment.config";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../.env"],
      load: [envConfig],
    }),
    DatabaseModule,
  ],
  providers: [InvestmentConfig, InvestmentStore],
})
class MaintenanceModule {}
async function main() {
  const app = await NestFactory.createApplicationContext(MaintenanceModule, {
    logger: ["error"],
  });
  try {
    await app.get(InvestmentStore).purge();
    console.log(
      "Expired investment records purged according to retention policy.",
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error("Investment retention failed");
  process.exitCode = 1;
});
