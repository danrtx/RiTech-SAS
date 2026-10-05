import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsIn,
  IsOptional,
  ValidateIf,
  Max,
  Min,
} from 'class-validator';
import { MarketDataFeed } from '../market-data.config';
import type { MarketReference } from '../market-reference';
import {
  InvestmentMetrics,
  InvestmentDecision,
  ThresholdBasis,
} from '../../hedging/investment-analysis.service';

export class PriceAlertRuleDto {
  @IsOptional()
  @IsIn(['WINDOW', 'ENTRY'])
  referenceMode?: 'WINDOW' | 'ENTRY';

  @ValidateIf((o) => o.referenceMode === 'ENTRY' || o.entryPrice !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  entryPrice?: number;

  @ValidateIf((o) => o.referenceMode === 'ENTRY' || o.entryTimeMs !== undefined)
  @IsInt()
  @Min(0)
  @Max(8640000000000000)
  entryTimeMs?: number;

  @IsIn(['REFERENCE', 'INVESTMENT'])
  thresholdBasis: ThresholdBasis = 'REFERENCE';

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(1000000000000)
  investedAmount?: number;

  @ValidateIf((o) => o.referenceMode !== 'ENTRY' || o.windowMs !== undefined)
  @IsInt()
  @Min(1000)
  windowMs?: number;

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
  readonly marketReference?: MarketReference;
  readonly schemaVersion: 1;
  readonly alertId: string;
  readonly ruleId: string;
  readonly symbol: string;
  readonly provider: MarketDataProvider;
  readonly feed: MarketDataFeed;
  readonly simulated: boolean;
  readonly direction: 'up' | 'down';
  readonly windowMs?: number;
  readonly referenceMode?: 'WINDOW' | 'ENTRY';
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
