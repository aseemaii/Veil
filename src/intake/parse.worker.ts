import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ParseRequest {
  id: string;
  name: string;
  type: string;
  buffer: ArrayBuffer;
}

interface ParseResponse {
  id: string;
  ok: boolean;
  text?: string;
  pages?: number;
  error?: string;
}

async function parsePdf(buffer: ArrayBuffer) {
  const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    pages.push(`[Page ${pageNumber} of ${document.numPages}]\n${text}`);
  }
  if (!pages.some((page) => page.replace(/^\[Page .*?\]\s*/, '').trim())) {
    throw new Error('This PDF looks scanned. On-device OCR is not available yet.');
  }
  return { text: pages.join('\n\n'), pages: document.numPages };
}

async function parse(request: ParseRequest) {
  const lowerName = request.name.toLocaleLowerCase();
  if (request.type === 'application/pdf' || lowerName.endsWith('.pdf')) return parsePdf(request.buffer);
  if (request.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ arrayBuffer: request.buffer });
    return { text: result.value, pages: 1 };
  }
  if (request.type === 'text/plain' || lowerName.endsWith('.txt')) {
    return { text: new TextDecoder().decode(request.buffer), pages: 1 };
  }
  throw new Error('Choose a PDF, DOCX or plain-text file.');
}

self.addEventListener('message', async (event: MessageEvent<ParseRequest>) => {
  const response: ParseResponse = { id: event.data.id, ok: false };
  try {
    Object.assign(response, await parse(event.data), { ok: true });
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'The document could not be read.';
  }
  self.postMessage(response);
});
