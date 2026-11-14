import { describe, expect, it } from 'vitest';
import { detect } from '../../src/detect';
import { mask, restore } from '../../src/mask/masker';

describe('mask', () => {
  it('uses one stable placeholder for every occurrence and restores locally', () => {
    const text = 'Tenant: Ananya Rao\nAnanya Rao agrees. Ananya\nRao signs.';
    const proposals = detect(text);
    const result = mask(text, proposals);
    expect(result.outgoing.match(/\[TENANT\]/g)).toHaveLength(3);
    expect(restore(result.outgoing, result.map)).toBe(text);
  });

  it('preserves possessives outside the replaced span', () => {
    const text = "Landlord: Vikram Mehta\nVikram Mehta's notice applies.";
    const result = mask(text, detect(text));
    expect(result.outgoing).toContain("[LANDLORD]'s notice");
  });
});
