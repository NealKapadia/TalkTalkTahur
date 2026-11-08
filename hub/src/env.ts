/**
 * Loads the repo-root .env (gitignored) without overriding real environment
 * variables, and exposes typed settings. Secrets are never logged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadDotEnv(path = resolve(here, '../../.env')): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export const settings = {
  patient: env('BLINKTALK_PATIENT', 'neal'),
  spacetimeUri: env('SPACETIME_URI', 'ws://localhost:3000'),
  spacetimeDb: env('SPACETIME_DB', 'blinktalk'),
  nvidiaKey: env('NVIDIA_API_KEY'),
  nemotronModel: env('NEMOTRON_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
  visionModel: env('NEMOTRON_VISION_MODEL'),   // optional separate VL model for photos; defaults to NEMOTRON_MODEL
  nemotronBaseUrl: env('NEMOTRON_BASE_URL', 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
  nemotronThinking: env('NEMOTRON_THINKING', '0') === '1',
  nemotronTimeoutMs: Number(env('NEMOTRON_TIMEOUT', '90')) * 1000,
  geminiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL', 'gemini-flash-latest'),
  photonProjectId: env('PHOTON_PROJECT_ID'),
  photonApiKey: env('PHOTON_API_KEY'),
  photonBaseUrl: env('PHOTON_BASE_URL', 'https://api.photon.codes'),
};

export const redact = (s: string) => (s ? `${s.slice(0, 6)}…(${s.length} chars)` : '(not set)');
