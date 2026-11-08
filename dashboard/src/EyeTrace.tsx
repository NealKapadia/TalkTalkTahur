/**
 * The patient's recent eye movements drawn the way the electrodes see them (EOG):
 * a glance is a step away and back, a blink is a sharp spike. Two spikes chose
 * something, three switched BlinkTalk on/off, five called for help (drawn in red).
 */
import type { EyeEvent } from '@bindings';

const W = 1000, H = 120, BASE = 66, AMP = 30;

function segment(cmd: string, x0: number, w: number): string {
  const p = (fx: number, y: number) => `L${(x0 + w * fx).toFixed(1)},${y.toFixed(1)}`;
  if (cmd === 'left' || cmd === 'right') {
    const y = cmd === 'left' ? BASE + AMP * 0.8 : BASE - AMP * 0.8;
    return [p(0.18, BASE), p(0.28, y), p(0.72, y), p(0.82, BASE), p(1, BASE)].join(' ');
  }
  const k = cmd === 'select' ? 2 : cmd === 'toggle' ? 3 : cmd === 'sos' ? 5 : 1;
  const out: string[] = [];
  for (let j = 0; j < k; j++) {
    const c = 0.12 + (0.76 * (j + 0.5)) / k;
    out.push(p(c - 0.05, BASE), p(c, BASE - AMP * 1.7), p(c + 0.05, BASE));
  }
  out.push(p(1, BASE));
  return out.join(' ');
}

const LABEL: Record<string, string> = { left: 'look left', right: 'look right', select: 'chose', toggle: 'on / off', sos: 'help' };

export function EyeTrace({ events }: { events: EyeEvent[] }) {
  const recent = events.slice(-18);
  const slots = Math.max(recent.length, 10);
  const w = W / slots;
  const start = (slots - recent.length) * w;   // newest at the right edge
  let d = `M0,${BASE} L${start.toFixed(1)},${BASE}`;
  const sos: string[] = [];
  recent.forEach((e, i) => {
    const x0 = start + i * w;
    const seg = segment(e.command, x0, w);
    d += ' ' + seg;
    if (e.command === 'sos') sos.push(`M${x0.toFixed(1)},${BASE} ${seg}`);
  });
  const summary = recent.map(e => LABEL[e.command] ?? e.command).join(', ');
  return (
    <figure className="trace">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={recent.length ? `Recent eye movements: ${summary}` : 'No eye movements yet'}>
        <line x1="0" x2={W} y1={BASE} y2={BASE} className="trace-base" />
        <path d={d} className="trace-line" vectorEffect="non-scaling-stroke" />
        {sos.map((s, i) => <path key={i} d={s} className="trace-sos" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <figcaption>
        {recent.slice(-6).map(e => <span key={String(e.id)} className={`tl tl-${e.command}`}>{LABEL[e.command] ?? e.command}</span>)}
      </figcaption>
    </figure>
  );
}
