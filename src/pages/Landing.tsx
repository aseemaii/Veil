import { useEffect, useMemo, useState } from 'react';
import type { Auth } from '../App';
import { detect } from '../detect';
import { mask } from '../mask/masker';
import { sha256Hex } from '../receipt/receipt';
import { Link } from '../router';
import { SAMPLE_LEASE } from '../sample/lease';
import { LimitsDialog, Logo, Reveal } from '../ui/components';
import { PRIVATE_TEE_MODELS } from '../gate/gate';
import { preloadWallet } from '../wallet/near';

const MARQUEE = ['Name', 'Email', 'Phone number', 'Card number', 'Aadhaar-style ID', 'IBAN', 'PAN-style ID', 'Property address'];

const STEPS = [
  ['01', 'Mask on your device', 'Names, emails, phone numbers, card and ID numbers and addresses become tokens like [LANDLORD]. Card, Aadhaar-style and IBAN numbers must pass their checksum to count.'],
  ['02', 'Check the enclave first', 'The page verifies the NEAR AI gateway and the model enclave (Intel TDX and NVIDIA GPU evidence, fresh nonce) before any request that carries your text. If a check fails, nothing is sent.'],
  ['03', 'Send one encrypted request', 'Only the masked text goes, encrypted to the verified model key, after you approve it and enter your own NEAR AI Cloud key.'],
  ['04', 'Restore and keep a receipt', 'Names come back on your device only. The receipt records the signer, the signature and hashes of what was sent and what came back.'],
] as const;

const LIMITS = [
  ['Masking is pattern-based', 'It finds emails, phone numbers, checksum-valid card, Aadhaar-style and IBAN numbers, PAN-style IDs, and names that follow a Landlord: or Tenant: label. A detail written another way can be missed, so read the Outgoing view before approving.'],
  ['Attestation reduces risk, it does not remove it', 'It shows which code and hardware answered. It does not make a provider infallible, and software in the serving stack can have flaws. NEAR AI reported such a flaw on 9 Nov 2026.'],
  ['Free, or bring your key', 'Use the free shared key with no extra signature, or your own NEAR AI Cloud key, held in memory only and sent only to cloud-api.near.ai after the checks pass.'],
  ['Not legal advice', 'The report points at clauses and suggests questions to ask. The model can be wrong. Have a lawyer or a tenant-rights group look at an agreement before you sign it.'],
] as const;

function Art() {
  return (
    <svg className="art" viewBox="0 0 520 380" role="img" aria-label="A lease with details inked out, then sent as an encrypted packet to a verified enclave">
      <defs>
        <linearGradient id="sweepg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0091fd" stopOpacity="0" />
          <stop offset="1" stopColor="#0091fd" stopOpacity=".5" />
        </linearGradient>
      </defs>
      <g className="float">
        <rect className="sheet" x="20" y="30" width="240" height="300" rx="10" />
        <rect className="ln" x="44" y="62" width="120" height="7" rx="3" />
        <rect className="ln" x="44" y="92" width="180" height="7" rx="3" />
        <rect className="ink k1" x="44" y="122" width="96" height="9" rx="3" />
        <rect className="ln" x="150" y="123" width="60" height="7" rx="3" />
        <rect className="ln" x="44" y="152" width="170" height="7" rx="3" />
        <rect className="ink k2" x="44" y="182" width="140" height="9" rx="3" />
        <rect className="ln" x="44" y="212" width="150" height="7" rx="3" />
        <rect className="ink k3" x="44" y="242" width="110" height="9" rx="3" />
        <rect className="ln" x="164" y="243" width="60" height="7" rx="3" />
        <rect className="ink k4" x="44" y="272" width="126" height="9" rx="3" />
        <rect className="sweep" x="20" y="30" width="240" height="14" />
      </g>
      <path className="guide" d="M250 150 C 330 190, 400 210, 440 280" />
      <circle className="packet" r="5" />
      <g className="float b">
        <circle className="pulse" cx="440" cy="296" r="46" />
        <polygon className="slab-side" points="390,300 440,326 490,300 490,318 440,344 390,318" />
        <polygon className="slab-top" points="440,274 490,300 440,326 390,300" />
        <text x="404" y="364">ENCLAVE</text>
      </g>
      <text x="44" y="352">MASKED ON DEVICE</text>
    </svg>
  );
}

function Terminal() {
  const [hash, setHash] = useState('…');
  const lines = useMemo(() => {
    const proposals = detect(SAMPLE_LEASE);
    const result = mask(SAMPLE_LEASE, proposals);
    return { chars: SAMPLE_LEASE.length, found: proposals.length, tokens: [...result.map.toValue.keys()].slice(0, 4), outgoing: result.outgoing };
  }, []);
  // Warm the wallet list in the background so "Log in" opens the selector quickly.
  useEffect(() => {
    const timer = window.setTimeout(preloadWallet, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let live = true;
    void sha256Hex(lines.outgoing).then((value) => {
      if (live) setHash(value.slice(0, 16));
    });
    return () => {
      live = false;
    };
  }, [lines.outgoing]);

  const script: Array<[string, string]> = [
    ['p', '$ '], ['w', 'fineprint load sample-lease.txt\n'],
    ['f', `  ${lines.chars.toLocaleString('en-US')} characters read · stays in this tab\n`],
    ['p', '$ '], ['w', 'fineprint mask\n'],
    ['f', `  ${lines.found} details found · `], ['g', `${lines.found} masked\n`],
    ['f', `  tokens: ${lines.tokens.join(' ')} …\n`],
    ['p', '$ '], ['w', 'fineprint approve\n'],
    ['f', `  outgoing sha256 ${hash}… locked\n`],
    ['p', '$ '], ['w', 'fineprint ledger\n'],
    ['g', '  0 requests carried your document\n'],
  ];
  const total = script.reduce((sum, [, part]) => sum + part.length, 0);
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (hash === '…') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(total);
      return;
    }
    let count = 0;
    const timer = setInterval(() => {
      count += 2;
      setTyped(count);
      if (count >= total) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [hash, total]);

  let budget = typed;
  return (
    <section className="term" aria-label="Example terminal session">
      <header><i /><i /><i /><span>fineprint · the real masking code on the sample lease</span></header>
      <pre>
        {script.map(([kind, part], index) => {
          const shown = part.slice(0, Math.max(0, budget));
          budget -= part.length;
          return shown ? <span className={kind} key={`${kind}-${index}`}>{shown}</span> : null;
        })}
        {typed < total && <span className="caret" />}
      </pre>
    </section>
  );
}

export function Landing({ auth }: { auth: Auth }) {
  const [limitsOpen, setLimitsOpen] = useState(false);
  const loggedIn = Boolean(auth.unlock);
  return (
    <>
      <header className="nav" id="top">
        <div className="wrap">
          <Logo />
          <nav aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#compare">Compare</a>
            <a href="#limits">Limits</a>
          </nav>
          <div className="nav-actions">
            {loggedIn ? (
              <>
                <Link className="btn primary sm" to="/chat">Open chat</Link>
                <button className="btn sm" type="button" onClick={() => void auth.logout()}>Log out</button>
              </>
            ) : (
              <>
                <Link className="btn sm" to="/login">Log in</Link>
                <Link className="btn primary sm" to="/login">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap">
            <div>
              <span className="eyebrow rise d1">Private document review</span>
              <h1 className="rise d2">Read the fine print without <em>handing it over.</em></h1>
              <p className="lede rise d3">Veil masks the personal details in a rental agreement on your device, checks the enclave before sending anything, and returns a plain-language risk report with a receipt you can keep.</p>
              <div className="cta rise d4">
                <Link className="btn primary" to={loggedIn ? '/chat' : '/login'}>{loggedIn ? 'Open the chat' : 'Log in with NEAR'} <span className="arr" aria-hidden="true">→</span></Link>
                <a className="btn" href="#how">How it works</a>
              </div>
              <p className="note rise d5">Built for NEAR HACKATHON 2026, Privacy &amp; Private AI track. Not legal advice.</p>
            </div>
            <div className="rise d3"><Art /></div>
          </div>
        </section>

        <section className="marquee" aria-label="Kinds of details Veil masks">
          <div className="track" aria-hidden="true">
            {[...MARQUEE, ...MARQUEE].map((item, index) => <span key={`${item}-${index}`}><b>▸</b>{item}</span>)}
          </div>
        </section>

        <section className="s">
          <div className="wrap">
            <Reveal>
              <div className="sh">
                <span className="eyebrow">By the numbers</span>
                <h2>Built around one decision you control.</h2>
                <p>Nothing leaves until you have seen exactly what would be sent and approved it.</p>
              </div>
            </Reveal>
            <Reveal>
              <div className="stats">
                <div><strong>0</strong><p>requests carry your document before you approve</p></div>
                <div><strong>1</strong><p>encrypted request after the enclave checks pass</p></div>
                <div><strong>{PRIVATE_TEE_MODELS.length}</strong><p>Private TEE models offered; no other model can be selected</p></div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="s" id="how">
          <div className="wrap">
            <Reveal>
              <div className="sh">
                <span className="eyebrow">How it works</span>
                <h2>Mask, check, send, keep the receipt.</h2>
                <p>The terminal runs the real masking code on the synthetic sample lease, in this page.</p>
              </div>
            </Reveal>
            <div className="how">
              <Reveal><Terminal /></Reveal>
              <div className="steps">
                {STEPS.map(([number, title, body]) => (
                  <Reveal key={number}>
                    <div className="card"><span className="n">{number}</span><h3>{title}</h3><p>{body}</p></div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="s" id="compare">
          <div className="wrap">
            <Reveal>
              <div className="sh">
                <span className="eyebrow">Compared with pasting into a chat box</span>
                <h2>What changes in the workflow.</h2>
              </div>
            </Reveal>
            <Reveal>
              <table className="tbl">
                <thead><tr><th scope="col"><span className="sr">Topic</span></th><th scope="col">Paste it into a chat box</th><th scope="col" className="us">Veil</th></tr></thead>
                <tbody>
                  <tr><td>What leaves your device</td><td>Everything you paste</td><td className="us">Masked text only, after you approve the list</td></tr>
                  <tr><td>Who checks the server</td><td>You trust it</td><td className="us">The page verifies enclave attestation evidence first</td></tr>
                  <tr><td>Proof afterwards</td><td>None</td><td className="us">A receipt with the signer, signature and hashes</td></tr>
                  <tr><td>What you get back</td><td>A general summary</td><td className="us">Quoted clauses, each with a question to ask</td></tr>
                  <tr><td>Names in the answer</td><td>Whatever you sent</td><td className="us">Restored on your device only</td></tr>
                  <tr><td>Your saved chats</td><td>On a provider's server</td><td className="us">An encrypted file only your wallet can open</td></tr>
                </tbody>
              </table>
            </Reveal>
          </div>
        </section>

        <section className="s" id="limits">
          <div className="wrap">
            <Reveal>
              <div className="sh">
                <span className="eyebrow">Limits</span>
                <h2>What to know before you rely on it.</h2>
              </div>
            </Reveal>
            <div className="limits-grid">
              {LIMITS.map(([title, body]) => (
                <Reveal key={title}><div className="card"><h3>{title}</h3><p>{body}</p></div></Reveal>
              ))}
            </div>
            <p className="limits-more"><button className="btn sm" type="button" onClick={() => setLimitsOpen(true)}>Read the full limits</button></p>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div>
            <Logo />
            <p className="foot-note">Built for NEAR HACKATHON 2026, Privacy &amp; Private AI track.</p>
          </div>
          <div className="cols">
            <div>
              <h6>Page</h6>
              <ul>
                <li><a href="#how">How it works</a></li>
                <li><a href="#limits">Limits</a></li>
                <li><Link to="/login">Log in</Link></li>
              </ul>
            </div>
            <div>
              <h6>References</h6>
              <ul>
                <li><a href="https://docs.near.ai/" target="_blank" rel="noreferrer">NEAR AI docs</a></li>
                <li><a href="https://nearhackathon.com" target="_blank" rel="noreferrer">NEAR HACKATHON</a></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
      <LimitsDialog open={limitsOpen} onClose={() => setLimitsOpen(false)} />
    </>
  );
}
