import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FormFieldDescriptor {
  id?: string;
  name?: string;
  type: string;
  label: string;
}

export interface CachedSchemaResolution {
  factKey: string;
  resolvedValue: string;
  cachedAt: string;
}

export interface SchemaCacheEntry {
  schemaHash: string;
  provider: string;
  lastUsedAt: string;
  fields: Record<string, CachedSchemaResolution>;
}

export const DEFAULT_SCHEMA_CACHE_PATH = path.resolve('state/autoapply/schema-cache.json');
export const MAX_SCHEMA_CACHE_ENTRIES = 500;
export const SCHEMA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * SHA-256 of normalized provider|type|name|label tuples.
 */
export function computeFormSchemaHash(provider: string, fields: FormFieldDescriptor[]): string {
  const normalizedProvider = (provider || '').trim().toLowerCase();
  const sortedTuples = fields
    .map((f) => {
      const t = (f.type || 'text').trim().toLowerCase();
      const n = (f.name || f.id || '').trim().toLowerCase();
      const l = (f.label || '').trim().toLowerCase().replace(/\s+/g, ' ');
      return `${t}|${n}|${l}`;
    })
    .sort()
    .join('::');

  return crypto
    .createHash('sha256')
    .update(`${normalizedProvider}:::${sortedTuples}`)
    .digest('hex');
}

/**
 * Load schema cache from disk with fallback to empty object.
 */
export function loadSchemaCache(cachePath = DEFAULT_SCHEMA_CACHE_PATH): Record<string, SchemaCacheEntry> {
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // Malformed JSON fallback
  }
  return {};
}

/**
 * Save schema cache to disk with LRU eviction at MAX_SCHEMA_CACHE_ENTRIES.
 */
export function saveSchemaCache(
  cache: Record<string, SchemaCacheEntry>,
  cachePath = DEFAULT_SCHEMA_CACHE_PATH
): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > MAX_SCHEMA_CACHE_ENTRIES) {
      // Sort ascending by lastUsedAt (oldest first)
      const sortedKeys = keys.sort((a, b) => {
        const tA = new Date(cache[a]?.lastUsedAt || 0).getTime();
        const tB = new Date(cache[b]?.lastUsedAt || 0).getTime();
        return tA - tB;
      });
      const toRemove = sortedKeys.slice(0, keys.length - MAX_SCHEMA_CACHE_ENTRIES);
      for (const k of toRemove) {
        delete cache[k];
      }
    }

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch {}
}

/**
 * Record verified field resolutions for a successful submission into schema cache.
 */
export function recordSchemaSubmissionSuccess(
  provider: string,
  fields: FormFieldDescriptor[],
  resolutions: Record<string, { factKey: string; resolvedValue: string }>,
  cachePath = DEFAULT_SCHEMA_CACHE_PATH
): string {
  const schemaHash = computeFormSchemaHash(provider, fields);
  const cache = loadSchemaCache(cachePath);
  const now = new Date().toISOString();

  const fieldEntries: Record<string, CachedSchemaResolution> = {};
  for (const [key, res] of Object.entries(resolutions)) {
    if (res && res.factKey && res.resolvedValue !== undefined) {
      fieldEntries[key] = {
        factKey: res.factKey,
        resolvedValue: String(res.resolvedValue),
        cachedAt: now,
      };
    }
  }

  cache[schemaHash] = {
    schemaHash,
    provider: provider.toLowerCase(),
    lastUsedAt: now,
    fields: fieldEntries,
  };

  saveSchemaCache(cache, cachePath);
  return schemaHash;
}

/**
 * Lookup cached field resolution in 0ms.
 */
export function lookupCachedFieldResolution(
  schemaHash: string,
  fieldKey: string,
  cachePath = DEFAULT_SCHEMA_CACHE_PATH
): CachedSchemaResolution | null {
  if (!schemaHash || !fieldKey) return null;
  const cache = loadSchemaCache(cachePath);
  const entry = cache[schemaHash];
  if (!entry) return null;

  // TTL check
  const lastUsed = new Date(entry.lastUsedAt || 0).getTime();
  if (Date.now() - lastUsed > SCHEMA_CACHE_TTL_MS) {
    return null;
  }

  const fieldRes = entry.fields?.[fieldKey];
  if (fieldRes && fieldRes.factKey && fieldRes.resolvedValue) {
    entry.lastUsedAt = new Date().toISOString();
    return fieldRes;
  }
  return null;
}
