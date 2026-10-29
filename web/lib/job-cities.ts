import type { Job } from './types';

export const JOB_CITIES = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, pattern: /\b(bengaluru|bangalore)\b/i },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867, pattern: /\b(hyderabad|secunderabad)\b/i },
  { name: 'Pune', lat: 18.5204, lng: 73.8567, pattern: /\bpune\b/i },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777, pattern: /\b(mumbai|bombay|navi mumbai|thane)\b/i },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707, pattern: /\b(chennai|madras)\b/i },
] as const;

export function jobsByCity(jobs: readonly Job[]) {
  return JOB_CITIES.map(city => ({ ...city, jobs: jobs.filter(job => city.pattern.test(job.location)) }));
}
