import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { solveViaLocalSolver } from './captcha.js';

test('local solver sends authenticated widget data and rejects remote endpoints', async () => {
  const previous = process.env.CAPTCHA_SOLVER_SECRET;
  process.env.CAPTCHA_SOLVER_SECRET = 'fixture-secret';
  let received: any;
  const server = createServer((req, res) => {
    if (req.url !== '/solve' || req.headers.secret !== 'fixture-secret') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'fixture-token-'.repeat(4) }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const page = {
    url: () => 'https://example.test/job',
    evaluate: async (fn: Function) => String(fn).includes('navigator.userAgent') ? 'Fixture Browser' : ({ siteKey: 'fixture-key', turnstile: true, action: 'apply', cdata: 'fixture' }),
  };
  try {
    const result = await solveViaLocalSolver(page as never, `http://127.0.0.1:${address.port}`);
    assert.equal(result?.turnstile, true);
    assert.equal(received.site_url, 'https://example.test/job');
    assert.equal(received.site_key, 'fixture-key');
    assert.equal(received.action, 'apply');
    assert.equal(received.cdata, 'fixture');
    assert.equal(received.user_agent, 'Fixture Browser');
    assert.equal(await solveViaLocalSolver(page as never, 'https://attacker.example'), null);
  } finally {
    server.close();
    await once(server, 'close');
    if (previous === undefined) delete process.env.CAPTCHA_SOLVER_SECRET; else process.env.CAPTCHA_SOLVER_SECRET = previous;
  }
});
