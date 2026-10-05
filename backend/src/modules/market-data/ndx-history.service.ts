import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvestmentAnalysisService } from '../hedging/investment-analysis.service';

export interface IndexDailyBar {
  date: string;
  periodStartMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const marketDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function dateValue(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Usar fechas YYYY-MM-DD');
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Fecha inválida');
  return parsed;
}

/** Consulta explícita de cierres NDX; nunca se inyectan como ticks en vivo. */
@Injectable()
export class NdxHistoryService {
  constructor(
    private readonly config: ConfigService,
    private readonly investment: InvestmentAnalysisService,
  ) {}

  async history(from: string, to: string) {
    const start = dateValue(from);
    const end = dateValue(to);
    if (
      end < start ||
      end - start > 365 * 86400000 ||
      to >= marketDate.format(Date.now())
    )
      throw new BadRequestException(
        'Intervalo máximo de 366 fechas; usar días anteriores a hoy en Nueva York',
      );
    const key = this.config.get<string>('MASSIVE_API_KEY')?.trim();
    if (!key) throw new ServiceUnavailableException('ndx_credentials_missing');
    // Fixed official destination and header auth: no keys in URLs or redirects.
    const url = `https://api.massive.com/v2/aggs/ticker/I:NDX/range/1/day/${from}/${to}?sort=asc&limit=50000`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ServiceUnavailableException(`ndx_http_${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1024 * 1024) throw new Error();
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        body?.ticker !== 'I:NDX' ||
        body.status !== 'OK' ||
        body.next_url ||
        (body.results !== undefined && !Array.isArray(body.results)) ||
        (!body.results && body.resultsCount !== 0)
      )
        throw new Error();
      const results = body.results ?? [];
      if (results.length > 366) throw new Error();
      const seen = new Set<string>();
      const bars: IndexDailyBar[] = results.map(
        (row: Record<string, unknown>) => {
          if (
            !row ||
            ![row.o, row.h, row.l, row.c].every(
              (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
            ) ||
            !Number.isSafeInteger(row.t) ||
            (row.t as number) < 0 ||
            (row.t as number) > Date.now()
          )
            throw new Error();
          const date = marketDate.format(row.t as number);
          const { o, h, l, c } = row as {
            o: number;
            h: number;
            l: number;
            c: number;
          };
          if (
            date < from ||
            date > to ||
            seen.has(date) ||
            h < Math.max(o, c, l) ||
            l > Math.min(o, c, h)
          )
            throw new Error();
          seen.add(date);
          return {
            date,
            periodStartMs: row.t as number,
            open: o,
            high: h,
            low: l,
            close: c,
          };
        },
      );
      bars.sort((a, b) => a.periodStartMs - b.periodStartMs);
      return {
        marketReference: {
          targetIndex: 'NDX',
          targetName: 'NASDAQ 100',
          sourceSymbol: 'I:NDX',
          provider: 'massive',
          instrumentType: 'INDEX',
          simulated: false,
          matchesRequiredIndex: true,
        },
        dataMode: 'HISTORICAL_DAILY_CLOSE',
        timeZone: 'America/New_York',
        from,
        to,
        fetchedAtMs: Date.now(),
        bars,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // Never propagate network exceptions, URL, provider response or credentials.
      throw new ServiceUnavailableException('ndx_history_unavailable');
    }
  }

  async evaluate(input: {
    entryDate: string;
    valuationDate: string;
    investedAmount: number;
    upPercent: number;
    downPercent: number;
  }) {
    const history = await this.history(input.entryDate, input.valuationDate);
    const entry = history.bars.find((b) => b.date === input.entryDate);
    const current = history.bars.find((b) => b.date === input.valuationDate);
    if (!entry || !current)
      throw new BadRequestException(
        'No hay cierre para alguna fecha; elegir sesiones publicadas sin sustituir días automáticamente',
      );
    const changePercent = ((current.close - entry.close) / entry.close) * 100;
    return {
      ...history,
      bars: undefined,
      status: 'READY',
      referenceMode: 'ENTRY',
      entryDate: entry.date,
      valuationDate: current.date,
      referencePrice: entry.close,
      price: current.close,
      referenceChangePercent: changePercent,
      ...this.investment.evaluate(changePercent, {
        ...input,
        thresholdBasis: 'INVESTMENT',
      }),
    };
  }
}
