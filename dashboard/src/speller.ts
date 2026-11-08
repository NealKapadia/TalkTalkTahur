/**
 * Eyes-only speller logic (pure: no DOM, no network), shared by the patient
 * screen and its tests. Same behaviour as the original Python speller:
 *   left / right  move the focus      select  choose      (sos is handled by the screen)
 */
export const GROUPS = ['ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXYZ'];

export const QUICK_PHRASES = [
  'Yes.', 'No.', "I'm in pain.", 'Please call the nurse.', "I'm thirsty.", 'Thank you.',
];

const PHRASE_BANK: Array<[string, string]> = [
  ['water', "I'd like some water, please."], ['want', 'I want to sit up.'], ['wait', 'Wait a moment, please.'],
  ['what', 'What time is it?'], ['pain', "I'm in pain."], ['nurse', 'Please call the nurse.'], ['help', 'Please help me.'],
  ['hot', "I'm too hot."], ['cold', "I'm cold."], ['bathroom', 'I need the bathroom.'], ['tired', "I'm tired."],
  ['thank', 'Thank you.'], ['love', 'I love you.'], ['hungry', "I'm hungry."], ['turn', 'Please turn me over.'],
  ['light', 'Please turn off the light.'], ['tv', 'Please turn on the TV.'], ['family', 'Please call my family.'],
  ['doctor', "I'd like to see the doctor."], ['medicine', 'Is it time for my medicine?'], ['music', 'Please play some music.'],
  ['blanket', 'Can I have a blanket?'], ['sleep', 'I want to sleep.'],
];

const WORDS = `i you yes no please thank thanks water want wait what when where who why how help hurt pain nurse
doctor family mom dad home hot cold tired hungry thirsty food drink bathroom bed sit up down turn light tv music
phone call more less now later today tomorrow good bad okay love need like feel sleep medicine blanket pillow window
door open close stop go come here there time morning night`.split(/\s+/);

export type Kind = 'reply' | 'phrase' | 'word' | 'quick' | 'group' | 'letter' | 'back' | 'space' | 'delete' | 'speak' | 'text' | 'expand' | 'contact';
/** `to` / `contactId`: who a reply or contact item sends to. */
export interface Item { kind: Kind; value: string; to?: string; contactId?: string }
export type Mode = 'main' | 'group' | 'quick' | 'to';

export interface Effects {
  speak(text: string): void;
  /** Send a text. contactId undefined = reply to whoever wrote last. */
  send(text: string, contactId?: string): void;
  expand(keywords: string): void;
}

export interface Reply { text: string; contactId?: string; to?: string }
export interface Person { id: string; name: string }

export interface Context {
  replies: Reply[];           // AI suggestions currently offered (each may name its recipient)
  contacts: Person[];         // who "Text it" can send to, most relevant first
  canText: boolean;           // there is someone to text
  usage: Map<string, number>; // phrase -> uses, to rank suggestions
}

export class Speller {
  text = '';
  mode: Mode = 'main';
  group: string | null = null;
  idx = 0;
  items: Item[] = [];
  status = '';
  ctx: Context = { replies: [], contacts: [], canText: false, usage: new Map() };
  pending = '';               // text waiting for a recipient (mode 'to')

  constructor(private fx: Effects) {
    this.rebuild();
    this.idx = this.indexOf('group', GROUPS[0]);
  }

  currentWord(): string {
    if (!this.text || this.text.endsWith(' ')) return '';
    return this.text.split(' ').at(-1) ?? '';
  }

  suggestions(): Item[] {
    const w = this.currentWord().toLowerCase();
    if (w.length < 2) return [];
    const phrases = [...new Set(PHRASE_BANK.filter(([k]) => k.startsWith(w)).map(([, p]) => p))]
      .sort((a, b) => (this.ctx.usage.get(b) ?? 0) - (this.ctx.usage.get(a) ?? 0))
      .slice(0, 3);
    const words = WORDS.filter(x => x.startsWith(w) && x !== w).slice(0, 4 - phrases.length);
    return [...phrases.map(value => ({ kind: 'phrase' as const, value })), ...words.map(value => ({ kind: 'word' as const, value }))];
  }

  rebuild() {
    let items: Item[];
    if (this.mode === 'group') {
      items = [...(this.group ?? '').split('').map(value => ({ kind: 'letter' as const, value })), { kind: 'back', value: 'Back' }];
    } else if (this.mode === 'to') {
      items = [...this.ctx.contacts.map(c => ({ kind: 'contact' as const, value: c.name, contactId: c.id })), { kind: 'back', value: 'Back' }];
    } else if (this.mode === 'quick') {
      items = [...QUICK_PHRASES.map(value => ({ kind: 'phrase' as const, value })), { kind: 'back', value: 'Back' }];
    } else {
      items = [
        ...this.ctx.replies.map(r => ({ kind: 'reply' as const, value: r.text, to: r.to, contactId: r.contactId })),
        ...this.suggestions(),
        { kind: 'quick', value: 'Quick phrases' },
        ...GROUPS.map(value => ({ kind: 'group' as const, value })),
        { kind: 'space', value: 'Space' },
        { kind: 'delete', value: 'Delete' },
        { kind: 'speak', value: 'Say it' },
      ];
      if (this.text.trim() && (this.ctx.canText || this.ctx.contacts.length)) items.push({ kind: 'text', value: 'Text it' });
      if (this.text.trim()) items.push({ kind: 'expand', value: 'AI expand' });
    }
    this.items = items;
    this.idx = Math.max(0, Math.min(this.idx, items.length - 1));
  }

  indexOf(kind: Kind, value?: string): number {
    const i = this.items.findIndex(it => it.kind === kind && (value === undefined || it.value === value));
    return i < 0 ? 0 : i;
  }

  /** New AI replies / inbox state from the backend. Focus jumps to the first new reply. */
  setContext(ctx: Partial<Context>) {
    const key = (r: Reply[]) => r.map(x => `${x.contactId}:${x.text}`).join('\n');
    const fresh = !!ctx.replies?.length && key(ctx.replies) !== key(this.ctx.replies);
    const keep = this.items[this.idx];
    this.ctx = { ...this.ctx, ...ctx };
    this.rebuild();
    if (fresh && this.mode === 'main') {
      this.idx = 0;
      if (this.status.startsWith('Asking')) this.status = '';
    } else if (keep) {
      const i = this.items.findIndex(it => it.kind === keep.kind && it.value === keep.value);
      if (i >= 0) this.idx = i;
    }
    return fresh;
  }

  move(step: number) {
    this.idx = (this.idx + step + this.items.length) % this.items.length;
  }

  select() {
    const { kind, value } = this.items[this.idx];
    let backTo: string | null = null;
    switch (kind) {
      case 'phrase':
        this.say(value);
        this.text = ''; this.mode = 'main';
        break;
      case 'reply': {
        const it = this.items[this.idx];
        this.send(value, it.contactId, it.to);
        this.ctx = { ...this.ctx, replies: [] };
        break;
      }
      case 'text': {
        const t = this.text.trim();
        if (this.ctx.contacts.length > 1) {          // choose who it goes to
          this.pending = t; this.mode = 'to'; this.idx = 0;
        } else {
          const only = this.ctx.contacts[0];
          this.send(t, only?.id, only?.name);
          this.text = '';
        }
        break;
      }
      case 'contact': {
        const it = this.items[this.idx];
        this.send(this.pending, it.contactId, it.value);
        this.pending = ''; this.text = ''; this.mode = 'main';
        break;
      }
      case 'expand':
        this.fx.expand(this.text.trim());
        this.status = `Asking for sentences with "${this.text.trim()}"…`;
        this.text = '';
        break;
      case 'word': {
        const cw = this.currentWord();
        this.text = this.text.slice(0, this.text.length - cw.length) + value + ' ';
        break;
      }
      case 'quick':
        this.mode = 'quick'; this.idx = 0;
        break;
      case 'group':
        this.mode = 'group'; this.group = value; this.idx = 0;
        break;
      case 'letter':
        this.text += this.text.length === 0 ? value : value.toLowerCase();
        backTo = this.group; this.mode = 'main';
        break;
      case 'back':
        backTo = this.mode === 'group' ? this.group : null; this.mode = 'main'; this.pending = '';
        break;
      case 'space':
        if (this.text && !this.text.endsWith(' ')) this.text += ' ';
        break;
      case 'delete':
        this.text = this.text.slice(0, -1);
        break;
      case 'speak':
        if (this.text.trim()) { this.say(this.text.trim()); this.text = ''; }
        break;
    }
    this.rebuild();
    if (this.mode === 'main' && ['letter', 'back', 'phrase', 'word', 'reply', 'text', 'contact', 'expand', 'speak'].includes(kind)) {
      if (kind === 'letter' && this.suggestions().length) this.idx = this.ctx.replies.length;   // first suggestion
      else if (backTo) this.idx = this.indexOf('group', backTo);
      else this.idx = this.indexOf('group', GROUPS[0]);
    }
  }

  private say(text: string) {
    this.fx.speak(text);
    this.status = `Said: “${text}”`;
  }

  private send(text: string, contactId?: string, to?: string) {
    if (!text) return;
    this.fx.send(text, contactId);
    this.status = to ? `Texted ${to}: “${text}”` : `Texted: “${text}”`;
  }
}

/**
 * Eye movements needed to spell `text` letter by letter on this speller (glances +
 * double blinks), simulated on a fresh speller with no suggestions. Used to show
 * how many movements an AI-drafted message saved.
 */
export function spellCost(text: string): number {
  const sp = new Speller({ speak() {}, send() {}, expand() {} });
  const dist = (from: number, to: number, n: number) => Math.min((to - from + n) % n, (from - to + n) % n);
  let moves = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      const i = sp.items.findIndex(it => it.kind === 'space');
      moves += dist(sp.idx, i, sp.items.length) + 1; sp.idx = i; sp.select();
      continue;
    }
    const g = GROUPS.find(gr => gr.includes(ch));
    if (!g) continue;                                   // punctuation is free on this keyboard
    const gi = sp.items.findIndex(it => it.kind === 'group' && it.value === g);
    moves += dist(sp.idx, gi, sp.items.length) + 1; sp.idx = gi; sp.select();
    const li = sp.items.findIndex(it => it.kind === 'letter' && it.value === ch);
    moves += dist(sp.idx, li, sp.items.length) + 1; sp.idx = li; sp.select();
    sp.ctx.usage = new Map(); sp.rebuild();
    const back = sp.items.findIndex(it => it.kind === 'group' && it.value === g);
    if (back >= 0) sp.idx = back;
  }
  return moves;
}
