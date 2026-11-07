import { randomBytes, createHmac, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveEnvPortalCredentials, ensureWorkdayCompliantPassword } from './env-credentials.js';

function publishExclusive(file: string, data: string | Buffer): boolean {
  const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  try { linkSync(temporary, file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  finally { unlinkSync(temporary); }
}

function protectWindows(value: Buffer, decrypt = false): Buffer {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: value.toString('base64'), windowsHide: true, encoding: 'utf8', timeout: 15000 }).trim(), 'base64');
}

/** Tenant-bound authenticated encryption. Windows stores master key with user DPAPI. */
interface VaultCredential {
  email: string;
  password: string;
  recovery?: { requestedAt: string; attempts: number; revision: number; confirmed: boolean };
}

export class CredentialVault {
  private key: Buffer;
  constructor(private directory: string, key?: Buffer) {
    mkdirSync(directory, { recursive: true });
    if (key) this.key = Buffer.from(key);
    else if (process.env.AUTOAPPLY_VAULT_KEY) this.key = Buffer.from(process.env.AUTOAPPLY_VAULT_KEY, 'base64');
    else {
      if (process.platform !== 'win32') throw new Error('AUTOAPPLY_VAULT_KEY is required outside Windows');
      const file = path.join(directory, 'master.dpapi');
      if (!existsSync(file)) publishExclusive(file, protectWindows(randomBytes(32)));
      this.key = protectWindows(readFileSync(file), true);
    }
    if (this.key.length !== 32) throw new Error('Vault key must contain 32 bytes');
  }
  private file(tenant: string): string { return path.join(this.directory, createHash('sha256').update(tenant).digest('hex') + '.vault'); }
  private decrypt(context: string, encrypted: string): string {
    const data = JSON.parse(encrypted);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data.body, 'base64')), decipher.final()]).toString('utf8');
  }
  private encrypt(context: string, value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(value), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') });
  }
  sealEvidence(context: string, value: string): string { return this.encrypt(`evidence:${context}`, value); }
  openEvidence(context: string, encrypted: string): string { return this.decrypt(`evidence:${context}`, encrypted); }
  signEvidence(value: string): string { return createHmac('sha256', this.key).update('evidence-manifest-v1\0').update(value).digest('hex'); }
  verifyEvidence(value: string, signature: string): boolean { return /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(this.signEvidence(value), 'hex'), Buffer.from(signature, 'hex')); }
  get(tenant: string): VaultCredential | undefined {
    if (!existsSync(this.file(tenant))) {
      // Ticket GEN-100: Auto-provision credentials for ANY Workday (*.myworkdayjobs.com) or SmartRecruiters (*.smartrecruiters.com) tenant
      if (
        tenant.includes('myworkdayjobs.com') ||
        tenant.includes('smartrecruiters.com') ||
        tenant.startsWith('workday:') ||
        tenant.startsWith('smartrecruiters:')
      ) {
        const envCreds = resolveEnvPortalCredentials();
        if (envCreds) {
          const email = envCreds.email;
          const password = ensureWorkdayCompliantPassword(envCreds.password);
          const credential = { email, password };
          try { this.put(tenant, credential); } catch {}
          return credential;
        }
      }
      return;
    }
    const value = JSON.parse(this.decrypt(tenant, readFileSync(this.file(tenant), 'utf8')));
    if (typeof value.email !== 'string' || typeof value.password !== 'string') throw new Error('Invalid vault entry');
    if (value.recovery && (!Number.isFinite(Date.parse(value.recovery.requestedAt)) || !Number.isInteger(value.recovery.attempts) || !Number.isInteger(value.recovery.revision) || typeof value.recovery.confirmed !== 'boolean')) throw new Error('Invalid recovery state');
    return value;
  }
  private put(tenant: string, credential: VaultCredential, replace = false): boolean {
    const encrypted = this.encrypt(tenant, JSON.stringify(credential));
    if (!replace) return publishExclusive(this.file(tenant), encrypted);
    const temporary = this.file(tenant) + '.' + randomBytes(12).toString('hex') + '.tmp';
    writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.file(tenant));
    return true;
  }
  recovery(tenant: string): VaultCredential | undefined { return this.get(`recovery:${tenant}`); }
  requestRecovery(tenant: string, email: string, names: string[] = []): VaultCredential | undefined {
    const previous = this.recovery(tenant);
    if (previous && previous.email.toLowerCase() !== email.toLowerCase()) throw new Error('Recovery candidate mismatch');
    const recent = !!previous?.recovery && Date.now() - Date.parse(previous.recovery.requestedAt) < 60 * 60 * 1000;
    if (recent && previous!.recovery!.attempts >= 2) return;
    const revision = previous?.recovery && !previous.recovery.confirmed && recent ? previous.recovery.revision : (previous?.recovery?.revision || 0) + 1;
    const credential = this.ensure(`reset-secret:${tenant}:${revision}`, email, names).credential;
    const value = { ...credential, recovery: { requestedAt: new Date().toISOString(), attempts: recent ? previous!.recovery!.attempts + 1 : 1, revision, confirmed: false } };
    this.put(`recovery:${tenant}`, value, true);
    return value;
  }
  confirmRecovery(tenant: string): void {
    const value = this.recovery(tenant);
    if (!value?.recovery) throw new Error('No pending tenant recovery');
    this.put(tenant, { email: value.email, password: value.password }, true);
    value.recovery.confirmed = true;
    this.put(`recovery:${tenant}`, value, true);
  }
  ensure(tenant: string, email: string, candidateNames: string[] = []): { credential: { email: string; password: string }; created: boolean } {
    const existing = this.get(tenant);
    if (existing) { if (existing.email.toLowerCase() !== email.toLowerCase()) throw new Error('Vault candidate mismatch'); return { credential: existing, created: false }; }
    let password: string;
    const envCreds = resolveEnvPortalCredentials(email);
    if (envCreds?.password && (envCreds.email.toLowerCase() === email.toLowerCase() || !email)) {
      password = ensureWorkdayCompliantPassword(envCreds.password);
    } else {
      let counter = 0;
      const excluded = [...email.split('@')[0]!.split(/[._-]/).filter(part => part.length >= 3), ...candidateNames.flatMap(name => name.trim().split(/\s+/)).filter(Boolean)].map(part => part.toLowerCase());
      do {
        const seed = createHmac('sha256', this.key).update(JSON.stringify(['tenant-password-v2', tenant, email.toLowerCase(), counter++])).digest();
        password = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[seed[0]! % 26]! + 'abcdefghijklmnopqrstuvwxyz'[seed[1]! % 26]! + String(seed[2]! % 10) + '!@#$%'[seed[3]! % 5]! + seed.subarray(4, 13).toString('base64url');
      } while (/(.)\1/.test(password) || excluded.some(part => password.toLowerCase().includes(part)));
    }
    const credential = { email, password };
    if (this.put(tenant, credential)) return { credential, created: true };
    const winner = this.get(tenant)!;
    if (winner.email.toLowerCase() !== email.toLowerCase()) throw new Error('Vault candidate mismatch');
    return { credential: winner, created: false };
  }
}
