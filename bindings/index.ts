// Client bindings for the BlinkTalk SpacetimeDB module (spacetime/src/index.ts).
//
// Hand-written in the same shape `spacetime generate --lang typescript` produces,
// so the hub and dashboard build without the CLI. If you change the module,
// regenerate instead:
//   spacetime generate --lang typescript --out-dir bindings --module-path spacetime
// (then run `npm run sync-bindings` in hub/ and dashboard/).

/* eslint-disable */
import {
  DbConnectionBuilder as __DbConnectionBuilder,
  DbConnectionImpl as __DbConnectionImpl,
  SubscriptionBuilderImpl as __SubscriptionBuilderImpl,
  convertToAccessorMap as __convertToAccessorMap,
  makeQueryBuilder as __makeQueryBuilder,
  procedures as __procedures,
  reducerSchema as __reducerSchema,
  reducers as __reducers,
  schema as __schema,
  t as __t,
  table as __table,
  type DbConnectionConfig as __DbConnectionConfig,
  type ErrorContextInterface as __ErrorContextInterface,
  type EventContextInterface as __EventContextInterface,
  type Infer as __Infer,
  type QueryBuilder as __QueryBuilder,
  type ReducerEventContextInterface as __ReducerEventContextInterface,
  type RemoteModule as __RemoteModule,
  type SubscriptionEventContextInterface as __SubscriptionEventContextInterface,
  type SubscriptionHandleImpl as __SubscriptionHandleImpl,
} from 'spacetimedb';

// ---------------------------------------------------------------- row types
const PatientRow = __t.row({
  handle: __t.string().primaryKey(),
  display_name: __t.string(),
  status: __t.string(),
  draft: __t.string(),
  last_spoken: __t.string(),
  heart_bpm: __t.u16(),
  heart_quality: __t.f32(),
  heart_out_of_range: __t.u16(),
  last_seen: __t.timestamp(),
});
const ContactRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  name: __t.string(),
  address: __t.string(),
  relation: __t.string(),
  tier: __t.u8(),
});
const MessageRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  contact_id: __t.u64(),
  direction: __t.string(),
  channel: __t.string(),
  body: __t.string(),
  status: __t.string(),
  risk: __t.string(),
  risk_reason: __t.string(),
  created_at: __t.timestamp(),
});
const SuggestionRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  message_id: __t.u64(),
  contact_id: __t.u64(),
  text: __t.string(),
  rank: __t.u8(),
  source: __t.string(),
  created_at: __t.timestamp(),
});
const IntentRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  contact_id: __t.u64(),
  keywords: __t.string(),
  status: __t.string(),
  created_at: __t.timestamp(),
});
const AlertRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  kind: __t.string(),
  detail: __t.string(),
  level: __t.u8(),
  notified_level: __t.u8(),
  acked_by: __t.string(),
  created_at: __t.timestamp(),
  acked_at: __t.option(__t.timestamp()),
});
const EyeEventRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  command: __t.string(),
  at: __t.timestamp(),
});
const HeartSampleRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  bpm: __t.u16(),
  quality: __t.f32(),
  at: __t.timestamp(),
});
const PhraseRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  text: __t.string(),
  uses: __t.u32(),
  last_used: __t.timestamp(),
});
const AgentStepRow = __t.row({
  id: __t.u64().primaryKey(),
  patient: __t.string(),
  run_id: __t.string(),
  step: __t.string(),
  detail: __t.string(),
  at: __t.timestamp(),
});

export type Patient = __Infer<typeof PatientRow>;
export type Contact = __Infer<typeof ContactRow>;
export type Message = __Infer<typeof MessageRow>;
export type Suggestion = __Infer<typeof SuggestionRow>;
export type Intent = __Infer<typeof IntentRow>;
export type Alert = __Infer<typeof AlertRow>;
export type EyeEvent = __Infer<typeof EyeEventRow>;
export type HeartSample = __Infer<typeof HeartSampleRow>;
export type Phrase = __Infer<typeof PhraseRow>;
export type AgentStep = __Infer<typeof AgentStepRow>;

// ---------------------------------------------------------------- tables
const tablesSchema = __schema({
  patient: __table({ name: 'patient' }, PatientRow),
  contact: __table({ name: 'contact' }, ContactRow),
  message: __table({ name: 'message' }, MessageRow),
  suggestion: __table({ name: 'suggestion' }, SuggestionRow),
  intent: __table({ name: 'intent' }, IntentRow),
  alert: __table({ name: 'alert' }, AlertRow),
  eye_event: __table({ name: 'eye_event' }, EyeEventRow),
  heart_sample: __table({ name: 'heart_sample' }, HeartSampleRow),
  phrase: __table({ name: 'phrase' }, PhraseRow),
  agent_step: __table({ name: 'agent_step' }, AgentStepRow),
});

// ---------------------------------------------------------------- reducers
const reducersSchema = __reducers(
  __reducerSchema('register_patient', { handle: __t.string(), display_name: __t.string() }),
  __reducerSchema('add_contact', { patient: __t.string(), name: __t.string(), address: __t.string(), relation: __t.string(), tier: __t.u8() }),
  __reducerSchema('remove_contact', { id: __t.u64() }),
  __reducerSchema('eye_command', { patient: __t.string(), command: __t.string() }),
  __reducerSchema('set_draft', { patient: __t.string(), draft: __t.string() }),
  __reducerSchema('heartbeat', { patient: __t.string(), bpm: __t.u16(), quality: __t.f32() }),
  __reducerSchema('speak', { patient: __t.string(), text: __t.string() }),
  __reducerSchema('send_message', { patient: __t.string(), contact_id: __t.u64(), body: __t.string() }),
  __reducerSchema('reply_latest', { patient: __t.string(), body: __t.string() }),
  __reducerSchema('receive_message', { patient: __t.string(), address: __t.string(), sender_name: __t.string(), channel: __t.string(), body: __t.string() }),
  __reducerSchema('mark_message', { id: __t.u64(), status: __t.string() }),
  __reducerSchema('add_suggestions', { patient: __t.string(), message_id: __t.u64(), contact_id: __t.u64(), texts: __t.array(__t.string()), source: __t.string() }),
  __reducerSchema('request_intent', { patient: __t.string(), keywords: __t.string() }),
  __reducerSchema('finish_intent', { id: __t.u64() }),
  __reducerSchema('flag_message', { id: __t.u64(), risk: __t.string(), reason: __t.string() }),
  __reducerSchema('log_agent_step', { patient: __t.string(), run_id: __t.string(), step: __t.string(), detail: __t.string() }),
  __reducerSchema('raise_sos', { patient: __t.string(), detail: __t.string() }),
  __reducerSchema('ack_alert', { id: __t.u64(), by: __t.string() }),
  __reducerSchema('ack_alert_by_reply', { patient: __t.string(), address: __t.string() }),
  __reducerSchema('mark_alert_notified', { id: __t.u64(), level: __t.u8() }),
  __reducerSchema('cancel_sos', { patient: __t.string() }),
  __reducerSchema('clear_demo', { patient: __t.string() }),
);

const proceduresSchema = __procedures();

const REMOTE_MODULE = {
  versionInfo: { cliVersion: '2.14.1' as const },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
  ...proceduresSchema,
} satisfies __RemoteModule<
  typeof tablesSchema.schemaType,
  typeof reducersSchema.reducersType,
  typeof proceduresSchema
>;

export const tables: __QueryBuilder<typeof tablesSchema.schemaType> =
  __makeQueryBuilder(tablesSchema.schemaType);
export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);

export type EventContext = __EventContextInterface<typeof REMOTE_MODULE>;
export type ReducerEventContext = __ReducerEventContextInterface<typeof REMOTE_MODULE>;
export type SubscriptionEventContext = __SubscriptionEventContextInterface<typeof REMOTE_MODULE>;
export type ErrorContext = __ErrorContextInterface<typeof REMOTE_MODULE>;
export type SubscriptionHandle = __SubscriptionHandleImpl<typeof REMOTE_MODULE>;

export class SubscriptionBuilder extends __SubscriptionBuilderImpl<typeof REMOTE_MODULE> {}
export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}
export class DbConnection extends __DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder = (): DbConnectionBuilder =>
    new DbConnectionBuilder(
      REMOTE_MODULE,
      (config: __DbConnectionConfig<typeof REMOTE_MODULE>) => new DbConnection(config)
    );
  override subscriptionBuilder = (): SubscriptionBuilder => new SubscriptionBuilder(this);
}
