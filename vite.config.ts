import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// Serve the same security headers as production (public/_headers) from `vite preview`.
function previewHeaders() {
  const headers: Record<string, string> = {};
  const source = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  for (const line of source.split('\n')) {
    const match = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (match?.[1] && match[2]) headers[match[1]] = match[2].trim();
  }
  return headers;
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  build: {
    sourcemap: true,
  },
  preview: {
    headers: previewHeaders(),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
