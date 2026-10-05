import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PriceAlertRuleDto } from './dto/price-alert.dto';
import { PriceAnalysisService } from './analysis/price-analysis.service';
import { MarketDataWsClient } from './market-data-ws.client';
import { MarketDataProcessor } from './market-data.processor';
import { MarketDataService } from './market-data.service';

@Controller('market-data')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class MarketDataController {
  constructor(
    private readonly analysis: PriceAnalysisService,
    private readonly client: MarketDataWsClient,
    private readonly processor: MarketDataProcessor,
    private readonly service: MarketDataService,
  ) {}

  @Get('status')
  status() {
    return {
      connection: this.client.getStatus(),
      ingestion: this.processor.getStatus(),
      recovery: this.service.getStatus(),
      analysis: this.analysis.getStatus(),
    };
  }

  @Get('history')
  history(
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
  ) {
    return this.analysis.getHistory(limit);
  }

  @Get('rules')
  rules() {
    return this.analysis.listRules();
  }

  @Put('rules/:id')
  upsert(@Param('id') id: string, @Body() rule: PriceAlertRuleDto) {
    return this.analysis.upsertRule(id, rule);
  }

  @Delete('rules/:id')
  delete(@Param('id') id: string) {
    return this.analysis.deleteRule(id);
  }
}
