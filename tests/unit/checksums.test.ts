import { describe, expect, it } from 'vitest';
import { passesIban, passesLuhn, passesVerhoeff } from '../../src/detect/checksums';

describe('identifier checksums', () => {
  it('accepts valid Luhn values and rejects lookalikes', () => {
    expect(passesLuhn('4532 0151 1283 0366')).toBe(true);
    expect(passesLuhn('4532 0151 1283 0367')).toBe(false);
  });

  it('accepts a valid IBAN', () => {
    expect(passesIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(passesIban('GB82 WEST 1234 5698 7654 31')).toBe(false);
  });

  it('validates the synthetic Aadhaar-style value', () => {
    expect(passesVerhoeff('2345 6789 0124')).toBe(true);
    expect(passesVerhoeff('2345 6789 0123')).toBe(false);
  });
});
