/**
 * FastApply Stealth & Copilot Multi-Mode Runner Engine.
 * Reverse-engineered from FastApply's stealth human emulation and copilot review loop.
 */

import type { RunnerMode } from './types.js';

export interface StealthTypingOptions {
  minKeyDelayMs?: number;
  maxKeyDelayMs?: number;
  wordPauseProbability?: number;
  wordPauseMinMs?: number;
  wordPauseMaxMs?: number;
}

export interface MousePoint {
  x: number;
  y: number;
}

/**
 * Calculates Gaussian randomized delay to simulate human typing cadence.
 */
export function getHumanKeyDelay(minMs = 35, maxMs = 95): number {
  // Box-Muller transform for normal distribution
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random() || 0.0001;
  const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 4;
  const delay = Math.round(mean + randStdNormal * stdDev);

  return Math.max(minMs, Math.min(maxMs, delay));
}

/**
 * Computes cubic bezier curve coordinates for human-like mouse movement.
 */
export function generateBezierCurve(
  start: MousePoint,
  end: MousePoint,
  steps = 25
): MousePoint[] {
  const points: MousePoint[] = [];

  // Generate control points with random deviations
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const cp1: MousePoint = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * 40,
    y: start.y + dy * 0.25 + (Math.random() - 0.5) * 40,
  };

  const cp2: MousePoint = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * 30,
    y: start.y + dy * 0.75 + (Math.random() - 0.5) * 30,
  };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;

    // Cubic Bezier formula: B(t) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
    const x =
      invT * invT * invT * start.x +
      3 * invT * invT * t * cp1.x +
      3 * invT * t * t * cp2.x +
      t * t * t * end.x;

    const y =
      invT * invT * invT * start.y +
      3 * invT * invT * t * cp1.y +
      3 * invT * t * t * cp2.y +
      t * t * t * end.y;

    // Add micro-tremor jitter (skip for exact start and endpoints)
    const isEndpoint = i === 0 || i === steps;
    const jitterX = isEndpoint ? 0 : (Math.random() - 0.5) * 1.5;
    const jitterY = isEndpoint ? 0 : (Math.random() - 0.5) * 1.5;

    points.push({
      x: Math.round(x + jitterX),
      y: Math.round(y + jitterY),
    });
  }

  return points;
}

/**
 * Anti-Bot Browser Stealth Injections.
 * Evaluated before page load in Playwright or injected into DOM context.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  // 1. Mask navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // 2. Mock chrome runtime properties
  window.chrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
    },
  };

  // 3. Mock plugins & mimeTypes
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ],
  });

  // 4. Mock notification permissions query
  if (navigator.permissions && navigator.permissions.query) {
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );
  }
})();
`;

/**
 * Event sequencing simulator for content scripts.
 */
export function getSyntheticEventSequence(value: string | boolean): string[] {
  if (typeof value === 'boolean') {
    return ['pointerenter', 'pointerdown', 'focus', 'click', 'change', 'blur', 'pointerup'];
  }
  return [
    'pointerenter',
    'pointerdown',
    'focus',
    'keydown',
    'keypress',
    'input',
    'keyup',
    'change',
    'blur',
    'pointerup',
  ];
}
