import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/fonts.css';
import './ui/tokens.css';
import './ui/app.css';
import { App } from './App';
import { installLedger } from './ledger/fetch';

// Must run before any module constructs an SDK or wallet client that captures fetch.
installLedger();

const root = document.getElementById('root');
if (!root) throw new Error('Veil root element is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
