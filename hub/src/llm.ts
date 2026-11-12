/**
 * One chat client for every AI job in the hub (reply drafts, photo descriptions, briefings).
 *
 * Provider order:
 *   1. Azure AI Foundry, when AZURE_OPENAI_API_KEY is set (OpenAI v1 API:
 *      POST {AZURE_OPENAI_ENDPOINT}/chat/completions, model = the deployment name).
 *   2. NVIDIA Nemotron (build.nvidia.com, or a local Ollama / vLLM / NIM endpoint).
 *   3. None: callers fall back to built-in replies / a plain summary.
 *
 * Azure's newer chat models reject some Nemotron-era parameters, so for Azure the request
 * carries only model, messages, tools and max_completion_tokens (no temperature, top_p or
 * chat_template_kwargs). If a deployment rejects max_completion_tokens the call is retried
 * once with max_tokens.
 */
import { settings } from './env.ts';

export type Fetch = typeof fetch;
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Provider = 'azure' | 'nemotron' | 'none';

export interface ChatRequest {
  messages: unknown[];
  tools?: readonly unknown[];
  maxTokens: number;
  temperature?: number;          // used for Nemotron only
  vision?: boolean;              // picks NEMOTRON_VISION_MODEL when set
}

export interface ChatReply { content: string | null; tool_calls?: ToolCall[] }

const isLocalNemotron = () => /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(settings.nemotronBaseUrl);

export function provider(): Provider {
  if (settings.azureKey) return 'azure';
  if (settings.nvidiaKey || isLocalNemotron()) return 'nemotron';
  return 'none';
}

/** Short name stored with briefings and shown in logs, e.g. "azure:gpt-chat-latest-2". */
export function modelLabel(): string {
  const p = provider();
  if (p === 'azure') return `azure:${settings.azureDeployment}`;
  if (p === 'nemotron') return settings.nemotronModel;
  return 'rules';
}

export class LlmError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

async function post(fetchFn: Fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new LlmError(`no answer within ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readReply(res: Response, who: string): Promise<ChatReply> {
  const data = (await res.json()) as { choices?: Array<{ message: ChatReply }> };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new LlmError(`${who} returned no choices`);
  return msg;
}

async function azureChat(fetchFn: Fetch, req: ChatRequest): Promise<ChatReply> {
  const url = `${settings.azureEndpoint}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json', Accept: 'application/json',
    Authorization: `Bearer ${settings.azureKey}`, 'api-key': settings.azureKey,
  };
  const body: Record<string, unknown> = { model: settings.azureDeployment, messages: req.messages, max_completion_tokens: req.maxTokens };
  if (req.tools) { body.tools = req.tools; body.tool_choice = 'auto'; }
  let res = await post(fetchFn, url, headers, body, settings.azureTimeoutMs);
  if (res.status === 400) {
    const txt = await res.text();
    if (/max_completion_tokens/.test(txt)) {          // older deployments only know max_tokens
      delete body.max_completion_tokens; body.max_tokens = req.maxTokens;
      res = await post(fetchFn, url, headers, body, settings.azureTimeoutMs);
    } else {
      throw new LlmError(`Azure HTTP 400: ${txt.slice(0, 300)}`, 400);
    }
  }
  if (!res.ok) throw new LlmError(`Azure HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  return readReply(res, 'Azure');
}

async function nemotronChat(fetchFn: Fetch, req: ChatRequest): Promise<ChatReply> {
  const body: Record<string, unknown> = {
    model: req.vision ? (settings.visionModel || settings.nemotronModel) : settings.nemotronModel,
    messages: req.messages,
    temperature: req.temperature ?? 0.4,
    top_p: 0.9,
    max_tokens: req.maxTokens,
  };
  if (req.tools) { body.tools = req.tools; body.tool_choice = 'auto'; }
  if (!settings.nemotronThinking && !isLocalNemotron()) body.chat_template_kwargs = { enable_thinking: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (settings.nvidiaKey) headers.Authorization = `Bearer ${settings.nvidiaKey}`;
  const res = await post(fetchFn, `${settings.nemotronBaseUrl}/chat/completions`, headers, body, settings.nemotronTimeoutMs);
  if (!res.ok) throw new LlmError(`Nemotron HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  return readReply(res, 'Nemotron');
}

/** One chat-completions call to whichever provider is configured. Throws LlmError on failure. */
export async function chatCompletion(fetchFn: Fetch, req: ChatRequest): Promise<ChatReply> {
  const p = provider();
  if (p === 'azure') return azureChat(fetchFn, req);
  if (p === 'nemotron') return nemotronChat(fetchFn, req);
  throw new LlmError('no AI provider configured');
}
