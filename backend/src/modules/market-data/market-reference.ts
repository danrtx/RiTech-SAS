import { MarketDataConfig } from './market-data.config';

/** Fuente real del cálculo: nunca presentar QQQ como si fuera el índice NDX. */
export function describeMarketReference(config: MarketDataConfig) {
  return {
    targetIndex: 'NDX' as const,
    targetName: 'NASDAQ 100',
    sourceSymbol: config.symbol,
    provider: config.provider,
    feed: config.feed,
    instrumentType:
      config.symbol === 'QQQ' ? ('ETF_PROXY' as const) : ('TEST' as const),
    simulated: config.feed === 'mock' || config.feed === 'test',
    matchesRequiredIndex: false,
  };
}

export type MarketReference = ReturnType<typeof describeMarketReference>;
