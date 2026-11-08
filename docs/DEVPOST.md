# Devpost submission

**Title:** Blink Blink Blink Tahur

**Tagline:** BlinkTalk lets people who can't speak talk, text and call for help with only their eyes. Two blinks to choose, three to switch it on or off, five to call for help.

## Inspiration
People with ALS, locked-in syndrome or a severe stroke often understand everything and can't say a word. Eye-tracking communication devices cost thousands of dollars and stop at the edge of the bedside screen. They can't text your mom, and they can't tell anyone you need help at 3am. We wanted eye movements to reach the people who matter.

## What it does
Three electrodes on the forehead pick up the eye's electrical signal (EOG). A model on a TI SK-AM62B board classifies each glance and blink on-device. Left and right move a highlight, two blinks select, three blinks switch BlinkTalk on or off so the patient can rest their eyes, and five blinks call for help. Four blinks do nothing, so switching on or off can never be mistaken for an SOS.

- **Speak:** spell or pick phrases; the laptop speaks them aloud.
- **Text:** BlinkTalk gives the patient an iMessage line through **Photon**. When someone texts, an **NVIDIA Nemotron** agent reads the conversation and the patient's live state, decides whether caregivers need to know, and puts four replies on screen in the patient's voice. One double blink sends a reply.
- **Say a lot with a little:** spell two keywords ("alex pho") and choose *AI expand*. Nemotron checks the contacts, works out who each message is for, and offers finished messages already addressed ("to Alex: Can you bring pho tonight?"). Or spell your own message, choose *Text it*, and pick the person.
- **Proof it helps:** the dashboard counts the eye movements Nemotron saved. It simulates what spelling each message would have cost on the same keyboard, so every AI-drafted message is measured, not guessed.
- **Get help:** five blinks text tier-1 caregivers. If nobody answers "OK" within 45 seconds, a scheduled **SpacetimeDB** reducer escalates to the next tier. When someone acknowledges, the patient's screen says help is on the way.
- **A screen made for eyes:** one choice in focus at the centre of a ribbon, the message being answered on top, the patient's words in large type, and a night palette for long sessions.
- **Be there remotely:** the caregiver dashboard shows the patient's words appearing letter by letter, their eye movements, heart rate (PPG), the conversation, alerts and every step the AI agent took.

## How we built it
- **SpacetimeDB is the backend.** A single TypeScript module holds all state and rules: 11 tables, 21 reducers and a scheduled escalation reducer. That covers heart-rate alert logic, phrase learning, conversation routing, pruning and acknowledgement. The Python speller calls reducers over HTTP, while the hub and the React dashboard use live WebSocket subscriptions. It runs locally for an offline home setup or on Maincloud for remote family.
- **Photon 2.0** bridges iMessage: inbound texts become rows, queued outbound rows are delivered in the same chat, and SOS alerts go out tier by tier. Replying "OK" acknowledges an alert.
- **Nemotron** is used as a keyboard accelerator, not a chatbot. It runs as a tool-calling agent: `get_conversation`, `get_patient_state`, `list_contacts`, `alert_caregivers`, then `propose_replies` or `propose_messages` (messages addressed to people). Each step is logged to SpacetimeDB and shown on the dashboard. It runs on build.nvidia.com, or fully offline on `nemotron-3-nano` through Ollama. It falls back to JSON mode, then to built-in replies, so the patient is never left with nothing to say.
- **Hardware:** a TI AFE4950EVM reads the EOG and PPG signals. A per-user scikit-learn model trains on the SK-AM62B in under 2 seconds and runs in about 90 ms per eye movement.

## Challenges
- Making replies short enough to be worth a glance, yet distinct enough to be useful.
- Escalation that survives a crashed client. Timers live in the database as a scheduled table, not in a browser tab.
- Shared iMessage lines can only reply to people who texted first, so the hub remembers each caregiver's chat and warns about anyone who hasn't said hi yet.

## Accomplishments
A full loop from eye to iMessage to caregiver and back, 54 automated checks (unit tests plus an end-to-end run against a live SpacetimeDB server), and a dashboard a parent could understand at 3am without instructions.

## What we learned
When the database is the backend, the clients get simple: the speller talks to it through a 140-line HTTP client, and the dashboard has no API layer at all.

## What's next
Voice calls on Photon's voice line, so the agent can speak the patient's replies on a real phone call. Also more users and repeat sessions for the eye model, and a clinician pilot.

## Built with
spacetimedb, typescript, photon, nvidia-nemotron, ollama, react, vite, python, tkinter, scikit-learn, texas-instruments, am62, afe4950
