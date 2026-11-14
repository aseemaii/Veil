import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from '../router';

/**
 * The Veil mark: a V drawn as three connected nodes (you, the verified enclave, and the link between them)
 * under a veil arc. It reads as a letter and as a sealed connection.
 */
export function LogoMark({ size = 16, color = '#02121f' }: { size?: number; color?: string }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path className="logo-veil" d="M3.5 6.2C8.6 2.6 15.4 2.6 20.5 6.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.55" />
      <path className="logo-link" d="M6 9.2 12 19.2 18 9.2" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle className="logo-node" cx="6" cy="9.2" r="2.3" fill={color} />
      <circle className="logo-node" cx="18" cy="9.2" r="2.3" fill={color} />
      <circle className="logo-node logo-node--core" cx="12" cy="19.2" r="2.6" fill={color} />
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: '/' | '/chat' }) {
  return (
    <Link className="logo" to={to} aria-label="Veil home">
      <i aria-hidden="true"><LogoMark size={16} /></i>
      Veil
    </Link>
  );
}

export function LimitsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native dialog already closes on Escape; the click only handles the backdrop.
    <dialog ref={ref} aria-labelledby="limits-title" onClose={onClose} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
      <div className="in">
        <h3 id="limits-title">What the checks do not prove</h3>
        <ul>
          <li>Attestation shows what hardware and configuration produced the evidence. It does not prove that the software inside is free of flaws.</li>
          <li>NEAR AI reported on 9 Nov 2026 that an inference-software flaw allowed code execution on one server and could have exposed requests being processed there, including confidential-mode requests. NEAR AI reports that it fixed the flaw.</li>
          <li>Encryption protects the path to the enclave, not data inside a compromised inference process. This is why Veil masks identifying details before sending.</li>
          <li>The masked text still contains clauses, amounts and dates. Masking is pattern-based and can miss a name or address written another way. A compromised device defeats every protection here.</li>
        </ul>
        <p className="dialog-links"><a href="https://near.ai/blog/security-incident-report-sglang-vulnerability" rel="noreferrer" target="_blank">Read the incident report</a></p>
        <button className="btn primary" type="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

/** Fades a block in when it scrolls into view; content stays visible without script or with reduced motion. */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setShown(true);
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={shown ? 'reveal in' : 'reveal'}>{children}</div>;
}
