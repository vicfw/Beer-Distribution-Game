import { describe, expect, it } from 'vitest';
import { formatCost, parseDemand } from './money';
import { acceptSnapshot } from './snapshots';

describe('formatCost', () => {
  it('renders cents as a short decimal', () => {
    expect(formatCost(600)).toBe('6.0');
    expect(formatCost(650)).toBe('6.5');
    expect(formatCost(655)).toBe('6.55');
    expect(formatCost(39400)).toBe('394.0');
  });
});

describe('parseDemand', () => {
  it('accepts a list of whole numbers and rejects junk', () => {
    expect(parseDemand('4, 4 8')).toEqual([4, 4, 8]);
    expect(parseDemand('4.5')).toBeNull();
    expect(parseDemand('')).toBeNull();
  });
});

describe('acceptSnapshot', () => {
  it('keeps the newer version and ignores a stale one', () => {
    const current = { version: 4, round: 2 };
    expect(acceptSnapshot(current, { version: 3, round: 9 })).toEqual(current);
    expect(acceptSnapshot(current, { version: 5, round: 3 })).toEqual({ version: 5, round: 3 });
    expect(acceptSnapshot(null, { version: 1, round: 1 })).toEqual({ version: 1, round: 1 });
  });
});
