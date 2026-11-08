import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Alert, Contact, Message } from '@bindings';
import { DEMO, useBlinkTalk, type Actions, type Link, type Snapshot } from './data';

const ESCALATE_SECONDS = 45;

// ------------------------------------------------------------------ helpers
const toDate = (t: { toDate(): Date }) => t.toDate();
const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function ago(d: Date, now: number) {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return clock(d);
}
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
function useLocal(key: string, init: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) ?? init; } catch { return init; } });
  return [v, (nv: string) => { setV(nv); try { localStorage.setItem(key, nv); } catch { /* private mode */ } }];
}

// ------------------------------------------------------------------ app
export default function App() {
  const { snap, link, actions, error } = useBlinkTalk();
  const now = useNow();
  const name = snap.patient?.display_name ?? 'Your person';
  const openSos = snap.alerts.filter(a => !a.acked_by && (a.kind === 'sos' || a.kind.startsWith('heart')));

  return (
    <div className="page">
      <Header snap={snap} link={link} name={name} />
      {link === 'offline' && !snap.patient && <Offline error={error} />}
      {openSos.map(a => <SosBand key={String(a.id)} alert={a} snap={snap} name={name} now={now} actions={actions} />)}
      <Voice snap={snap} name={name} now={now} />
      <main className="grid">
        <Conversation snap={snap} name={name} now={now} actions={actions} />
        <aside className="side">
          <OnScreen snap={snap} name={name} />
          <AgentTrace snap={snap} />
          <AlertLog snap={snap} now={now} />
          <CareCircle snap={snap} actions={actions} />
        </aside>
      </main>
      <footer className="foot">
        BlinkTalk runs on a SpacetimeDB backend, texts through Photon, and drafts replies with NVIDIA Nemotron.
        {link !== 'demo' && <button className="link-btn" onClick={() => confirm('Clear the conversation, alerts and agent log?') && actions.clearDemo()}>Reset demo data</button>}
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ header
function Header({ snap, link, name }: { snap: Snapshot; link: Link; name: string }) {
  const p = snap.patient;
  const status = !p ? 'Waiting for the speller' :
    p.status === 'sos' ? `${name} is asking for help` :
    p.status === 'composing' ? `${name} is spelling` :
    p.status === 'speaking' ? `${name} just spoke` :
    p.status === 'paused' ? `${name} switched BlinkTalk off to rest` : `${name} is idle`;
  const linkText = { connecting: 'Connecting', live: 'Live', offline: 'Reconnecting', demo: 'Demo' }[link];
  return (
    <header className="head">
      <div className="brand">
        <BlinkMark />
        <span>BlinkTalk Care</span>
      </div>
      <div className={`state state-${p?.status ?? 'none'}`}>{status}</div>
      <Heart snap={snap} />
      <div className={`link link-${link}`} title={link === 'live' ? 'Subscribed to SpacetimeDB' : undefined}>
        <span className="dot" aria-hidden />{linkText}
      </div>
    </header>
  );
}

function BlinkMark() {
  return (
    <svg className="mark" viewBox="0 0 32 20" aria-hidden>
      <path d="M2 10 C 9 1, 23 1, 30 10 C 23 19, 9 19, 2 10 Z" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle className="pupil" cx="16" cy="10" r="4.2" fill="currentColor" />
    </svg>
  );
}

function Heart({ snap }: { snap: Snapshot }) {
  const pts = snap.heart.slice(-60).map(h => h.bpm);
  const bpm = snap.patient?.heart_bpm || 0;
  const high = bpm > 120 || (bpm > 0 && bpm < 45);
  const path = useMemo(() => {
    if (pts.length < 2) return '';
    const lo = Math.min(...pts, 55), hi = Math.max(...pts, 100);
    return pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * 120},${28 - ((v - lo) / (hi - lo || 1)) * 24}`).join(' ');
  }, [pts.join(',')]);
  return (
    <div className={`heart ${high ? 'heart-high' : ''}`} aria-label={`Heart rate ${bpm || 'unknown'}`}>
      <svg viewBox="0 0 120 30" className="spark" aria-hidden><path d={path} /></svg>
      <span className="bpm">{bpm || '--'}</span><span className="unit">bpm</span>
    </div>
  );
}

function Offline({ error }: { error?: string }) {
  return (
    <section className="offline">
      <h2>Can't reach the BlinkTalk server</h2>
      <p>Start SpacetimeDB with <code>spacetime start</code> and publish the module with <code>spacetime publish --module-path spacetime blinktalk</code>. This page reconnects by itself.</p>
      <p>No backend handy? Open <a href="?demo">the demo</a>.</p>
      {error && <p className="muted small">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ SOS
function SosBand({ alert, snap, name, now, actions }: { alert: Alert; snap: Snapshot; name: string; now: number; actions: Actions }) {
  const [me, setMe] = useLocal('blinktalk.me', '');
  const started = toDate(alert.created_at).getTime();
  const elapsed = (now - started) / 1000;
  const nextIn = Math.max(0, ESCALATE_SECONDS * alert.level - elapsed);
  const ladder = snap.contacts.filter(c => c.tier > 0).sort((a, b) => a.tier - b.tier);
  const title = alert.kind === 'sos' ? `${name} is asking for help` : alert.kind === 'heart_high' ? `${name}'s heart rate is high` : `${name}'s heart rate is low`;
  const frac = alert.level >= 3 ? 1 : Math.min(1, Math.max(0, 1 - nextIn / ESCALATE_SECONDS));
  return (
    <section className="sos" role="alert">
      <div className="sos-main">
        <h2>{title}</h2>
        <p>{alert.detail}. Started {ago(new Date(started), now)}{snap.patient?.heart_bpm ? `, heart rate ${snap.patient.heart_bpm} bpm` : ''}.</p>
        <ol className="ladder" aria-label="Who is being notified">
          {ladder.length === 0 && <li className="muted">No caregivers yet. Add one in the care circle so alerts reach a phone.</li>}
          {ladder.map(c => (
            <li key={String(c.id)} className={c.tier <= alert.level ? 'reached' : ''}>
              {c.name}<span className="tier">{c.tier <= alert.level ? 'texted' : `tier ${c.tier}`}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="sos-act">
        <svg viewBox="0 0 44 44" className="ring" aria-hidden>
          <circle cx="22" cy="22" r="19" className="ring-bg" />
          <circle cx="22" cy="22" r="19" className="ring-fg" style={{ strokeDashoffset: 119.4 * (1 - frac) }} />
        </svg>
        <p className="next">{alert.level >= 3 ? 'Everyone has been texted' : `Next caregiver in ${Math.ceil(nextIn)}s`}</p>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); actions.ackAlert(alert.id, me || 'Caregiver'); }}>
          <label className="sr" htmlFor="me">Your name</label>
          <input id="me" placeholder="Your name" value={me} onChange={e => setMe(e.target.value)} />
          <button className="btn-sos" type="submit">I'm on it</button>
        </form>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the voice (hero)
const GLYPH: Record<string, string> = { left: '←', right: '→', select: '●', toggle: '⏻', sos: '!' };
function Voice({ snap, name, now }: { snap: Snapshot; name: string; now: number }) {
  const p = snap.patient;
  const draft = p?.draft ?? '';
  const eyes = snap.eyes.slice(-28);
  const lastEye = eyes.at(-1);
  const idle = !lastEye || now - toDate(lastEye.at).getTime() > 20000;
  return (
    <section className="voice" aria-live="polite">
      {draft ? (
        <p className="draft">{draft}<span className="caret" aria-hidden /></p>
      ) : (
        <p className="draft quiet">
          {p?.last_spoken ? <>“{p.last_spoken}”</> : `When ${name} spells with their eyes, the words appear here as they're chosen.`}
        </p>
      )}
      <div className="trail" aria-label="Recent eye movements">
        {eyes.map((e, i) => (
          <span key={String(e.id)} className={`g g-${e.command}`} style={{ opacity: 0.25 + (0.75 * (i + 1)) / eyes.length }}>
            {GLYPH[e.command] ?? '·'}
          </span>
        ))}
        <span className="trail-label">{idle ? (lastEye ? `eyes last moved ${ago(toDate(lastEye.at), now)}` : 'no eye movements yet') : 'eye movements, newest on the right'}</span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ conversation
function Conversation({ snap, name, now, actions }: { snap: Snapshot; name: string; now: number; actions: Actions }) {
  const contacts = new Map(snap.contacts.map(c => [c.id, c]));
  const msgs = snap.messages.slice(-40);
  return (
    <section className="panel convo">
      <h3>Conversation</h3>
      <ol className="thread">
        {msgs.length === 0 && <li className="muted empty">Texts to and from {name} show up here, along with what they say aloud.</li>}
        {msgs.map(m => <Bubble key={String(m.id)} m={m} who={contacts.get(m.contact_id)} name={name} now={now} />)}
      </ol>
      <SimulateText snap={snap} name={name} actions={actions} />
    </section>
  );
}

function Bubble({ m, who, name, now }: { m: Message; who?: Contact; name: string; now: number }) {
  const when = ago(toDate(m.created_at), now);
  if (m.channel === 'speech') {
    return <li className="said"><span className="said-q">{name} said aloud</span> “{m.body}” <time>{when}</time></li>;
  }
  const out = m.direction === 'out';
  return (
    <li className={`msg ${out ? 'out' : 'in'}`}>
      <div className="meta">{out ? `${name} to ${who?.name ?? 'contact'}` : who?.name ?? 'Unknown'} <time>{when}</time>{out && m.status !== 'sent' && <span className={`st st-${m.status}`}>{m.status}</span>}</div>
      <p>{m.body}</p>
    </li>
  );
}

function SimulateText({ snap, name, actions }: { snap: Snapshot; name: string; actions: Actions }) {
  const [from, setFrom] = useState('');
  const [body, setBody] = useState('');
  const options = snap.contacts;
  const send = (e: FormEvent) => {
    e.preventDefault();
    const c = options.find(o => o.address === from);
    const addr = c?.address ?? from.replace(/[\s()-]/g, '');
    if (!addr || !body.trim()) return;
    actions.simulateText(addr, c?.name ?? '', body.trim());
    setBody('');
  };
  return (
    <form className="simulate" onSubmit={send}>
      <label htmlFor="sim-body">Send {name} a test text</label>
      <div className="row">
        <input list="sim-from" aria-label="From (contact or number)" placeholder="From: +1 469 555 0101" value={from} onChange={e => setFrom(e.target.value)} />
        <datalist id="sim-from">{options.map(o => <option key={String(o.id)} value={o.address}>{o.name}</option>)}</datalist>
        <input id="sim-body" placeholder="Want me to bring dinner?" value={body} onChange={e => setBody(e.target.value)} />
        <button type="submit">Send test text</button>
      </div>
      <p className="hint">With Photon connected, real iMessages to {name}'s line arrive here on their own.</p>
    </form>
  );
}

// ------------------------------------------------------------------ side panels
function OnScreen({ snap, name }: { snap: Snapshot; name: string }) {
  if (!snap.suggestions.length) return null;
  return (
    <section className="panel onscreen">
      <h3>Replies on {name}'s screen</h3>
      <ul>{snap.suggestions.map(s => <li key={String(s.id)}>{s.text}</li>)}</ul>
      <p className="hint">{snap.suggestions[0].source === 'nemotron' ? 'Drafted by Nemotron.' : 'Built-in replies (Nemotron unreachable).'} {name} sends one with a double blink.</p>
    </section>
  );
}

const STEP_LABEL: Record<string, string> = { plan: 'Plan', tool: 'Tool', reply: 'Replies', fallback: 'Fallback', retry: 'Retry' };
function AgentTrace({ snap }: { snap: Snapshot }) {
  const runs = useMemo(() => {
    const groups = new Map<string, typeof snap.agent>();
    for (const s of snap.agent) {
      const g = groups.get(s.run_id) ?? [];
      g.push(s);
      groups.set(s.run_id, g);
    }
    return [...groups.values()].slice(-3).reverse();
  }, [snap.agent]);
  return (
    <section className="panel agent">
      <h3>What the agent did</h3>
      {runs.length === 0 && <p className="muted">Each incoming text starts a Nemotron run: it reads the conversation and how Neal is doing, decides whether caregivers need to know, then drafts replies. The steps appear here.</p>}
      {runs.map((steps, i) => (
        <ol key={steps[0].run_id} className={`run ${i ? 'old' : ''}`}>
          {steps.map(s => (
            <li key={String(s.id)} className={`step step-${s.step}`}>
              <span className="k">{STEP_LABEL[s.step] ?? s.step}</span>
              <span className="v">{s.detail.replace(/^\[[^\]]+\]\s*/, '')}</span>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}

const ALERT_NAME: Record<string, string> = { sos: 'SOS', heart_high: 'High heart rate', heart_low: 'Low heart rate' };
function AlertLog({ snap, now }: { snap: Snapshot; now: number }) {
  const list = snap.alerts.slice(-6).reverse();
  if (!list.length) return null;
  return (
    <section className="panel alerts">
      <h3>Alerts</h3>
      <ul>
        {list.map(a => (
          <li key={String(a.id)} className={a.acked_by ? 'done' : 'open'}>
            <span className="an">{ALERT_NAME[a.kind] ?? a.kind}</span>
            <span className="ad">{a.acked_by ? `handled by ${a.acked_by}` : 'open'}, {ago(toDate(a.created_at), now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CareCircle({ snap, actions }: { snap: Snapshot; actions: Actions }) {
  const [form, setForm] = useState({ name: '', address: '', relation: '', tier: '1' });
  const care = snap.contacts.filter(c => c.tier > 0).sort((a, b) => a.tier - b.tier);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) return;
    actions.addContact(form.name.trim(), form.address.trim(), form.relation.trim(), Number(form.tier));
    setForm({ name: '', address: '', relation: '', tier: form.tier });
  };
  return (
    <section className="panel care">
      <h3>Care circle</h3>
      <p className="hint">An SOS texts tier 1 first. If nobody replies "OK" within {ESCALATE_SECONDS} seconds, it moves to the next tier. Each caregiver texts the BlinkTalk line once so it can reach them.</p>
      <ul>
        {care.map(c => (
          <li key={String(c.id)}>
            <span className="tierchip">{c.tier}</span>
            <span className="cn">{c.name}<small>{c.relation ? `${c.relation}, ` : ''}{c.address}</small></span>
            <button className="link-btn" aria-label={`Remove ${c.name}`} onClick={() => actions.removeContact(c.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="addc" onSubmit={add}>
        <input aria-label="Name" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input aria-label="Phone or email" placeholder="+1 469 555 0101" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        <input aria-label="Relation" placeholder="Relation" value={form.relation} onChange={e => setForm({ ...form, relation: e.target.value })} />
        <select aria-label="Tier" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
          <option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option>
        </select>
        <button type="submit">Add caregiver</button>
      </form>
      {DEMO && <p className="hint">Demo mode: changes stay in this browser tab.</p>}
    </section>
  );
}
