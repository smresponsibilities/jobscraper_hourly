import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createServer as portServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MailpitMailbox } from './mailbox.js';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

async function freePort(): Promise<number> {
  const server = portServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

async function smtpMail(port: number, recipient: string, code: string): Promise<void> {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(5000, () => socket.destroy(Error('Local SMTP timed out')));
  let buffer = '';
  const replies: string[] = [];
  let resolveReply: ((line: string) => void) | undefined;
  let rejectReply: ((error: Error) => void) | undefined;
  socket.on('error', error => rejectReply?.(error));
  socket.on('data', data => {
    buffer += data.toString();
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trimEnd(); buffer = buffer.slice(newline + 1);
      if (/^\d{3} /.test(line)) {
        if (resolveReply) { const resolve = resolveReply; resolveReply = undefined; rejectReply = undefined; resolve(line); }
        else replies.push(line);
      }
    }
  });
  const reply = () => replies.length ? Promise.resolve(replies.shift()!) : new Promise<string>((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
  const command = async (text: string, expected: string) => { socket.write(text + '\r\n'); assert((await reply()).startsWith(expected)); };
  try {
    assert((await reply()).startsWith('220'));
    await command('EHLO fixture.local', '250');
    await command('MAIL FROM:<no-reply@greenhouse.io>', '250');
    await command(`RCPT TO:<${recipient}>`, '250');
    await command('DATA', '354');
    await command(`From: no-reply@greenhouse.io\r\nTo: ${recipient}\r\nSubject: Fixture security verification\r\nMessage-ID: <fixture-${Date.now()}-${code}@test.local>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour Fixture verification code is: ${code}\r\n.`, '250');
    await command('QUIT', '221');
  } finally { socket.destroy(); }
}

for (const { split, parked } of [{ split: false, parked: false }, { split: true, parked: false }, { split: true, parked: true }]) test(`real local SMTP → Mailpit → browser OTP → submission receipt, split=${split}, restarted=${parked}`, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'application-otp-'));
  const httpPort = await freePort();
  const smtpPort = await freePort();
  const binary = process.env.MAILPIT_BINARY || path.resolve('out/tools/mailpit', process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');
  assert(existsSync(binary), 'Install the pinned Mailpit test binary; this integration must not silently skip');
  const mailpit = spawn(binary, ['--listen', `127.0.0.1:${httpPort}`, '--smtp', `127.0.0.1:${smtpPort}`, '--database', path.join(directory, 'mail.db')], { windowsHide: true, stdio: 'ignore', env: { ...process.env, MP_DISABLE_VERSION_CHECK: 'true' } });
  let mailError: Error | undefined;
  mailpit.once('error', error => { mailError = error; });
  mailpit.once('exit', code => { if (code !== null && code !== 0) mailError = new Error('Local Mailpit exited with code ' + code); });
  const mailbox = new MailpitMailbox(`http://127.0.0.1:${httpPort}`);
  const runner = new AutoApplyRunner();
  let starts = 0;
  let submissions = 0;
  let sent: Promise<void> | undefined;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/begin') {
      starts++;
      sent = delay(3000).then(async () => { await smtpMail(smtpPort, 'other@example.test', '999999'); await smtpMail(smtpPort, 'fixture@example.test', '123456'); });
      sent.catch(() => {});
      response.end('verification sent'); return;
    }
    if (request.url === '/verify') {
      let data = '';
      request.on('data', chunk => { data += chunk.toString(); });
      request.on('end', () => { if (data === '123456') { submissions++; response.end('accepted'); } else { response.statusCode = 400; response.end('incorrect code'); } });
      return;
    }
    const controls = split ? Array.from({ length: 6 }, (_, index) => `<input aria-label="Security code digit ${index + 1}" autocomplete="one-time-code" maxlength="1" inputmode="numeric">`).join('') : '<label>Security code<input autocomplete="one-time-code"></label>';
    const gate = `<h1>Fixture email verification</h1><p>Enter the security code sent to your email</p>${controls}<button type="button" onclick="fetch('/verify',{method:'POST',body:Array.from(document.querySelectorAll('input')).map(e=>e.value).join('')}).then(r=>{if(r.ok)document.body.innerHTML='<h1>Application submitted</h1>'})">Verify code</button>`;
    response.end(starts ? gate : `<form onsubmit="event.preventDefault();fetch('/begin',{method:'POST'}).then(()=>document.body.innerHTML=${JSON.stringify(gate).replace(/"/g, '&quot;')})"><label>Email<input type="email" required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (mailError) throw mailError;
      try { if ((await fetch(`http://127.0.0.1:${httpPort}/api/v1/messages`)).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert(ready, 'Local Mailpit did not become ready');
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' }, professional: {}, education: [], experience: [], workAuthorization: {}, eeo: {} } as unknown as CandidateExtendedProfile;
    const options = { url: `http://127.0.0.1:${address.port}/`, profile, headless: false, submit: true, mailbox, company: 'Fixture', applicationCountry: 'India', requisition: { provider: 'greenhouse', tenant: 'fixture', jobId: '1', key: 'greenhouse:fixture:1' }, sessionDir: path.join(directory, 'application'), timeoutMs: parked ? 200 : 15000 };
    let report = await runner.run(options);
    await sent;
    if (parked) {
      assert.equal(report.status, 'paused_for_review');
      await runner.close();
      await runner.initBrowser(true);
      for (let attempt = 0; attempt < 20; attempt++) {
        report = await runner.run({ ...options, resume: true });
        if (report.status === 'submitted') break;
        await delay(100);
      }
    }
    assert.equal(report.status, 'submitted', report.reason);
    assert.equal(starts, 1);
    assert.equal(submissions, 1);
    assert(report.verificationMessageId);
    assert(report.logs.every(line => !line.includes('123456') && !line.includes('999999')));
  } finally {
    await runner.close(); await mailbox.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const closed = new Promise<void>(resolve => mailpit.once('close', () => resolve()));
    mailpit.kill(); await closed;
  }
});


