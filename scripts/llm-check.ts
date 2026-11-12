/**
 * Live check of the hub's AI model (Azure AI Foundry when AZURE_OPENAI_API_KEY is set).
 *   npm run llm-check
 * Prints how long each call takes and whether text, tool calling and photos work.
 */
import { settings, redact } from '../hub/src/env.ts';
import { chatCompletion, provider, modelLabel } from '../hub/src/llm.ts';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function step(name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`OK   ${name.padEnd(14)} ${String(Date.now() - t0).padStart(5)} ms  ${out.replace(/\s+/g, ' ').slice(0, 90)}`);
    return true;
  } catch (err) {
    console.log(`FAIL ${name.padEnd(14)} ${String(Date.now() - t0).padStart(5)} ms  ${String((err as Error).message ?? err).slice(0, 300)}`);
    return false;
  }
}

async function main() {
  console.log(`provider=${provider()} model=${modelLabel()}`);
  if (provider() === 'azure') console.log(`endpoint=${settings.azureEndpoint} key=${redact(settings.azureKey)}`);

  let ok = true;
  ok = (await step('text', async () => (await chatCompletion(fetch, {
    messages: [{ role: 'user', content: 'Reply with exactly: BlinkTalk ready' }], maxTokens: 20,
  })).content ?? '(empty)')) && ok;

  ok = (await step('tool call', async () => {
    const r = await chatCompletion(fetch, {
      maxTokens: 200,
      messages: [{ role: 'user', content: 'Give 4 short replies to "Are you awake?" by calling propose_replies.' }],
      tools: [{ type: 'function', function: { name: 'propose_replies', description: 'Return 4 replies',
        parameters: { type: 'object', properties: { replies: { type: 'array', items: { type: 'string' } } }, required: ['replies'] } } }],
    });
    const call = r.tool_calls?.[0];
    if (!call) throw new Error(`no tool call (text instead: ${r.content ?? ''})`);
    return `${call.function.name} ${call.function.arguments}`;
  })) && ok;

  ok = (await step('photo', async () => (await chatCompletion(fetch, {
    vision: true, maxTokens: 60,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'What colour is this image? One word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PIXEL}` } },
    ] }],
  })).content ?? '(empty)')) && ok;

  if (provider() === 'azure') {
    await step('responses API', async () => {
      const res = await fetch(`${settings.azureEndpoint}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.azureKey}` },
        body: JSON.stringify({ model: settings.azureDeployment, input: 'What is the capital of France? One word.' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
      return j.output_text ?? j.output?.flatMap(o => o.content ?? []).map(c => c.text ?? '').join(' ') ?? '(no text)';
    });
  }
  console.log(ok ? '\nAll hub AI features work with this model.' : '\nSomething failed: see the FAIL line(s) above.');
  process.exit(ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
