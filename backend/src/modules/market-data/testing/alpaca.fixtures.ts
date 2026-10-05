// Datos sintéticos: no representan cotizaciones actuales ni credenciales reales.
export { MOCK_ALPACA_CREDENTIALS } from '../alpaca.protocol';

export interface AlpacaTradeFixture {
  T: 't';
  S: string;
  i: number;
  x: string;
  p: number;
  s: number;
  c: string[];
  t: string;
  z: string;
}

export function createTradeFixture(
  overrides: Partial<AlpacaTradeFixture> = {},
): AlpacaTradeFixture {
  return {
    T: 't',
    S: 'QQQ',
    i: 1,
    x: 'V',
    p: 550.25,
    s: 10,
    t: '2026-10-05T14:00:00.123456789Z',
    z: 'C',
    ...overrides,
    c: [...(overrides.c ?? ['@'])],
  };
}

export function createTradeBatch(): AlpacaTradeFixture[] {
  // IDs distintos, incluso con igual precio y timestamp.
  return [createTradeFixture(), createTradeFixture({ i: 2, s: 20 })];
}

export function createInvalidFrames(): Readonly<Record<string, string>> {
  const { t: omittedTimestamp, ...withoutTimestamp } = createTradeFixture();
  void omittedTimestamp;
  return Object.freeze({
    malformedJson: '[{',
    nonArray: JSON.stringify(createTradeFixture()),
    negativePrice: JSON.stringify([createTradeFixture({ p: -1 })]),
    wrongSymbol: JSON.stringify([createTradeFixture({ S: 'NDX' })]),
    missingTimestamp: JSON.stringify([withoutTimestamp]),
    unsafeId: JSON.stringify([
      createTradeFixture({ i: Number.MAX_SAFE_INTEGER + 1 }),
    ]),
  });
}
