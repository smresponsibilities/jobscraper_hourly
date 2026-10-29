import type { Job } from './types';
import { JOB_CITIES } from './job-cities';

export type OfficeCity = typeof JOB_CITIES[number]['name'];
export interface Office {
  id: string;
  company: string;
  city: OfficeCity;
  latitude: number;
  longitude: number;
  officeName: string;
  locality: string;
  address: string;
  approximate: boolean;
  source: string;
  logoUrl?: string;
}
export interface OfficeDirectory { version: 1; generatedAt: string; offices: Office[] }
export interface OfficeGroup { office: Office; company: string; jobs: Job[] }

export function employerKey(name: string): string {
  const key = name.normalize('NFKC').toLowerCase().replace(/(?:[\s,().]+(?:private|pvt|limited|ltd|incorporated|inc|llc|corporation|corp)\.?)+\s*$/, '').replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  return key;
}

export function parseOfficeDirectory(value: unknown): OfficeDirectory {
  const data = value as Partial<OfficeDirectory> | null;
  if (!data || data.version !== 1 || !Array.isArray(data.offices) || typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt))) {
    throw new Error('Invalid office directory');
  }
  const ids = new Set<string>();
  for (const o of data.offices) {
    const city = JOB_CITIES.find(c => c.name === o?.city);
    if (!o || !city || typeof o.id !== 'string' || !o.id || ids.has(o.id) ||
      typeof o.company !== 'string' || !employerKey(o.company) ||
      !Number.isFinite(o.latitude) || !Number.isFinite(o.longitude) ||
      Math.abs(o.latitude - city.lat) > .65 || Math.abs(o.longitude - city.lng) > .65 ||
      typeof o.officeName !== 'string' || typeof o.locality !== 'string' || typeof o.address !== 'string' ||
      typeof o.approximate !== 'boolean' || typeof o.source !== 'string' || !/^https:\/\//.test(o.source) ||
      (o.logoUrl !== undefined && (typeof o.logoUrl !== 'string' || !/^https:\/\//.test(o.logoUrl)))) {
      throw new Error('Invalid office record');
    }
    ids.add(o.id);
  }
  return data as OfficeDirectory;
}

export function officeGroups(jobs: readonly Job[], offices: readonly Office[], city: OfficeCity) {
  const definition = JOB_CITIES.find(c => c.name === city)!;
  const byEmployer = new Map<string, Office>();
  // One sourced office per employer/city, not an assertion of every role's worksite.
  for (const office of offices) if (office.city === city && !byEmployer.has(employerKey(office.company))) byEmployer.set(employerKey(office.company), office);
  const groups = new Map<string, OfficeGroup>();
  const unmapped: Job[] = [];
  for (const job of jobs) {
    if (!definition.pattern.test(job.location)) continue;
    const office = byEmployer.get(employerKey(job.company));
    if (!office) { unmapped.push(job); continue; }
    const existing = groups.get(office.id);
    if (existing) existing.jobs.push(job);
    else groups.set(office.id, { office, company: job.company, jobs: [job] });
  }
  return { groups: [...groups.values()].sort((a, b) => a.company.localeCompare(b.company)), unmapped };
}
