import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';

const port = 9333;
const pageUrl = process.env.FINEPRINT_DEV_URL ?? 'http://127.0.0.1:4173/tests/browser/smoke.html';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/fineprint-chrome-${process.pid}`,
  pageUrl,
], { stdio: 'ignore' });

async function targetSocket() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === 'page' && target.url.includes('/tests/browser/smoke.html'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
    await wait(100);
  }
  throw new Error('Chrome debugging endpoint did not become ready');
}

try {
  const socketUrl = await targetSocket();
  await wait(1_000);
  const socket = new WebSocket(socketUrl);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser verification exceeded 90 seconds')), 90_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise((resolve) => {
            const read = () => {
              const result = document.body.dataset.result;
              if (result) resolve({ result, text: document.getElementById('result')?.textContent ?? '' });
            };
            read();
            const observer = new MutationObserver(read);
            observer.observe(document.body, { attributes: true, childList: true, subtree: true });
          })`,
        },
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      const value = message.result?.result?.value;
      if (!value) reject(new Error(message.result?.exceptionDetails?.text ?? 'Browser returned no result'));
      else resolve(value);
    });
    socket.addEventListener('error', () => reject(new Error('Chrome debugging socket failed')));
  });
  process.stdout.write(`${result.text}\n`);
  process.exitCode = result.result === 'pass' ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGTERM');
}
