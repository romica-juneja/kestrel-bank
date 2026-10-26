import { describe, expect, it } from 'vitest';
import { parseAmountToCents } from '../src/lib/money.js';

describe('parseAmountToCents', () => {
  it.each([
    ['10', 1000],
    ['10.5', 1050],
    ['10.05', 1005],
    ['0.01', 1],
    [' 7.30 ', 730],
  ])('parses %j exactly', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it('avoids floating point drift', () => {
    expect(parseAmountToCents('0.29')).toBe(29); // 0.29 * 100 === 28.999999999999996 in floats
  });

  it.each(['', '-5', '1.234', 'abc', '1e3', '1,000', '.5', '10.'])('rejects %j', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});
