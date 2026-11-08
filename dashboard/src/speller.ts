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

export type Kind = 'reply' | 'phrase' | 'word' | 'quick' | 'group' | 'letter' | 'back' | 'space' | 'delete' | 'speak' | 'text' | 'expand';
export interface Item { kind: Kind; value: string }
export type Mode = 'main' | 'group' | 'quick';

export interface Effects {
  speak(text: string): void;
  reply(text: string): void;
  expand(keywords: string): void;
}

export interface Context {
  replies: string[];          // AI suggestions currently offered
  canText: boolean;           // someone has texted, so "Text it" makes sense
  usage: Map<string, number>; // phrase -> uses, to rank suggestions
}

export class Speller {
  text = '';
  mode: Mode = 'main';
  group: string | null = null;
  idx = 0;
  items: Item[] = [];
  status = '';
  ctx: Context = { replies: [], canText: false, usage: new Map() };

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
    } else if (this.mode === 'quick') {
      items = [...QUICK_PHRASES.map(value => ({ kind: 'phrase' as const, value })), { kind: 'back', value: 'Back' }];
    } else {
      items = [
        ...this.ctx.replies.map(value => ({ kind: 'reply' as const, value })),
        ...this.suggestions(),
        { kind: 'quick', value: 'Quick phrases' },
        ...GROUPS.map(value => ({ kind: 'group' as const, value })),
        { kind: 'space', value: 'Space' },
        { kind: 'delete', value: 'Delete' },
        { kind: 'speak', value: 'Say it' },
      ];
      if (this.text.trim() && this.ctx.canText) items.push({ kind: 'text', value: 'Text it' });
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
    const fresh = !!ctx.replies?.length && ctx.replies.join('\n') !== this.ctx.replies.join('\n');
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
      case 'reply':
        this.send(value);
        this.ctx = { ...this.ctx, replies: [] };
        break;
      case 'text':
        this.send(this.text.trim());
        this.text = '';
        break;
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
        backTo = this.mode === 'group' ? this.group : null; this.mode = 'main';
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
    if (this.mode === 'main' && ['letter', 'back', 'phrase', 'word', 'reply', 'text', 'expand', 'speak'].includes(kind)) {
      if (kind === 'letter' && this.suggestions().length) this.idx = this.ctx.replies.length;   // first suggestion
      else if (backTo) this.idx = this.indexOf('group', backTo);
      else this.idx = this.indexOf('group', GROUPS[0]);
    }
  }

  private say(text: string) {
    this.fx.speak(text);
    this.status = `Said: “${text}”`;
  }

  private send(text: string) {
    if (!text) return;
    this.fx.reply(text);
    this.status = `Texted: “${text}”`;
  }
}
