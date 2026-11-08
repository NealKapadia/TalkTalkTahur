/**
 * The patient's screen. Built for someone who moves one step at a time with
 * their eyes and may look at it for hours: a night palette, one choice in
 * focus at the centre of a ribbon, the message they're answering on top, and
 * their own words in large reading type.
 *
 * Input: the patient's eye movements arrive as eye_event rows (from the board
 * via the bridge) and are applied in order; the keyboard (arrows, Space, S)
 * goes through the same path. Offline it applies keys directly.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEMO, useBlinkTalk } from './data';
import { Speller, type Item } from './speller';
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

const ICON: Partial<Record<Item['kind'], string>> = {
  space: '␣', delete: '⌫', speak: '🔊', text: '💬', expand: '✨', quick: '★', back: '↩',
};

export default function PatientScreen() {
  const { snap, link, actions } = useBlinkTalk();
  const [, force] = useState(0);
  const rerender = () => force(n => n + 1);
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
      reply: text => actionsRef.current.replyLatest(text),
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

  // Backend context -> speller (AI replies, whether texting is possible, phrase ranking).
  useEffect(() => {
    s.setContext({
      replies: snap.suggestions.map(x => x.text),
      canText: !!inbox,
      usage: new Map(snap.phrases.map(p => [p.text, p.uses])),
    });
    rerender();
  }, [snap.suggestions, snap.phrases, inbox?.id]);

  // Apply one command.
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
    if (cmd === 'left') s.move(-1);
    else if (cmd === 'right') s.move(1);
    else s.select();
    if (s.text !== lastDraft.current) {
      lastDraft.current = s.text;
      actionsRef.current.setDraft(s.text);
    }
    rerender();
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Eye events from the backend (board -> bridge -> SpacetimeDB), in order, new ones only.
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
    if (!snap.patient) return;                      // wait for the first full snapshot
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

  // Keep the focused choice centred.
  const ribbon = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const r = ribbon.current, tr = track.current;
    const el = tr?.children[s.idx] as HTMLElement | undefined;
    if (!r || !tr || !el) return;
    const x = r.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
    tr.style.transform = `translateX(${x}px)`;
  });

  const focusKind = s.items[s.idx]?.kind;
  const modeLabel = s.mode === 'group' ? `Letters ${s.group?.[0]} to ${s.group?.at(-1)}` : s.mode === 'quick' ? 'Quick phrases'
    : focusKind === 'reply' ? `Reply to ${from || 'them'}` : focusKind === 'expand' ? 'Turn your words into full sentences' : focusKind === 'text' ? `Send to ${from || 'them'}` : '';
  const ladder = snap.contacts.filter(c => c.tier > 0).sort((a, b) => a.tier - b.tier);
  const openSos = [...snap.alerts].reverse().find(a => a.kind === 'sos' && !a.acked_by);

  return (
    <div className="pt">
      <header className="pt-top">
        <span className="pt-brand">BlinkTalk</span>
        <span className={`pt-link pt-link-${link}`}>{link === 'live' ? 'Connected' : link === 'demo' ? 'Demo' : link === 'connecting' ? 'Connecting…' : 'Offline: keyboard only'}</span>
        {snap.patient?.heart_bpm ? <span className="pt-heart">♥ {snap.patient.heart_bpm}</span> : null}
      </header>

      <section className="pt-inbox" aria-live="polite">
        {inbox ? (
          <>
            <span className="pt-from">{from}</span>
            <p className="pt-msg">{inbox.body}</p>
          </>
        ) : (
          <p className="pt-msg pt-quiet">{name ? `Hi ${name}.` : 'Hi.'} Messages from your family will appear here.</p>
        )}
      </section>

      <section className="pt-compose">
        <p className={`pt-text ${s.text ? '' : 'pt-empty'}`}>
          {s.text || 'Look left or right to move. Double blink to choose.'}
          {s.text && <span className="pt-caret" aria-hidden />}
        </p>
        <p className="pt-status" aria-live="polite">{s.status}</p>
      </section>

      <div className="pt-mode">{modeLabel}</div>
      <div className="pt-ribbon" ref={ribbon}>
        <span key={`l${pulse?.n}`} className={`pt-cue pt-cue-l ${pulse?.side === 'left' ? 'on' : ''}`} aria-hidden>‹</span>
        <ol className="pt-track" ref={track}>
          {s.items.map((it, i) => {
            const d = Math.abs(i - s.idx);
            return (
              <li
                key={`${s.mode}-${it.kind}-${it.value}-${i}`}
                className={`pt-tile k-${it.kind} ${i === s.idx ? 'focus' : ''} ${i === s.idx && pulse?.side === 'select' ? 'press' : ''}`}
                style={{ opacity: i === s.idx ? 1 : Math.max(0.18, 0.75 - d * 0.14) }}
                aria-current={i === s.idx ? 'true' : undefined}
              >
                {ICON[it.kind] && <span className="pt-ico" aria-hidden>{ICON[it.kind]}</span>}
                <span className="pt-label">{it.kind === 'group' ? it.value.split('').join(' ') : it.value}</span>
              </li>
            );
          })}
        </ol>
        <span key={`r${pulse?.n}`} className={`pt-cue pt-cue-r ${pulse?.side === 'right' ? 'on' : ''}`} aria-hidden>›</span>
      </div>

      <footer className="pt-legend">
        <span><b>‹ ›</b> look to move</span>
        <span><b>● ●</b> double blink to choose</span>
        <span><b>● ● ●</b> three blinks: on / off</span>
        <span><b>● ● ● ●</b> four blinks for help</span>
      </footer>

      {sosOn && (
        <div className="pt-sos" role="alert">
          <h1>Getting you help</h1>
          <p>{ladder.length ? `Texting ${ladder.filter(c => !openSos || c.tier <= openSos.level).map(c => c.name).join(', ') || ladder[0].name}.` : 'Alerting your caregivers.'} {ladder.length > 1 ? 'If nobody answers, BlinkTalk tries the next person.' : ''}</p>
          <p className="pt-sos-cancel">Double blink to cancel</p>
        </div>
      )}
      {paused && (
        <div className="pt-paused" role="status">
          <h1>Resting</h1>
          <p>BlinkTalk is ignoring your eyes so you can look around freely.</p>
          <p className="pt-paused-how"><b>● ● ●</b> Three blinks to switch it back on. Four blinks still calls for help.</p>
        </div>
      )}
      {ackNote && !sosOn && <div className="pt-ack" role="status">{ackNote}</div>}
    </div>
  );
}
