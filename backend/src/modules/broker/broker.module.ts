import { Module } from "@nestjs/common";
import { IbkrClient } from "./ibkr.client";
import { BrokerStore } from "./broker.store";
import { IocExecutionService } from "./ioc-execution.service";

@Module({
  providers: [IbkrClient, BrokerStore, IocExecutionService],
  exports: [IocExecutionService],
})
export class BrokerModule {}
