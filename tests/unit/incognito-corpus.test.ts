import { describe, expect, it } from 'vitest';
import { allowValue, createVault, hideValue, maskMessage, unmask } from '../../src/assistant/vault';

/**
 * Deep check for Incognito. Every secret listed must be gone from what leaves the tab, and every benign sentence
 * must leave unchanged. Synthetic values only.
 */
const MUST_HIDE: Array<[label: string, text: string, secrets: string[]]> = [
  ['introduced name', 'Hi, my name is Arjun Rao and I need help.', ['Arjun Rao']],
  ['sign-off name', 'Thanks for the help.\nRegards, Meera Iyer', ['Meera Iyer']],
  ['titled name', 'I spoke to Dr. Kavita Menon yesterday.', ['Kavita Menon']],
  ['relation name', 'My landlord Rohit Kapoor wants more deposit.', ['Rohit Kapoor']],
  ['relation name with is', "My wife's name is Sara Khan.", ['Sara Khan']],
  ['full name after I am', "I'm Priya Sharma from Pune.", ['Priya Sharma']],
  ['email', 'Write to priya.sharma+leases@example.co.in please', ['priya.sharma+leases@example.co.in']],
  ['phone with country code', 'Call me on +91 98765 43210 after 6.', ['98765 43210']],
  ['US phone', 'My number is 415-555-0132.', ['415-555-0132']],
  ['card number', 'Card 4532 0151 1283 0366 was charged twice.', ['4532 0151 1283 0366']],
  ['IBAN', 'Pay to GB82 WEST 1234 5698 7654 32 by Friday.', ['GB82 WEST 1234 5698 7654 32']],
  ['account number', 'My account no. 123456789012 is with HDFC.', ['123456789012']],
  ['IFSC', 'IFSC is HDFC0001234.', ['HDFC0001234']],
  ['UPI id', 'Send it to arjun.rao@okhdfcbank today.', ['arjun.rao@okhdfcbank']],
  ['US SSN', 'SSN 123-45-6789 is on the form.', ['123-45-6789']],
  ['PAN', 'My PAN is ABCDE1234F.', ['ABCDE1234F']],
  ['passport', 'Passport number: K1234567 expires soon.', ['K1234567']],
  ['password', 'my password is Hunter2!x please keep it safe', ['Hunter2!x']],
  ['otp', 'The OTP: 482913 just came in.', ['482913']],
  ['seed phrase', 'seed phrase: apple banana cherry delta echo foxtrot golf hotel india juliet kilo lima', ['apple banana cherry delta echo foxtrot golf hotel india juliet kilo lima']],
  ['OpenAI-style key', 'use sk-proj-abcDEF1234567890ghijKLMN for the test', ['sk-proj-abcDEF1234567890ghijKLMN']],
  ['GitHub token', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked', ['ghp_abcdefghijklmnopqrstuvwxyz0123456789']],
  ['AWS key', 'AKIAIOSFODNN7EXAMPLE is the access key', ['AKIAIOSFODNN7EXAMPLE']],
  ['JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop', ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop']],
  ['NEAR private key', 'ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8tnFQuwoGUC51DowKqorvkr2pytJSnwuSbsNVfqygr', ['ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8tnFQuwoGUC51DowKqorvkr2pytJSnwuSbsNVfqygr']],
  ['ETH wallet', 'My wallet is 0x52908400098527886E0F7030069857D2E4169EE7.', ['0x52908400098527886E0F7030069857D2E4169EE7']],
  ['NEAR account', 'send to arjun-rao.near tomorrow', ['arjun-rao.near']],
  ['address after cue', 'I live at 42 Lotus Court, Baner Road, Pune.', ['42 Lotus Court, Baner Road, Pune']],
  ['street address', 'The flat is 221B Baker Street.', ['221B Baker Street']],
  ['PIN code', 'pin code 411045 for delivery', ['411045']],
  ['UK postcode', 'It is near SW1A 1AA in London.', ['SW1A 1AA']],
  ['IP address', 'My router is at 192.168.1.42 right now.', ['192.168.1.42']],
  ['date of birth', 'My date of birth is 14 March 1994, for the form.', ['14 March 1994']],
  ['website with id', 'Profile: https://example.com/u/arjun-rao-1994', ['https://example.com/u/arjun-rao-1994']],
  // Names with no cue at all
  ['casual first name', 'Can you ask Rohit about the deposit?', ['Rohit']],
  ['lowercase first name', 'rohit said the rent is due monday', ['rohit']],
  ['first and last name', 'Send it to Ananya Krishnan by Friday.', ['Ananya Krishnan']],
  ['two people', 'Meera and Kabir both signed it.', ['Meera', 'Kabir']],
  ['western name', 'Emily thinks the clause is unfair.', ['Emily']],
  ['ambiguous name, capitalised mid-sentence', 'I forwarded it to Mark yesterday.', ['Mark']],
];

const MUST_PASS: string[] = [
  'What should I check before signing a lease?',
  'Is a two month deposit normal in Pune?',
  'The rent goes up 5% every year after the first 11 months.',
  'Can my landlord enter without notice?',
  'Write a polite message asking my landlord to fix a leak.',
  'I am happy with the terms but worried about the lock-in.',
  'Summarise clause 7 in plain words.',
  'The meeting is on 12 March at 3 pm.',
  'How much is INR 32,000 in USD?',
  'Thanks, that helps a lot!',
  'My friend said this is common.',
  'What does pin code mean on a form?',
  'Version 2.1.3 of the app crashed.',
  // Words that are also names must not be hidden when used as words
  'Will you help me with this?',
  'I will mark the clause and hope for the best.',
  'May I ask about the June rent?',
  'The rose garden is shared.',
  'Grace period is 5 days.',
  'Is this a harsh penalty?',
  'The deposit was paid in 2024.',
];

describe('Incognito deep check', () => {
  for (const [label, text, secrets] of MUST_HIDE) {
    it(`hides ${label}`, () => {
      const { outgoing, hidden, vault } = maskMessage(text, createVault());
      for (const secret of secrets) expect(outgoing, `${label}: "${outgoing}"`).not.toContain(secret);
      expect(hidden.length).toBeGreaterThan(0);
      // Swapping back on screen restores the original exactly.
      expect(unmask(outgoing, vault)).toBe(text);
    });
  }

  for (const text of MUST_PASS) {
    it(`leaves alone: ${text}`, () => {
      expect(maskMessage(text, createVault()).outgoing).toBe(text);
    });
  }

  it('lets the user hide anything by hand, everywhere and for the rest of the chat', () => {
    const vault = hideValue(createVault(), 'Project Bluebird');
    const first = maskMessage('Project Bluebird is late; project bluebird needs a budget.', vault);
    expect(first.outgoing).toBe('[HIDDEN-1] is late; [HIDDEN-1] needs a budget.');
    expect(maskMessage('Any news on Project Bluebird?', first.vault).outgoing).toBe('Any news on [HIDDEN-1]?');
  });

  it('lets the user cancel a wrong hide, and undo that', () => {
    // The x on a preview chip allows exactly the value that was detected.
    const detected = maskMessage('Is 221B Baker Street a real address?', createVault()).hidden[0]?.value ?? '';
    expect(detected).toBe('221B Baker Street');
    expect(maskMessage('Is 221B Baker Street a real address?', allowValue(createVault(), detected)).outgoing).toBe('Is 221B Baker Street a real address?');
    const allowedName = allowValue(createVault(), 'Rohit Kapoor');
    expect(maskMessage('My landlord Rohit Kapoor called.', allowedName).outgoing).toBe('My landlord Rohit Kapoor called.');
    const hiddenAgain = hideValue(allowedName, 'Rohit Kapoor');
    expect(maskMessage('My landlord Rohit Kapoor called.', hiddenAgain).outgoing).not.toContain('Rohit');
  });

  it('strict mode also hides unusual proper nouns, long numbers and codes', () => {
    const text = 'Meet at Zorblax Labs near Koregaon, ref ZX9K42Q, ticket 88231 from 2024.';
    const normal = maskMessage(text, createVault()).outgoing;
    expect(normal).toContain('Zorblax');
    const strict = maskMessage(text, createVault(), { strict: true });
    for (const value of ['Zorblax Labs', 'Koregaon', 'ZX9K42Q', '88231']) expect(strict.outgoing).not.toContain(value);
    expect(strict.outgoing).toContain('2024');
    expect(unmask(strict.outgoing, strict.vault)).toBe(text);
    expect(maskMessage('What should I check before signing a lease?', createVault(), { strict: true }).outgoing).toBe('What should I check before signing a lease?');
  });

  it('never hides part of a word because of a short known value', () => {
    const vault = maskMessage('my password is cat', createVault()).vault;
    expect(maskMessage('Which category is this?', vault).outgoing).toBe('Which category is this?');
  });
});
