import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { envConfig } from "../src/config/env.config";
import { DatabaseModule } from "../src/modules/database/database.module";
import { BrokerModule } from "../src/modules/broker/broker.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../.env"],
      load: [envConfig],
    }),
    DatabaseModule,
    BrokerModule,
  ],
})
class BrokerCliModule {}
import { IocExecutionService } from "../src/modules/broker/ioc-execution.service";

async function main() {
  const [correlationId, conid, side, quantity, limitPrice] =
    process.argv.slice(2);
  if (!correlationId || !["BUY", "SELL"].includes(side) || !limitPrice)
    throw new Error(
      "Usage: npm run broker:ioc -- correlationId conid BUY|SELL quantity limitPrice",
    );
  const app = await NestFactory.createApplicationContext(BrokerCliModule, {
    logger: ["error", "warn"],
  });
  try {
    const result = await app.get(IocExecutionService).execute({
      correlationId,
      conid: Number(conid),
      side: side as "BUY" | "SELL",
      quantity: Number(quantity),
      limitPrice: Number(limitPrice),
    });
    console.log(
      JSON.stringify({
        clientId: result.client_id,
        state: result.state,
        brokerOrderId: result.broker_order_id,
      }),
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    "IOC failed. Check configuration, session and broker_order_events.",
  );
  process.exitCode = 1;
});
