import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chat } from './pages/Chat';
import { History } from './pages/History';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { navigate, type Route, useRoute } from './router';
import type { WalletUnlock } from './history/crypto';
import { clearTab, loadTabLogin, saveTabLogin } from './history/tab';
import { connectNearWallet, disconnectNearWallet } from './wallet/near';

export interface Auth {
  unlock?: WalletUnlock;
  connecting: boolean;
  error?: string;
  connect: (to?: Route) => Promise<void>;
  logout: () => Promise<void>;
}

export function App() {
  const route = useRoute();
  // A refresh keeps the login for this tab (sessionStorage), so the wallet is not asked again.
  const [unlock, setUnlock] = useState<WalletUnlock | undefined>(loadTabLogin);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  const connect = useCallback(async (to: Route = '/chat') => {
    setConnecting(true);
    setError(undefined);
    try {
      const signedIn = await connectNearWallet();
      saveTabLogin(signedIn);
      setUnlock(signedIn);
      navigate(to);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The NEAR wallet could not connect.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const logout = useCallback(async () => {
    clearTab();
    setUnlock(undefined);
    navigate('/');
    try {
      await disconnectNearWallet();
    } catch {
      // The local session is already cleared; a wallet that fails to disconnect holds no Veil data.
    }
  }, []);

  const auth = useMemo<Auth>(() => ({ unlock, connecting, error, connect, logout }), [unlock, connecting, error, connect, logout]);

  useEffect(() => {
    if (route === '/chat' && !unlock) navigate('/login', true);
    if (route === '/login' && unlock) navigate('/chat', true);
  }, [route, unlock]);

  if (route === '/chat') return unlock ? <Chat auth={auth} unlock={unlock} /> : null;
  if (route === '/history') return <History auth={auth} />;
  if (route === '/login') return unlock ? null : <Login auth={auth} />;
  return <Landing auth={auth} />;
}
