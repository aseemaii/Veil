interface ParseResponse {
  id: string;
  ok: boolean;
  text?: string;
  pages?: number;
  error?: string;
}

export async function parseDocument(file: File): Promise<{ text: string; pages: number }> {
  const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (!event.data.ok || event.data.text === undefined) {
        reject(new Error(event.data.error ?? 'The document could not be read.'));
        return;
      }
      resolve({ text: event.data.text, pages: event.data.pages ?? 1 });
    });
    worker.addEventListener('error', () => {
      worker.terminate();
      reject(new Error('The on-device document parser failed. Try pasting the text instead.'));
    });
    worker.postMessage({ id, name: file.name, type: file.type, buffer }, [buffer]);
  });
}
