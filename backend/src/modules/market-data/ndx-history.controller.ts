import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NdxHistoryService } from './ndx-history.service';
import { NdxInvestmentDto } from './dto/ndx-investment.dto';

@Controller('market-data/index')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class NdxHistoryController {
  constructor(private readonly ndx: NdxHistoryService) {}

  @Get('history')
  history(@Query('from') from: string, @Query('to') to: string) {
    return this.ndx.history(from, to);
  }

  @Post('evaluate')
  @HttpCode(200)
  evaluate(@Body() input: NdxInvestmentDto) {
    return this.ndx.evaluate(input);
  }
}
