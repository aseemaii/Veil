import { createRoot } from 'react-dom/client';
import '../../src/ui/fonts.css';
import '../../src/ui/tokens.css';
import '../../src/ui/app.css';
import { installLedger } from '../../src/ledger/fetch';
import { Chat } from '../../src/pages/Chat';

// Renders the real Chat page with a stand-in wallet so layout can be checked without a wallet popup.
installLedger();
const unlock = { accountId: 'tenant-demo.near', publicKey: 'ed25519:demo', signature: 'demo', walletId: 'demo', walletName: 'Demo wallet' };
const root = document.getElementById('root');
if (root) createRoot(root).render(<Chat auth={{ unlock, connecting: false, connect: async () => undefined, logout: async () => undefined }} unlock={unlock} />);
