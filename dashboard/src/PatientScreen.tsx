/**
 * The patient's screen. Built for someone who moves one step at a time with
 * their eyes and may look at it for hours: a warm, blue-free palette, one lit
 * choice at the centre of an endless ribbon, the message they're answering on
 * top, and their own words in large reading type.
 *
 * Input: eye movements arrive as eye_event rows (board -> bridge -> SpacetimeDB)
 * and are applied in order; the keyboard (arrows, Space, P, S) takes the same path.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEMO, useBlinkTalk } from './data';
import { Speller, type Item } from './speller';
import { Icon, type IconName } from './icons';
import { splitPhotos } from './photo';
import './patient.css';

type Cmd = 'left' | 'right' | 'select' | 'toggle' | 'sos';

function tts(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no speech engine */ }
}

function beep(times = 3) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 1100; g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 0.22);
    }
  } catch { /* audio blocked until first interaction */ }
}

const ICON_FOR: Partial<Record<Item['kind'], IconName>> = {
  space: 'space', delete: 'delete', speak: 'speak', text: 'send', expand: 'sparkle', quick: 'star', back: 'back', contact: 'person',
};

const COPIES = 3;                 // the ribbon is drawn three times so it can scroll forever

export default function PatientScreen() {
  const { snap, link, actions } = useBlinkTalk();
  const [, force] = useState(0);
  const rerender = () => force(x => x + 1);
  const [pulse, setPulse] = useState<{ side: Cmd; n: number } | null>(null);
  const [localSos, setLocalSos] = useState(false);
  const [localPause, setLocalPause] = useState(false);
  const [ackNote, setAckNote] = useState<string | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const sp = useRef<Speller | null>(null);
  if (!sp.current) {
    sp.current = new Speller({
      speak: text => { tts(text); actionsRef.current.speak(text); },
      send: (text, contactId) => (contactId ? actionsRef.current.sendAsPatient(BigInt(contactId), text) : actionsRef.current.replyLatest(text)),
      expand: keywords => actionsRef.current.requestIntent(keywords),
    });
  }
  const s = sp.current;
  const lastDraft = useRef('');

  const name = snap.patient?.display_name ?? '';
  const inbox = useMemo(() => [...snap.messages].reverse().find(m => m.direction === 'in'), [snap.messages]);
  const from = inbox ? snap.contacts.find(c => c.id === inbox.contact_id)?.name ?? 'Someone' : '';
  const sosOn = snap.patient?.status === 'sos' || localSos;
  const sosRef = useRef(sosOn);
  sosRef.current = sosOn;
  const paused = !sosOn && (snap.patient?.status === 'paused' || localPause);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Who "Text it" can reach: whoever wrote last first, then the care circle by tier, then everyone else.
  const people = useMemo(() => {
    const byId = new Map(snap.contacts.map(c => [c.id, c]));
    const order: bigint[] = [];
    for (const m of [...snap.messages].reverse()) if (m.direction === 'in' && byId.has(m.contact_id) && !order.includes(m.contact_id)) order.push(m.contact_id);
    for (const c of [...snap.contacts].sort((a, b) => (a.tier || 9) - (b.tier || 9))) if (!order.includes(c.id)) order.push(c.id);
    return order.map(id => ({ id: String(id), name: byId.get(id)!.name }));
  }, [snap.contacts, snap.messages]);

  // Backend context -> speller.
  useEffect(() => {
    const nameOf = (id: bigint) => snap.contacts.find(c => c.id === id)?.name;
    s.setContext({
      replies: snap.suggestions.map(x => ({ text: x.text, contactId: x.contact_id ? String(x.contact_id) : undefined, to: x.contact_id ? nameOf(x.contact_id) : undefined })),
      contacts: people,
      canText: !!inbox || people.length > 0,
      usage: new Map(snap.phrases.map(p => [p.text, p.uses])),
    });
    rerender();
  }, [snap.suggestions, snap.phrases, people, inbox?.id]);

  // Ribbon position: an unbounded index into the tripled list, so moving past the end keeps going.
  const v = useRef(s.idx + s.items.length);
  const animate = useRef(true);

  const apply = (cmd: Cmd) => {
    setPulse(p => ({ side: cmd, n: (p?.n ?? 0) + 1 }));
    if (cmd === 'sos') {
      beep(); tts('Help, please. I need assistance.');
      if (link !== 'live' && !DEMO) setLocalSos(true);
      return;
    }
    if (sosRef.current) {
      if (cmd === 'select') { actionsRef.current.cancelSos(); setLocalSos(false); }
      return;
    }
    if (cmd === 'toggle') {
      tts(pausedRef.current ? 'BlinkTalk is on.' : 'BlinkTalk paused.');
      if (link !== 'live' && !DEMO) setLocalPause(p => !p);
      return;
    }
    if (pausedRef.current) return;   // resting: only toggle and SOS act
    if (cmd === 'left') { s.move(-1); v.current -= 1; }
    else if (cmd === 'right') { s.move(1); v.current += 1; }
    else s.select();
    if (s.text !== lastDraft.current) {
      lastDraft.current = s.text;
      actionsRef.current.setDraft(s.text);
    }
    rerender();
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Eye events from the backend, in order, new ones only.
  const seen = useRef<bigint | null>(null);
  useEffect(() => {
    if (!snap.patient) return;
    const ids = snap.eyes.map(e => e.id);
    if (seen.current === null) { seen.current = ids.length ? ids[ids.length - 1] : 0n; return; }
    for (const e of snap.eyes) {
      if (e.id > seen.current) { seen.current = e.id; applyRef.current(e.command as Cmd); }
    }
  }, [snap.eyes, snap.patient]);

  // Keyboard stands in for the eyes.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const map: Record<string, Cmd> = { ArrowLeft: 'left', ArrowRight: 'right', ' ': 'select', Enter: 'select', p: 'toggle', P: 'toggle', s: 'sos', S: 'sos' };
      const cmd = map[ev.key];
      if (!cmd) return;
      ev.preventDefault();
      if (link === 'live' || DEMO) actionsRef.current.eye(cmd);   // round-trips as an eye_event, like the board
      else applyRef.current(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link]);

  // A caregiver acknowledged: tell the patient help is coming.
  const lastAck = useRef<bigint | null>(null);
  useEffect(() => {
    if (!snap.patient) return;
    const acked = snap.alerts.filter(a => a.acked_by && !a.acked_by.startsWith('patient'));
    const latest = acked.at(-1);
    if (lastAck.current === null) { lastAck.current = latest?.id ?? 0n; return; }
    if (latest && latest.id > lastAck.current) {
      lastAck.current = latest.id;
      setAckNote(`${latest.acked_by} got your alert and is on the way.`);
      tts('Help is on the way.');
      const t = setTimeout(() => setAckNote(null), 9000);
      return () => clearTimeout(t);
    }
  }, [snap.alerts, snap.patient]);

  // Keep the lit choice centred; after wrapping into an outer copy, jump back to the middle copy unseen.
  const n = s.items.length;
  const ribbon = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const lastLen = useRef(n);
  if (n !== lastLen.current || v.current < 0 || v.current >= COPIES * n || ((v.current % n) + n) % n !== s.idx) {
    v.current = n + s.idx; animate.current = false;      // the list changed or the speller jumped (select, new mode)
  }
  lastLen.current = n;
  useLayoutEffect(() => {
    const r = ribbon.current, tr = track.current;
    const el = tr?.children[v.current] as HTMLElement | undefined;
    if (!r || !tr || !el) return;
    tr.style.transition = animate.current ? '' : 'none';
    tr.style.transform = `translateX(${r.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2)}px)`;
    if (!animate.current) { void tr.offsetWidth; tr.style.transition = ''; animate.current = true; }
    if (v.current < n || v.current >= 2 * n) {
      const t = setTimeout(() => { v.current = n + s.idx; animate.current = false; rerender(); }, 280);
      return () => clearTimeout(t);
    }
  });

  const focusItem = s.items[s.idx];
  const modeLabel = s.mode === 'group' ? `Letters ${s.group?.[0]} to ${s.group?.at(-1)}`
    : s.mode === 'quick' ? 'Quick phrases'
    : s.mode === 'to' ? 'Who should get this?'
    : focusItem?.kind === 'reply' ? (focusItem.to ? `Send to ${focusItem.to}` : `Reply to ${from || 'them'}`)
    : focusItem?.kind === 'expand' ? 'Turn your words into full messages'
    : focusItem?.kind === 'text' ? 'Choose who to send it to' : '';
  const ladder = snap.contacts.filter(c => c.tier > 0).sort((a, b) => a.tier - b.tier);
  const openSos = [...snap.alerts].reverse().find(a => a.kind === 'sos' && !a.acked_by);
  const tiles = Array.from({ length: COPIES }, () => s.items).flat();

  return (
    <div className="pt">
      <header className="pt-top">
        <span className="pt-brand"><Icon name="eye" /> BlinkTalk</span>
        <span className={`pt-link pt-link-${link}`}>{link === 'live' ? 'Connected' : link === 'demo' ? 'Demo' : link === 'connecting' ? 'Connecting…' : 'Offline: keyboard only'}</span>
        {snap.patient?.heart_bpm ? <span className="pt-heart"><Icon name="heart" /> {snap.patient.heart_bpm}</span> : null}
      </header>

      <section className="pt-inbox" aria-live="polite">
        {inbox ? (
          <>
            <span className="pt-from">{from}</span>
            {(() => {
              const { text, photos } = splitPhotos(inbox.body);
              return (
                <>
                  {text && <p className="pt-msg">{text}</p>}
                  {photos.map((d, i) => (
                    <p key={i} className="pt-photo"><Icon name="image" /> <span>{d ? `Sent a photo: ${d}` : 'Sent a photo'}</span></p>
                  ))}
                </>
              );
            })()}
          </>
        ) : (
          <p className="pt-msg pt-quiet">{name ? `Hi ${name}.` : 'Hi.'} Messages from your family will appear here.</p>
        )}
      </section>

      <section className="pt-compose">
        <p className={`pt-text ${s.text || s.pending ? '' : 'pt-empty'}`}>
          {s.pending || s.text || 'Look left or right to move. Blink twice to choose.'}
          {s.text && !s.pending && <span className="pt-caret" aria-hidden />}
        </p>
        <p className="pt-status" aria-live="polite">{s.status}</p>
      </section>

      <div className="pt-mode">{modeLabel}</div>
      <div className="pt-ribbon" ref={ribbon}>
        <span key={`l${pulse?.n}`} className={`pt-cue pt-cue-l ${pulse?.side === 'left' ? 'on' : ''}`} aria-hidden><Icon name="chevron-left" /></span>
        <ol className="pt-track" ref={track}>
          {tiles.map((it, i) => {
            const d = Math.abs(i - v.current);
            const on = i === v.current;
            return (
              <li
                key={`${s.mode}-${i}`}
                className={`pt-tile k-${it.kind} ${on ? 'focus' : ''} ${on && pulse?.side === 'select' ? 'press' : ''}`}
                style={{ opacity: on ? 1 : Math.max(0.16, 0.8 - d * 0.15) }}
                aria-current={on ? 'true' : undefined}
                aria-hidden={on ? undefined : true}
              >
                {ICON_FOR[it.kind] && <Icon name={ICON_FOR[it.kind]!} />}
                <span className="pt-label">{it.kind === 'group' ? it.value.split('').join(' ') : it.value}</span>
                {it.kind === 'reply' && it.to && <span className="pt-to">to {it.to}</span>}
              </li>
            );
          })}
        </ol>
        <span key={`r${pulse?.n}`} className={`pt-cue pt-cue-r ${pulse?.side === 'right' ? 'on' : ''}`} aria-hidden><Icon name="chevron-right" /></span>
      </div>

      <footer className="pt-legend">
        <span><Icon name="arrows" /> look to move</span>
        <span><Dots n={2} /> choose</span>
        <span><Dots n={3} /> on / off</span>
        <span><Dots n={5} /> call for help</span>
      </footer>

      {sosOn && (
        <div className="pt-sos" role="alert">
          <h1>Getting you help</h1>
          <p>{ladder.length ? `Texting ${ladder.filter(c => !openSos || c.tier <= openSos.level).map(c => c.name).join(', ') || ladder[0].name}.` : 'Alerting your caregivers.'} {ladder.length > 1 ? 'If nobody answers, BlinkTalk tries the next person.' : ''}</p>
          <p className="pt-sos-cancel">Blink twice to cancel</p>
        </div>
      )}
      {paused && (
        <div className="pt-paused" role="status">
          <h1>Resting</h1>
          <p>BlinkTalk is ignoring your eyes so you can look around freely.</p>
          <p className="pt-paused-how"><Dots n={3} /> Blink three times to switch it back on. Five blinks still call for help.</p>
        </div>
      )}
      {ackNote && !sosOn && <div className="pt-ack" role="status">{ackNote}</div>}
    </div>
  );
}

function Dots({ n }: { n: number }) {
  return <span className="pt-dots" role="img" aria-label={`${n} blinks`}>{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>;
}
