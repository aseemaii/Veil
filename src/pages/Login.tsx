import { useEffect, useState } from 'react';
import type { Auth } from '../App';
import { Link } from '../router';
import { Logo } from '../ui/components';
import { preloadWallet, WALLET_UNLOCK_MESSAGE } from '../wallet/near';

export function Login({ auth }: { auth: Auth }) {
  const [confirmed, setConfirmed] = useState(false);
  // Start loading the wallet list while the user reads the message, so the selector opens at once.
  useEffect(() => preloadWallet(), []);
  return (
    <div className="auth-page">
      <header className="nav">
        <div className="wrap">
          <Logo />
          <div className="nav-actions"><Link className="btn sm" to="/">Back to home</Link></div>
        </div>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="login-title">
          <span className="eyebrow">Log in</span>
          <h1 id="login-title">Sign in with your NEAR wallet</h1>
          <p className="muted">Your wallet is your login and your key. Veil asks it to sign one message, which unlocks the encrypted files only this wallet can open.</p>

          <ol className="signing-steps">
            <li><strong>1</strong> Choose a NEAR wallet</li>
            <li><strong>2</strong> Confirm your account</li>
            <li><strong>3</strong> Sign the unlock message</li>
          </ol>

          <div className="sign-message">
            <span>Message to sign</span>
            <blockquote>{WALLET_UNLOCK_MESSAGE}</blockquote>
          </div>
          <p className="fine">This creates no transaction, requests no access key and spends no NEAR. The signature stays in memory and derives the local encryption key. Wallets such as HOT, Meteor, Intear, MyNearWallet, Ledger and NEAR Mobile can sign it.</p>

          <label className="confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I reviewed the exact message and want my selected wallet to sign it.
          </label>
          {auth.error && <p className="form-error" role="alert">{auth.error}</p>}
          <button className="btn primary wide" type="button" disabled={!confirmed || auth.connecting} onClick={() => void auth.connect()}>
            {auth.connecting ? 'Waiting for your wallet…' : 'Continue to NEAR wallets'}
          </button>
        </section>

        <aside className="auth-aside" aria-label="What logging in does">
          <h2>What this login does</h2>
          <ul>
            <li><b>No account on a server.</b> Veil has no backend and never receives your signature.</li>
            <li><b>Wallet-locked files.</b> Chats you save are encrypted with a key derived from your wallet's signature. A different wallet cannot open them.</li>
            <li><b>Origin-bound.</b> The signature is bound to this site's address, so another site cannot ask for the same key.</li>
            <li><b>Nothing stored in the clear.</b> Closing the tab or logging out clears the decrypted session from memory.</li>
          </ul>
        </aside>
      </main>
    </div>
  );
}
