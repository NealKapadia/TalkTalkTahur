/**
 * Photon (Spectrum) bridge: puts the patient on iMessage.
 *
 * Inbound texts to the patient's Photon line are handed to SpacetimeDB; texts
 * the patient composes with their eyes are delivered from the same line. With
 * no Photon credentials the bridge runs in simulated mode: outbound texts are
 * printed and marked sent, and inbound texts come from the dashboard's
 * "simulate incoming text" box.
 */
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { settings } from './env.ts';

export interface InboundText {
  address: string;   // E.164 or email handle of whoever wrote
  body: string;
  channel: string;
}

export interface Messenger {
  live: boolean;
  send(address: string, body: string): Promise<void>;
}

export async function startPhoton(onText: (t: InboundText) => Promise<void>): Promise<Messenger> {
  if (!settings.photonProjectId || !settings.photonProjectSecret) {
    console.log('[photon] PHOTON_PROJECT_ID/SECRET not set: simulated messaging (texts print here).');
    return {
      live: false,
      async send(address, body) {
        console.log(`[photon:sim] -> ${address}: ${body}`);
      },
    };
  }

  const app = await Spectrum({
    projectId: settings.photonProjectId,
    projectSecret: settings.photonProjectSecret,
    providers: [imessage.config()],
  });
  const im = imessage(app);
  // Reply in the same chat a person wrote from (works for group chats too).
  const spaces = new Map<string, Awaited<ReturnType<typeof im.space.create>>>();

  (async () => {
    for await (const [space, message] of app.messages) {
      try {
        if (message.direction !== 'inbound') continue;
        if (message.content.type !== 'text') continue;
        const address = message.sender?.id;
        if (!address) continue;
        spaces.set(address, space as any);
        await onText({ address, body: message.content.text, channel: 'imessage' });
      } catch (err) {
        console.error('[photon] inbound handling failed', err);
      }
    }
  })().catch(err => console.error('[photon] message stream ended', err));

  console.log('[photon] live on iMessage');
  return {
    live: true,
    async send(address, body) {
      let space = spaces.get(address);
      if (!space) {
        space = await im.space.create(address);
        spaces.set(address, space);
      }
      await space.send(body);
    },
  };
}
