/**
 * Photon 2.0 bridge: puts the patient on iMessage through a Photon line.
 *
 * Uses the Photon HTTP API (https://api.photon.codes, project API key):
 *   GET  /v1/projects/{id}/messages?direction=received...   poll inbound texts
 *   POST /v1/projects/{id}/messages                         reply in a chat
 *
 * A shared iMessage line can only reply in a direct chat to someone who is
 * assigned to the line (dashboard: iMessage -> Add someone to the line) and has
 * texted it since. So every caregiver texts the BlinkTalk number once ("hi");
 * the bridge remembers that chat (space + line) per person in
 * hub/.photon-routes.json and uses it for replies and SOS alerts.
 *
 * With no PHOTON_API_KEY the bridge runs simulated: outbound texts are printed,
 * inbound texts come from the dashboard's "Send a test text" box.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settings } from './env.ts';

export interface InboundText {
  address: string;   // E.164 or email handle of whoever wrote
  body: string;
  channel: string;
}

export interface Messenger {
  live: boolean;
  send(address: string, body: string): Promise<void>;
  canReach(address: string): boolean;
  stop(): void;
}

interface Route { spaceId: string; senderId: string; platform: string; lastAt: string }

const ROUTES_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../.photon-routes.json');

export class PhotonError extends Error {}

/** Normalise "+1 (469) 555-0101" and "+14695550101" to one key. */
export const handleKey = (h: string) => (h.includes('@') ? h.trim().toLowerCase() : h.replace(/[^\d+]/g, ''));

export function createPhoton(opts: {
  apiKey: string;
  projectId: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  routesFile?: string | null;
  pollMs?: number;
  onText: (t: InboundText) => Promise<void>;
  log?: (msg: string) => void;
}): Messenger & { pollOnce(): Promise<number> } {
  const base = (opts.baseUrl ?? 'https://api.photon.codes').replace(/\/$/, '');
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? (m => console.log(`[photon] ${m}`));
  const routesFile = opts.routesFile === undefined ? ROUTES_FILE : opts.routesFile;
  const routes = new Map<string, Route>();
  if (routesFile && existsSync(routesFile)) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(routesFile, 'utf8')))) routes.set(k, v as Route);
    } catch { /* start fresh */ }
  }
  const saveRoutes = () => {
    if (routesFile) writeFileSync(routesFile, JSON.stringify(Object.fromEntries(routes), null, 1));
  };

  const headers = { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' };
  let since = new Date(Date.now() - 10_000).toISOString();
  const seen = new Set<string>();
  let stopped = false;
  let backoffUntil = 0;

  async function pollOnce(): Promise<number> {
    let handled = 0;
    let pageToken: string | undefined;
    let newest = since;
    do {
      const q = new URLSearchParams({ direction: 'received', order: 'asc', orderBy: 'createdAt', createdSince: since, pageSize: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await f(`${base}/v1/projects/${opts.projectId}/messages?${q}`, { headers });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') ?? '10');
        backoffUntil = Date.now() + wait * 1000;
        log(`rate limited; pausing ${wait}s`);
        return handled;
      }
      if (!res.ok) throw new PhotonError(`list messages HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const page = (await res.json()) as { items?: any[]; nextPageToken?: string };
      for (const m of page.items ?? []) {
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.createdAt && m.createdAt > newest) newest = m.createdAt;
        if (m.status !== 'received' || m.content?.type !== 'text') continue;
        const from = m.sentBy?.handle as string | undefined;
        const line = (m.receivedBy ?? m.addressedTo) as { id?: string } | undefined;
        if (!from || !line?.id || !m.space?.id || m.sentBy?.id === line.id) continue;
        routes.set(handleKey(from), { spaceId: m.space.id, senderId: line.id, platform: m.platform, lastAt: m.createdAt });
        saveRoutes();
        handled++;
        await opts.onText({ address: handleKey(from), body: String(m.content.text ?? ''), channel: m.platform ?? 'imessage' });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    // Overlap 5 s so late-indexed messages are not missed; `seen` removes repeats.
    since = new Date(Math.max(new Date(newest).getTime() - 5000, new Date(since).getTime())).toISOString();
    if (seen.size > 5000) seen.clear();
    return handled;
  }

  const loop = async () => {
    while (!stopped) {
      if (Date.now() >= backoffUntil) {
        try { await pollOnce(); } catch (err) { log(String((err as Error).message ?? err)); }
      }
      await new Promise(r => setTimeout(r, opts.pollMs ?? 2000));
    }
  };

  const messenger = {
    live: true,
    pollOnce,
    canReach: (address: string) => routes.has(handleKey(address)),
    async send(address: string, body: string) {
      const route = routes.get(handleKey(address));
      if (!route) {
        throw new PhotonError(`${address} has not texted the BlinkTalk line yet. Add them to the line in Photon and have them text it once.`);
      }
      const res = await f(`${base}/v1/projects/${opts.projectId}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ spaceId: route.spaceId, senderId: route.senderId, content: { type: 'text', format: 'plain', text: body } }),
      });
      if (!res.ok) {
        const txt = (await res.text()).slice(0, 300);
        throw new PhotonError(`send HTTP ${res.status}: ${txt}`);
      }
    },
    stop() { stopped = true; },
  };
  if (opts.pollMs !== 0) void loop();   // pollMs 0 = manual polling (tests)
  return messenger;
}

export async function startPhoton(onText: (t: InboundText) => Promise<void>): Promise<Messenger> {
  if (!settings.photonApiKey || !settings.photonProjectId) {
    console.log('[photon] PHOTON_API_KEY / PHOTON_PROJECT_ID not set: simulated texting (outbound texts print here).');
    return {
      live: false,
      canReach: () => true,
      async send(address, body) { console.log(`[photon:sim] -> ${address}: ${body}`); },
      stop() {},
    };
  }
  const m = createPhoton({ apiKey: settings.photonApiKey, projectId: settings.photonProjectId, baseUrl: settings.photonBaseUrl, onText });
  console.log(`[photon] live: polling project ${settings.photonProjectId}`);
  return m;
}
