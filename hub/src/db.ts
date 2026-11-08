/** One SpacetimeDB connection shared by the Photon bridge and the agent. */
import { DbConnection, tables, type Contact, type Message } from '../../bindings/index.ts';
import { settings } from './env.ts';

export type Conn = DbConnection;

export function connect(): Promise<Conn> {
  return new Promise((resolve, reject) => {
    let settled = false;
    DbConnection.builder()
      .withUri(settings.spacetimeUri)
      .withDatabaseName(settings.spacetimeDb)
      .withAutomaticReconnect()
      .onConnect(conn => {
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            if (!settled) { settled = true; resolve(conn); }
          })
          .onError(ctx => console.error('[db] subscription error', (ctx as { event?: unknown }).event))
          .subscribe([
            tables.patient, tables.contact, tables.message, tables.suggestion, tables.intent,
            tables.alert, tables.heart_sample, tables.phrase, tables.briefing, tables.eye_event,
          ]);
      })
      .onConnectError((_ctx, err) => {
        if (!settled) { settled = true; reject(err); }
      })
      .onDisconnect(() => console.warn('[db] disconnected; reconnecting'))
      .build();
  });
}

// ---------------------------------------------------------------- read helpers
export function contactById(conn: Conn, id: bigint): Contact | undefined {
  return conn.db.contact.id.find(id) ?? undefined;
}

export function contactsOf(conn: Conn, patient: string): Contact[] {
  return [...conn.db.contact.iter()].filter(c => c.patient === patient);
}

export function conversation(conn: Conn, patient: string, contactId: bigint, limit = 12): Message[] {
  return [...conn.db.message.iter()]
    .filter(m => m.patient === patient && (m.contact_id === contactId || (m.channel === 'speech')))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(-limit);
}

export function topPhrases(conn: Conn, patient: string, n = 8): string[] {
  return [...conn.db.phrase.iter()]
    .filter(p => p.patient === patient)
    .sort((a, b) => b.uses - a.uses)
    .slice(0, n)
    .map(p => p.text);
}

export function recentHeart(conn: Conn, patient: string, n = 30): number[] {
  return [...conn.db.heart_sample.iter()]
    .filter(h => h.patient === patient && h.quality >= 0.5)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(-n)
    .map(h => h.bpm);
}
