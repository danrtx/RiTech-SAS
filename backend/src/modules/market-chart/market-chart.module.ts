import { Controller, Get, Module, Query } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MarketDataModule } from "../market-data/market-data.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { ChartStore } from "./chart.store";
import { MarketChartService } from "./market-chart.service";

@Controller("market-data/chart")
export class MarketChartController {
  constructor(private readonly chart: MarketChartService) {}
  @Get()
  snapshot(@Query("symbol") symbol?: string, @Query("date") date?: string) {
    return this.chart.snapshot(symbol, date);
  }
}

@Module({
  imports: [ConfigModule, MarketDataModule, TelemetryModule],
  controllers: [MarketChartController],
  providers: [ChartStore, MarketChartService],
})
export class MarketChartModule {}
