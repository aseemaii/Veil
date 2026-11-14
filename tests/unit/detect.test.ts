import { describe, expect, it } from 'vitest';
import { detect } from '../../src/detect';
import { SAMPLE_LEASE } from '../../src/sample/lease';

describe('detect', () => {
  it('finds planted identifiers and excludes checksum failures', () => {
    const proposals = detect(SAMPLE_LEASE);
    const values = proposals.map((proposal) => proposal.text);
    expect(values).toContain('Vikram Mehta');
    expect(values).toContain('Ananya Rao');
    expect(values).toContain('GB82 WEST 1234 5698 7654 32');
    expect(values).toContain('4532 0151 1283 0366');
    expect(values).toContain('2345 6789 0124');
    expect(values).not.toContain('4532015112830367');
    expect(values).not.toContain('2345 6789 0123');
  });

  it('returns stable proposal ids', () => {
    expect(detect(SAMPLE_LEASE).map(({ id }) => id)).toEqual(detect(SAMPLE_LEASE).map(({ id }) => id));
  });
});
