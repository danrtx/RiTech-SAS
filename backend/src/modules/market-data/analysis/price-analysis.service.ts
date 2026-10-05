import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
import { MARKET_DATA_CONFIG, MarketDataConfig } from '../market-data.config';
import { MarketTick } from '../dto/market-tick.dto';
import {
  PriceAlert,
  PriceAlertRule,
  PriceAlertRuleDto,
} from '../dto/price-alert.dto';
import {
  TickConsumer,
  TickDeliveryContext,
  TickInvalidationReason,
  StaleTickDeliveryError,
} from '../ports/tick-consumer.interface';
import { TelemetryGateway } from '../../telemetry/telemetry.gateway';
import { PriceHistory } from './price-history';
import { InvestmentAnalysisService } from '../../hedging/investment-analysis.service';
import { describeMarketReference } from '../market-reference';

interface RuleState {
  rule: PriceAlertRule;
  region: 'neutral' | 'up' | 'down';
  lastAlertAtMs?: number;
}

@Injectable()
export class PriceAnalysisService implements TickConsumer {
  private history: PriceHistory;
  private recovering = false;
  private readonly rules = new Map<string, RuleState>();
  private lastInvalidation?: TickInvalidationReason;
  private alertsEmitted = 0;
  private alertsSuppressed = 0;

  constructor(
    @Inject(MARKET_DATA_CONFIG) private readonly config: MarketDataConfig,
    private readonly gateway: TelemetryGateway,
    private readonly investmentAnalysis: InvestmentAnalysisService,
  ) {
    this.history = new PriceHistory(
      config.historyCapacity,
      config.historyRetentionMs,
      config.referenceToleranceMs,
    );
  }

  upsertRule(id: string, input: PriceAlertRuleDto): PriceAlertRule {
    this.validateId(id);
    const dto = Object.assign(new PriceAlertRuleDto(), input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      (dto.windowMs !== undefined &&
        dto.windowMs > this.config.historyRetentionMs) ||
      (dto.referenceMode === 'ENTRY' &&
        (dto.entryTimeMs! > Date.now() ||
          dto.windowMs !== undefined ||
          dto.investedAmount == null)) ||
      (dto.referenceMode !== 'ENTRY' &&
        (dto.entryPrice !== undefined || dto.entryTimeMs !== undefined))
    ) {
      throw new BadRequestException(
        'Regla inválida: usar WINDOW con windowMs dentro de la retención, o ENTRY con capital, precio y fecha de entrada no futura; no mezclar referencias',
      );
    }
    if (!this.rules.has(id) && this.rules.size >= this.config.maxAlertRules) {
      throw new BadRequestException(
        'Se alcanzó el máximo de reglas configuradas',
      );
    }
    const rule = Object.freeze({
      id,
      referenceMode: dto.referenceMode ?? 'WINDOW',
      entryPrice: dto.entryPrice,
      entryTimeMs: dto.entryTimeMs,
      windowMs: dto.windowMs,
      upPercent: dto.upPercent,
      downPercent: dto.downPercent,
      cooldownMs: dto.cooldownMs,
      enabled: dto.enabled,
      thresholdBasis: dto.thresholdBasis,
      investedAmount: dto.investedAmount ?? undefined,
    });
    // Reemplazar una regla reinicia su cruce y cooldown; evalúa en el próximo tick fresco.
    this.rules.set(id, { rule, region: 'neutral' });
    return rule;
  }

  deleteRule(id: string): { id: string; deleted: true } {
    this.validateId(id);
    if (!this.rules.delete(id))
      throw new NotFoundException('Regla no encontrada');
    return { id, deleted: true };
  }

  private validateId(id: string): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw new BadRequestException('Identificador de regla inválido');
  }

  private analysis(rule: PriceAlertRule, nowMs: number) {
    if (this.recovering) return { status: 'UNAVAILABLE' as const };
    const current = this.history.latest();
    if (!rule.enabled) return { status: 'DISABLED' as const };
    if (!current) return { status: 'WARMING_UP' as const };
    if (
      nowMs - current.eventTimeMs > this.config.maxTickAgeMs ||
      current.eventTimeMs - nowMs > this.config.futureToleranceMs
    )
      return { status: 'STALE' as const };
    const targetMs = current.eventTimeMs - (rule.windowMs ?? 0);
    if (
      rule.referenceMode === 'ENTRY' &&
      current.eventTimeMs < rule.entryTimeMs!
    )
      return { status: 'WARMING_UP' as const };
    const reference =
      rule.referenceMode === 'ENTRY'
        ? {
            price: rule.entryPrice!,
            eventTimeMs: rule.entryTimeMs!,
            eventTime: new Date(rule.entryTimeMs!).toISOString(),
          }
        : this.history.reference(targetMs);
    if (!reference)
      return {
        status:
          this.history.earliest()!.eventTimeMs > targetMs
            ? ('WARMING_UP' as const)
            : ('REFERENCE_GAP' as const),
      };
    const changePercent =
      ((current.price - reference.price) / reference.price) * 100;
    if (!Number.isFinite(changePercent))
      return { status: 'UNAVAILABLE' as const };
    let impact: ReturnType<InvestmentAnalysisService['evaluate']>;
    try {
      impact = this.investmentAnalysis.evaluate(changePercent, rule);
    } catch {
      return { status: 'UNAVAILABLE' as const };
    }
    return {
      status: 'READY' as const,
      referenceMode: rule.referenceMode ?? 'WINDOW',
      changePercent,
      ...impact,
      price: current.price,
      eventTime: current.eventTime,
      eventTimeMs: current.eventTimeMs,
      validUntilMs: current.eventTimeMs + this.config.maxTickAgeMs,
      referencePrice: reference.price,
      referenceTime: reference.eventTime,
      referenceTimeMs: reference.eventTimeMs,
    };
  }

  async consume(
    tick: MarketTick,
    context?: TickDeliveryContext,
  ): Promise<void> {
    if (context?.signal.aborted) return;
    const nowMs = Date.now();
    if (tick.symbol !== this.config.symbol || tick.feed !== this.config.feed)
      throw new Error('market_data_tick_source_mismatch');
    if (
      nowMs - tick.eventTimeMs > this.config.maxTickAgeMs ||
      tick.eventTimeMs - nowMs > this.config.futureToleranceMs
    ) {
      throw new StaleTickDeliveryError();
    }
    // Mutación y emisiones síncronas: no hay continuación tardía tras invalidar el análisis.
    this.history.append(tick);
    this.lastInvalidation = undefined;
    this.gateway.broadcastMarketTick(tick);
    for (const state of this.rules.values()) {
      const result = this.analysis(state.rule, nowMs);
      this.gateway.broadcastInvestmentUpdate({
        marketReference: describeMarketReference(this.config),
        schemaVersion: 1,
        ruleId: state.rule.id,
        symbol: tick.symbol,
        feed: tick.feed,
        simulated: tick.feed !== 'iex',
        windowMs: state.rule.windowMs,
        referenceMode: state.rule.referenceMode ?? 'WINDOW',
        status: result.status,
        evaluatedAtMs: nowMs,
        ...(result.status === 'READY'
          ? {
              investment: result.investment,
              referencePrice: result.referencePrice,
              referenceTimeMs: result.referenceTimeMs,
              decision: result.decision,
              validUntilMs: tick.eventTimeMs + this.config.maxTickAgeMs,
            }
          : {}),
      });
      if (result.status !== 'READY') {
        state.region = 'neutral';
        continue;
      }
      const region =
        result.decision.evaluatedChangePercent >= state.rule.upPercent
          ? 'up'
          : result.decision.evaluatedChangePercent <= -state.rule.downPercent
            ? 'down'
            : 'neutral';
      const crossed = region !== 'neutral' && region !== state.region;
      state.region = region;
      if (!crossed) continue;
      if (
        state.lastAlertAtMs !== undefined &&
        nowMs - state.lastAlertAtMs < state.rule.cooldownMs
      ) {
        this.alertsSuppressed++;
        continue;
      }
      const alert: PriceAlert = Object.freeze({
        marketReference: describeMarketReference(this.config),
        schemaVersion: 1,
        alertId: randomUUID(),
        ruleId: state.rule.id,
        symbol: tick.symbol,
        provider: tick.provider,
        feed: tick.feed,
        simulated: tick.feed !== 'iex',
        direction: region as 'up' | 'down',
        windowMs: state.rule.windowMs,
        referenceMode: state.rule.referenceMode ?? 'WINDOW',
        thresholdPercent:
          region === 'up' ? state.rule.upPercent : state.rule.downPercent,
        changePercent: result.changePercent,
        thresholdBasis: state.rule.thresholdBasis,
        evaluatedChangePercent: result.decision.evaluatedChangePercent,
        investment: result.investment,
        decision: result.decision,
        referencePrice: result.referencePrice,
        referenceTime: result.referenceTime,
        referenceTimeMs: result.referenceTimeMs,
        price: tick.price,
        eventTime: tick.eventTime,
        eventTimeMs: tick.eventTimeMs,
        detectedAtMs: nowMs,
        currency: 'USD',
      });
      this.gateway.broadcastPriceAlert(alert);
      state.lastAlertAtMs = nowMs;
      this.alertsEmitted++;
    }
  }

  invalidate(reason: TickInvalidationReason): void {
    this.history.clear();
    this.lastInvalidation = reason;
    for (const state of this.rules.values()) state.region = 'neutral';
    this.gateway.broadcastMarketDataQuality({
      symbol: this.config.symbol,
      feed: this.config.feed,
      reason,
      occurredAtMs: Date.now(),
    });
  }
  suspend(reason: TickInvalidationReason): void {
    this.recovering = true;
    this.lastInvalidation = reason;
    this.gateway.broadcastMarketDataQuality({
      symbol: this.config.symbol,
      feed: this.config.feed,
      reason,
      occurredAtMs: Date.now(),
    });
  }
  restore(ticks: readonly MarketTick[], resume = true): void {
    const history = new PriceHistory(
      this.config.historyCapacity,
      this.config.historyRetentionMs,
      this.config.referenceToleranceMs,
    );
    for (const tick of ticks) history.append(tick);
    this.history = history;
    this.recovering = false;
    this.lastInvalidation = undefined;
    // Re-arm to the recovered current region without replaying old notifications.
    for (const state of this.rules.values()) {
      const result = this.analysis(
        state.rule,
        ticks.at(-1)?.eventTimeMs ?? Date.now(),
      );
      state.region =
        result.status !== 'READY'
          ? 'neutral'
          : result.decision.evaluatedChangePercent >= state.rule.upPercent
            ? 'up'
            : result.decision.evaluatedChangePercent <= -state.rule.downPercent
              ? 'down'
              : 'neutral';
    }
    this.recovering = !resume;
  }
  appendRecovered(tick: MarketTick): void {
    this.history.append(tick);
  }
  resume(): void {
    this.recovering = false;
    for (const state of this.rules.values()) {
      const result = this.analysis(
        state.rule,
        this.history.latest()?.eventTimeMs ?? Date.now(),
      );
      state.region =
        result.status !== 'READY'
          ? 'neutral'
          : result.decision.evaluatedChangePercent >= state.rule.upPercent
            ? 'up'
            : result.decision.evaluatedChangePercent <= -state.rule.downPercent
              ? 'down'
              : 'neutral';
    }
  }

  listRules(nowMs = Date.now()) {
    return [...this.rules.values()].map(({ rule }) => ({
      ...rule,
      marketReference: describeMarketReference(this.config),
      analysis: this.analysis(rule, nowMs),
    }));
  }

  getHistory(limit = 500) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new BadRequestException('limit debe estar entre 1 y 1000');
    return {
      symbol: this.config.symbol,
      marketReference: describeMarketReference(this.config),
      feed: this.config.feed,
      ...this.history.getMetadata(),
      samples: this.history.snapshot(limit),
    };
  }

  getStatus() {
    const current = this.history.latest();
    return {
      ...this.history.getMetadata(),
      marketReference: describeMarketReference(this.config),
      lastInvalidation: this.lastInvalidation,
      fresh:
        !this.recovering &&
        !!current &&
        Date.now() - current.eventTimeMs <= this.config.maxTickAgeMs &&
        current.eventTimeMs - Date.now() <= this.config.futureToleranceMs,
      alertsEmitted: this.alertsEmitted,
      recovering: this.recovering,
      alertsSuppressed: this.alertsSuppressed,
      rules: this.listRules(),
    };
  }
}
