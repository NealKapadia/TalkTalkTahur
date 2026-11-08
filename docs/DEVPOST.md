# Devpost submission: BlinkTalk

**Tagline:** Talk, text and call for help with only your eyes.

## Inspiration
People with ALS, locked-in syndrome or a severe stroke often understand everything and can't say a word. Eye-tracking communication devices cost thousands of dollars and stop at the edge of the bedside screen. They can't text your mom, and they can't tell anyone you need help at 3am. We wanted eye movements to reach the people who matter.

## What it does
Three electrodes on the forehead pick up the eye's electrical signal (EOG). A model on a TI SK-AM62B board classifies each glance and blink on-device. Left and right move a highlight, a double blink selects and a triple blink is SOS.

- **Speak:** spell or pick phrases; the laptop speaks them aloud.
- **Text:** BlinkTalk has its own iMessage number through **Photon**. When someone texts, an **NVIDIA Nemotron** agent reads the conversation and the patient's live state, screens the text for scams and puts four replies, written in the patient's voice, on screen. One double blink sends a reply. Spelling two keywords and choosing *AI expand* turns them into full sentences.
- **Stay safe:** scam texts (fake Medicare, gift cards, "grandson in jail") are flagged, the patient only gets protective replies, and family is told.
- **Get help:** a triple blink texts tier-1 caregivers. If nobody answers "OK" within 45 seconds, a scheduled **SpacetimeDB** reducer escalates to the next tier. When someone acknowledges, the patient's screen says help is on the way.
- **Be there remotely:** the caregiver dashboard shows the patient's words appearing letter by letter, their eye movements, heart rate (PPG), the conversation, alerts and every step the AI agent took.

## How we built it
- **SpacetimeDB is the backend.** A single TypeScript module holds all state and rules: 11 tables, 22 reducers and a scheduled escalation reducer. That covers heart-rate alert logic, phrase learning, conversation routing, pruning and acknowledgement. The Python speller calls reducers over HTTP, while the hub and the React dashboard use live WebSocket subscriptions. It runs locally for an offline home setup or on Maincloud for remote family.
- **Photon (spectrum-ts)** bridges iMessage: inbound texts become rows; queued outbound rows are delivered, and caregiver alerts go out tier by tier. Replying "OK" acknowledges an alert.
- **Nemotron** (`nemotron-3.5-super` on build.nvidia.com) runs as a tool-calling agent: `get_conversation`, `get_patient_state`, `screen_message`, `alert_caregivers`, `propose_replies`. Each step is logged to SpacetimeDB and shown on the dashboard. It falls back to JSON mode, then to on-device rules, so the patient is never left without replies.
- **Hardware (built before HackUTD):** TI AFE4950EVM for the EOG and PPG signals, a per-user scikit-learn model trained on the SK-AM62B in under 2 seconds, and about 90 ms of on-device inference per eye movement.

## Challenges
- Making replies short enough to be worth a glance, yet distinct enough to be useful.
- Making sure a confident language model can't override a scam rule: the rule-based screen sets a minimum risk level the model can't lower.
- Escalation that survives a crashed client. Timers live in the database as a scheduled table, not in a browser tab.

## Accomplishments
A full loop from eye to iMessage to caregiver and back, 19 automated tests across the module, the agent and the speller, and a dashboard a parent could understand at 3am without instructions.

## What we learned
When the database is the backend, the clients get simple: the speller talks to it through a sub-200-line HTTP client, and the dashboard has no API layer at all.

## What's next
Voice calls through Photon's SIP voice line, so the agent can speak the patient's replies on a real phone call. Also more users and repeat sessions for the eye model, and a clinician pilot.

## Built with
spacetimedb, typescript, photon, spectrum-ts, nvidia-nemotron, react, vite, python, tkinter, scikit-learn, texas-instruments, am62, afe4950

## Note for judges
The EOG hardware pipeline (`edge/`, `board/`, the original speller) existed before HackUTD. The SpacetimeDB backend, the Photon bridge, the Nemotron agent, the caregiver dashboard and the speller's messaging and SOS loop were built at HackUTD; the git history shows the split.
