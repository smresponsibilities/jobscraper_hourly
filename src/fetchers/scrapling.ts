import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function scraplingFetch(
  url: string,
  options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}
): Promise<string> {
  const payload = JSON.stringify({
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
  });

  return new Promise((resolvePromise, reject) => {
    const workerPath = resolve(__dirname, 'scrapling_worker.py');
    const py = spawn('python', [workerPath, payload]);
    
    let stdout = '';
    let stderr = '';
    
    py.stdout.on('data', (data) => stdout += data.toString());
    py.stderr.on('data', (data) => stderr += data.toString());
    
    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Scrapling failed (${code}): ${stderr}`));
      } else {
        resolvePromise(stdout);
      }
    });
  });
}

export async function scraplingJson<T>(
  url: string,
  options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}
): Promise<T> {
  const text = await scraplingFetch(url, options);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Failed to parse Scrapling output as JSON: ${text.slice(0, 200)}`);
  }
}
