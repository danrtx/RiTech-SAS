import { Injectable } from '@nestjs/common';
import type { MarketReference } from '../market-data/market-reference';

export type ThresholdBasis = 'REFERENCE' | 'INVESTMENT';
export type InvestmentSignal = 'MONITOR' | 'REVIEW_GAIN' | 'REVIEW_RISK';

export interface InvestmentMetrics {
  readonly model: 'SIMPLE_2X';
  readonly leverage: 2;
  readonly referenceChangePercent: number;
  readonly changePercent: number;
  /** Capital en la referencia declarada; modelo académico, sin comisiones. */
  readonly investedAmount: number | null;
  readonly estimatedPnL: number | null;
  readonly estimatedValue: number | null;
  readonly currency: 'USD';
}

export interface InvestmentDecision {
  readonly signal: InvestmentSignal;
  readonly thresholdBasis: ThresholdBasis;
  readonly evaluatedChangePercent: number;
  readonly reason: 'WITHIN_THRESHOLDS' | 'GAIN_THRESHOLD' | 'LOSS_THRESHOLD';
}

export type AnalysisStatus =
  | 'DISABLED'
  | 'WARMING_UP'
  | 'STALE'
  | 'REFERENCE_GAP'
  | 'UNAVAILABLE'
  | 'READY';

export interface InvestmentUpdate {
  readonly marketReference?: MarketReference;
  readonly schemaVersion: 1;
  readonly ruleId: string;
  readonly symbol: string;
  readonly feed: string;
  readonly simulated: boolean;
  readonly windowMs?: number;
  readonly referenceMode?: 'WINDOW' | 'ENTRY';
  readonly referencePrice?: number;
  readonly referenceTimeMs?: number;
  readonly status: AnalysisStatus;
  readonly evaluatedAtMs: number;
  readonly validUntilMs?: number;
  readonly investment?: InvestmentMetrics;
  readonly decision?: InvestmentDecision;
}

/** Modelo explícito del enunciado RiTech; nunca acumula retornos de ventanas solapadas. */
@Injectable()
export class InvestmentAnalysisService {
  evaluate(
    referenceChangePercent: number,
    rule: {
      thresholdBasis: ThresholdBasis;
      investedAmount?: number;
      upPercent: number;
      downPercent: number;
    },
  ): { investment: InvestmentMetrics; decision: InvestmentDecision } {
    const changePercent = referenceChangePercent * 2;
    const investedAmount = rule.investedAmount ?? null;
    const estimatedPnL =
      investedAmount === null ? null : investedAmount * (changePercent / 100);
    const evaluatedChangePercent =
      rule.thresholdBasis === 'INVESTMENT'
        ? changePercent
        : referenceChangePercent;
    if (
      ![
        referenceChangePercent,
        changePercent,
        evaluatedChangePercent,
        ...(estimatedPnL === null
          ? []
          : [estimatedPnL, investedAmount! + estimatedPnL]),
      ].every(Number.isFinite)
    )
      throw new Error('investment_non_finite_result');
    const region =
      evaluatedChangePercent >= rule.upPercent
        ? 'up'
        : evaluatedChangePercent <= -rule.downPercent
          ? 'down'
          : 'neutral';
    return {
      investment: Object.freeze({
        model: 'SIMPLE_2X',
        leverage: 2,
        referenceChangePercent,
        changePercent,
        investedAmount,
        estimatedPnL,
        estimatedValue:
          estimatedPnL === null ? null : investedAmount! + estimatedPnL,
        currency: 'USD',
      }),
      decision: Object.freeze({
        signal:
          region === 'up'
            ? 'REVIEW_GAIN'
            : region === 'down'
              ? 'REVIEW_RISK'
              : 'MONITOR',
        thresholdBasis: rule.thresholdBasis,
        evaluatedChangePercent,
        reason:
          region === 'up'
            ? 'GAIN_THRESHOLD'
            : region === 'down'
              ? 'LOSS_THRESHOLD'
              : 'WITHIN_THRESHOLDS',
      }),
    };
  }
}
