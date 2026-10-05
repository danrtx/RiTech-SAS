import { PriceHistory } from './price-history';
import { normalizedTick } from '../testing/market-tick.fixture';

describe('Historial circular de precios', () => {
  it('selecciona el último precio en o antes del tiempo objetivo, incluso con timestamps iguales', () => {
    const history = new PriceHistory(10, 10000, 100);
    history.append(normalizedTick(1000, 100, '1'));
    history.append(normalizedTick(2000, 101, '2'));
    history.append(normalizedTick(2000, 102, '3'));
    expect(history.reference(2000)?.price).toBe(102);
    expect(history.reference(1999)).toBeUndefined();
    expect(history.reference(2100)?.price).toBe(102);
    expect(history.reference(2101)).toBeUndefined();
  });

  it('mantiene orden, tamaño y referencias correctas al recorrer el buffer', () => {
    const history = new PriceHistory(3, 10000, 100);
    for (let i = 1; i <= 7; i++) history.append(normalizedTick(i * 1000));
    expect(history.snapshot().map((tick) => tick.eventTimeMs)).toEqual([
      5000, 6000, 7000,
    ]);
    expect(history.getMetadata()).toMatchObject({
      points: 3,
      evictedByCapacity: 4,
    });
    expect(history.reference(4000)).toBeUndefined();
    expect(history.reference(6000)?.eventTimeMs).toBe(6000);
    expect(history.snapshot(1)[0].eventTimeMs).toBe(7000);
  });

  it('conserva el margen de referencia y poda muestras fuera de retención', () => {
    const history = new PriceHistory(10, 1000, 100);
    history.append(normalizedTick(1000));
    history.append(normalizedTick(2100));
    expect(history.reference(1100)?.eventTimeMs).toBe(1000);
    history.append(normalizedTick(2101));
    expect(history.reference(1101)).toBeUndefined();
    expect(history.earliest()?.eventTimeMs).toBe(2100);
    history.clear();
    expect(history.latest()).toBeUndefined();
    expect(history.getMetadata().points).toBe(0);
  });

  it('impide que una inserción desordenada retroceda el precio', () => {
    const history = new PriceHistory(3, 10000, 100);
    history.append(normalizedTick(2000));
    expect(() => history.append(normalizedTick(1000))).toThrow(
      'history_out_of_order',
    );
    expect(history.latest()?.eventTimeMs).toBe(2000);
  });
});
