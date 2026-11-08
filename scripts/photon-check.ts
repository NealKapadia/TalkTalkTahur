/**
 * Photon check: confirms PHOTON_API_KEY / PHOTON_PROJECT_ID work and lists the
 * latest texts to the BlinkTalk line (and which people the hub can reply to).
 *   npm run photon-check
 */
import { existsSync, readFileSync } from 'node:fs';
import { settings, redact } from '../hub/src/env.ts';

const routesFile = new URL('../hub/.photon-routes.json', import.meta.url);

async function main() {
  console.log(`project ${settings.photonProjectId || '(PHOTON_PROJECT_ID not set)'}  key ${redact(settings.photonApiKey)}`);
  if (!settings.photonApiKey || !settings.photonProjectId) { process.exitCode = 1; return; }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const q = new URLSearchParams({ direction: 'received', order: 'desc', orderBy: 'created_at', createdSince: since, pageSize: '10' });
  const res = await fetch(`${settings.photonBaseUrl}/v1/projects/${settings.photonProjectId}/messages?${q}`, {
    headers: { Authorization: `Bearer ${settings.photonApiKey}`, Accept: 'application/json' },
  });
  if (res.status === 401) { console.log('FAIL 401: the key is wrong or expired. Use the secret shown once when you created it (not the key id).'); process.exitCode = 1; return; }
  if (res.status === 403) { console.log('FAIL 403: the key needs project:read and project:write, or the project id is wrong.'); process.exitCode = 1; return; }
  if (!res.ok) { console.log(`FAIL HTTP ${res.status}: ${(await res.text()).slice(0, 900)}`); process.exitCode = 1; return; }
  const page = (await res.json()) as { items?: any[] };
  const items = page.items ?? [];
  console.log(`OK: key works. ${items.length} text(s) to the line in the last 24 h:`);
  for (const m of items) {
    const text = m.content?.type === 'text' ? m.content.text : `[${m.content?.type}]`;
    console.log(`  ${m.createdAt}  ${m.sentBy?.handle} -> ${m.receivedBy?.handle ?? m.addressedTo?.handle ?? 'line'}: ${String(text).slice(0, 80)}`);
  }
  if (!items.length) console.log('  (none yet: text the shared line from your iPhone, e.g. "hi", then run this again)');
  const routes = existsSync(routesFile) ? Object.keys(JSON.parse(readFileSync(routesFile, 'utf8'))) : [];
  console.log(`hub can reply to: ${routes.length ? routes.join(', ') : '(nobody yet: start the hub, then text the line)'}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; return; });
