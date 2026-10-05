import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsIn,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { MarketDataFeed } from '../market-data.config';
import {
  InvestmentMetrics,
  InvestmentDecision,
  ThresholdBasis,
} from '../../hedging/investment-analysis.service';

export class PriceAlertRuleDto {
  @IsIn(['REFERENCE', 'INVESTMENT'])
  thresholdBasis: ThresholdBasis = 'REFERENCE';

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(1000000000000)
  investedAmount?: number;

  @IsInt()
  @Min(1000)
  windowMs: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  @Max(10000)
  upPercent: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  @Max(100)
  downPercent: number;

  @IsInt()
  @Min(0)
  @Max(86400000)
  cooldownMs = 60000;

  @IsBoolean()
  enabled = true;
}

export interface PriceAlertRule extends Readonly<PriceAlertRuleDto> {
  readonly id: string;
}

export interface PriceAlert {
  readonly schemaVersion: 1;
  readonly alertId: string;
  readonly ruleId: string;
  readonly symbol: string;
  readonly provider: 'alpaca';
  readonly feed: MarketDataFeed;
  readonly simulated: boolean;
  readonly direction: 'up' | 'down';
  readonly windowMs: number;
  readonly thresholdPercent: number;
  readonly changePercent: number;
  readonly thresholdBasis: ThresholdBasis;
  readonly evaluatedChangePercent: number;
  readonly investment: InvestmentMetrics;
  readonly decision: InvestmentDecision;
  readonly referencePrice: number;
  readonly referenceTime: string;
  readonly referenceTimeMs: number;
  readonly price: number;
  readonly eventTime: string;
  readonly eventTimeMs: number;
  readonly detectedAtMs: number;
  readonly currency: 'USD';
}
