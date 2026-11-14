import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';

// Usage: node scripts/screens.mjs <outDir>. Needs `npm run dev` on 5173 and Google Chrome.
const base = process.env.FINEPRINT_DEV_URL ?? 'http://localhost:5173';
const out = process.argv[2] ?? '/tmp/fineprint-screens';
const port = 9444;
await mkdir(out, { recursive: true });

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/fineprint-shots-${process.pid}`, 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = list.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await wait(100);
  }
  throw new Error('Chrome did not start');
}

const socket = new WebSocket(await connect());
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
let failed = false;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve) => {
  nextId += 1;
  pending.set(nextId, resolve);
  socket.send(JSON.stringify({ id: nextId, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');

async function shot(name, width, height, url, steps = async () => undefined) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url });
  await wait(1800);
  await steps();
  const overflow = await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  if (overflow) failed = true;
  const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${out}/${name}-${width}.png`, Buffer.from(result.data, 'base64'));
  process.stdout.write(`${name}-${width}: horizontal overflow ${overflow}\n`);
}
const clickText = (text) => evaluate(`(() => { const el = [...document.querySelectorAll('button,a')].find((e) => e.textContent.includes(${JSON.stringify(text)})); el?.click(); return Boolean(el); })()`);

try {
  for (const width of [1440, 390]) {
    await shot('landing', width, 900, `${base}/`);
    await shot('login', width, 900, `${base}/login`);
    if (process.env.SCREENS_ONLY_PUBLIC) continue;
    await shot('chat-drawer', width, 900, `${base}/tests/browser/chat.html`, async () => {
      await clickText('Use the sample lease');
      await wait(300);
      await clickText('Details');
      await wait(300);
      await clickText('History');
      await wait(300);
    });
    await shot('chat-empty', width, 900, `${base}/tests/browser/chat.html`);
    await shot('chat-review', width, 900, `${base}/tests/browser/chat.html`, async () => {
      await clickText('Use the sample lease');
      await wait(600);
    });
    await shot('chat-outgoing', width, 900, `${base}/tests/browser/chat.html`, async () => {
      await clickText('Use the sample lease');
      await wait(400);
      await clickText('Approve this text');
      await wait(600);
    });
  }
  process.stdout.write(`console errors: ${consoleErrors.length ? `\n${consoleErrors.join('\n')}` : 'none'}\n`);
  if (consoleErrors.length) failed = true;
} finally {
  socket.close();
  chrome.kill();
}
process.exitCode = failed ? 1 : 0;
