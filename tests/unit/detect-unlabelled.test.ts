import { describe, expect, it } from 'vitest';
import { detect } from '../../src/detect';
import { mask } from '../../src/mask/masker';

const STUDENT_PDF = `[Page 1 of 2]
Nikhil Singh S
12502417
CA2 CAP415
Code

[Page 2 of 2]
Diagram:
Link:
h<ps://wokwi.com/projects/479304335275409409`;

describe('detect: documents without labels', () => {
  it('masks an unlabelled name line, a bare ID number and a link', () => {
    const values = detect(STUDENT_PDF).map((proposal) => proposal.text);
    expect(values).toContain('Nikhil Singh S');
    expect(values).toContain('12502417');
    expect(values.some((value) => value.startsWith('h<ps://wokwi.com'))).toBe(true);
    const outgoing = mask(STUDENT_PDF, detect(STUDENT_PDF)).outgoing;
    for (const secret of ['Nikhil', 'Singh', '12502417', 'wokwi']) expect(outgoing).not.toContain(secret);
  });

  it('masks a link wrapped onto a second line and a name with non-breaking spaces', () => {
    const text = 'Nikhil\u00a0Singh\u00a0S\u00a0\nLink:\nh<ps://wokwi.com/projects/47930433527540\n9409\nEnd';
    const outgoing = mask(text, detect(text)).outgoing;
    for (const secret of ['Nikhil', 'wokwi', '9409']) expect(outgoing).not.toContain(secret);
    expect(outgoing).toContain('End');
  });

  it('masks labelled names and ids', () => {
    const text = 'Student Name: Asha Verma\nRoll No: AB-1234\nSigned by: Ravi K';
    const values = detect(text).map((proposal) => proposal.text);
    expect(values).toEqual(expect.arrayContaining(['Asha Verma', 'AB-1234', 'Ravi K']));
  });

  it('leaves headings, amounts and short numbers alone', () => {
    const text = 'Security Deposit\nResidential Lease Agreement\nRent is INR 320000 per year and 1,92,000 deposit.\nFloor 12 of 40.';
    const values = detect(text).map((proposal) => proposal.text);
    expect(values).toEqual([]);
  });
});
