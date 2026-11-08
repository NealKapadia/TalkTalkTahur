/**
 * BlinkTalk agent, powered by NVIDIA Nemotron.
 *
 * Every glance costs the patient seconds, so the agent turns an incoming text
 * (or 2-3 keywords picked with the eyes) into four complete, first-person
 * replies the patient can send with one double blink. It is not a chatbot: it
 * never answers on the patient's behalf. It plans, calls tools against the live
 * SpacetimeDB state, decides whether caregivers need to know something, and
 * only then proposes replies. Every step is written to the agent_step table so
 * caregivers can watch it work.
 *
 * Runs against NVIDIA's hosted API (build.nvidia.com) or a local Nemotron
 * served by Ollama / vLLM / NIM (any OpenAI-compatible endpoint), so the whole
 * system can run with no internet except the messaging channel.
 */
import { randomUUID } from 'node:crypto';
import { settings } from './env.ts';

// ------------------------------------------------------------------ ports
/** What the agent can read and do. Implemented over SpacetimeDB in main.ts, faked in tests. */
export interface AgentPorts {
  patientName: string;
  conversation(): Array<{ who: string; text: string; at?: string }>;
  patientState(): Record<string, unknown>;
  contact(): { name: string; relation: string; isCaregiver: boolean };
  alertCaregivers(reason: string): Promise<void>;
  propose(replies: string[], source: 'nemotron' | 'fallback'): Promise<void>;
  log(step: string, detail: string): Promise<void>;
}

export type Task =
  | { kind: 'reply'; message: { body: string } }
  | { kind: 'intent'; keywords: string };

// ------------------------------------------------------------------ deterministic fallback
export function fallbackReplies(task: Task): string[] {
  if (task.kind === 'intent') {
    const k = task.keywords.trim();
    const cap = k.charAt(0).toUpperCase() + k.slice(1);
    return [`${cap}, please.`, `I need ${k}.`, `Can we talk about ${k}?`, `Yes, ${k}.`];
  }
  const t = task.message.body.toLowerCase();
  if (/\?\s*$/.test(t) || /\b(are|do|can|will|would|should|is)\s+you\b/.test(t)) {
    if (/\b(ok|okay|alright|doing|feel)/.test(t)) return ["I'm okay, thanks.", 'Not great today.', 'Can you come by?', 'Call me later.'];
    if (/\b(visit|come|stop by|tonight|tomorrow|bring)\b/.test(t)) return ['Yes, please come.', 'Not today, sorry.', 'Tomorrow is better.', 'What time?'];
    return ['Yes.', 'No.', 'Maybe later.', 'Can you call me?'];
  }
  return ['Thank you.', 'Love you.', 'Can you call me?', 'Talk soon.'];
}

// ------------------------------------------------------------------ Nemotron client
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type ChatMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type Fetch = typeof fetch;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_conversation',
      description: 'Recent messages between the patient and this contact (plus what the patient said aloud), oldest first.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_patient_state',
      description: "The patient's live state: heart rate trend, current status, local time, open alerts, phrases they use most.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'alert_caregivers',
      description: "Text the patient's caregivers. Only for a genuine safety concern: the message reports an emergency, or the patient's state looks medically worrying.",
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_replies',
      description: 'Finish: give exactly 4 short first-person replies the patient can send with one selection.',
      parameters: {
        type: 'object',
        properties: { replies: { type: 'array', items: { type: 'string' } } },
        required: ['replies'],
      },
    },
  },
] as const;

function systemPrompt(name: string): string {
  return [
    `You are the communication agent inside BlinkTalk. ${name} cannot speak or type; they control a screen with eye movements, and every selection costs several seconds.`,
    'You never message anyone yourself. You prepare 4 reply options that sound like the patient: first person, warm, plain, at most 12 words each.',
    'Make the 4 options meaningfully different (for example yes / no / not now / a question back). Use facts from the tools; never invent plans, names or medical facts.',
    'Workflow: 1) call get_conversation and get_patient_state; 2) call alert_caregivers only if there is a genuine safety concern; 3) call propose_replies.',
  ].join('\n');
}

function taskPrompt(task: Task, contact: { name: string; relation: string }): string {
  if (task.kind === 'intent') {
    return `The patient selected these keywords with their eyes: "${task.keywords}". Expand them into 4 complete replies to ${contact.name} (${contact.relation || 'contact'}), using the conversation for context.`;
  }
  return `New message from ${contact.name} (${contact.relation || 'unknown relation'}): "${task.message.body}". Follow the workflow.`;
}

export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function parseRepliesFromText(s: string): string[] | null {
  const text = stripThinking(s);
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (Array.isArray(j.replies)) return j.replies.map(String);
    } catch { /* fall through */ }
  }
  const lines = text.split('\n').map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^"|"$/g, '').trim()).filter(Boolean);
  return lines.length >= 2 ? lines.slice(0, 4) : null;
}

const isLocal = () => /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(settings.nemotronBaseUrl);
export const agentConfigured = () => Boolean(settings.nvidiaKey) || isLocal();

async function chat(fetchFn: Fetch, messages: ChatMsg[], useTools: boolean): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const body: Record<string, unknown> = {
    model: settings.nemotronModel,
    messages,
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 800,
  };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  if (!settings.nemotronThinking && !isLocal()) body.chat_template_kwargs = { enable_thinking: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (settings.nvidiaKey) headers.Authorization = `Bearer ${settings.nvidiaKey}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), settings.nemotronTimeoutMs);
  try {
    const res = await fetchFn(`${settings.nemotronBaseUrl}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal,
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`Nemotron HTTP ${res.status}: ${txt}`), { status: res.status });
    }
    const data = (await res.json()) as { choices?: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Nemotron returned no choices');
    return msg;
  } finally {
    clearTimeout(timer);
  }
}

function clampReplies(replies: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of replies) {
    const t = stripThinking(String(r)).replace(/\s+/g, ' ').trim().slice(0, 140);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, 4);
}

// ------------------------------------------------------------------ the run
export async function runAgent(task: Task, ports: AgentPorts, fetchFn: Fetch = fetch): Promise<string[]> {
  const runId = randomUUID().slice(0, 8);
  const log = (step: string, detail: string) => ports.log(step, `[${runId}] ${detail}`);
  const contact = ports.contact();
  let alerted = false;

  await log('plan', task.kind === 'reply'
    ? `Text from ${contact.name}. Plan: read the conversation and ${ports.patientName}'s state, check whether caregivers need to know, draft 4 replies.`
    : `${ports.patientName} picked "${task.keywords}". Plan: read the conversation, expand into 4 full replies.`);

  const finish = async (replies: string[], source: 'nemotron' | 'fallback') => {
    await ports.propose(replies, source);
    await log('reply', replies.join(' | '));
    return replies;
  };
  const finishFallback = async (why: string) => {
    await log('fallback', why);
    return finish(fallbackReplies(task), 'fallback');
  };

  if (!agentConfigured()) return finishFallback('No Nemotron endpoint configured; using built-in replies.');

  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt(ports.patientName) },
    { role: 'user', content: taskPrompt(task, contact) },
  ];
  let useTools = true;

  for (let turn = 0; turn < 6; turn++) {
    let msg;
    try {
      msg = await chat(fetchFn, messages, useTools);
    } catch (err: any) {
      if (useTools && err?.status && err.status >= 400 && err.status < 500) {
        await log('retry', `Tool calling rejected (${err.status}); retrying in JSON mode.`);
        useTools = false;
        messages.push({ role: 'user', content: `Tools are unavailable. Context: conversation=${JSON.stringify(ports.conversation())} state=${JSON.stringify(ports.patientState())}. Reply ONLY with JSON: {"replies":["","","",""]}` });
        continue;
      }
      return finishFallback(`Nemotron unavailable (${String(err?.message ?? err).slice(0, 160)}).`);
    }

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const parsed = parseRepliesFromText(msg.content ?? '');
      const replies = parsed ? clampReplies(parsed) : [];
      if (replies.length >= 2) return finish(replies, 'nemotron');
      messages.push({ role: 'assistant', content: msg.content ?? '' });
      messages.push({ role: 'user', content: 'Call propose_replies with exactly 4 replies now.' });
      continue;
    }

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }
      let result: unknown;
      switch (call.function.name) {
        case 'get_conversation':
          result = ports.conversation();
          break;
        case 'get_patient_state':
          result = ports.patientState();
          break;
        case 'alert_caregivers':
          if (!alerted) { await ports.alertCaregivers(String(args.reason ?? 'Agent safety concern')); alerted = true; }
          result = { sent: true };
          break;
        case 'propose_replies': {
          const replies = clampReplies(Array.isArray(args.replies) ? args.replies : []);
          if (replies.length >= 2) {
            await log('tool', `propose_replies(${replies.length} options)`);
            return finish(replies, 'nemotron');
          }
          result = { error: 'need 4 non-empty replies' };
          break;
        }
        default:
          result = { error: `unknown tool ${call.function.name}` };
      }
      await log('tool', `${call.function.name}(${JSON.stringify(args).slice(0, 120)}) -> ${JSON.stringify(result).slice(0, 200)}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return finishFallback('Agent did not finish in 6 steps.');
}
