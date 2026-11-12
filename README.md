# BlinkTalk

**Talk, text and call for help with your eyes.** Two blinks to choose, three to switch it on or off, five to call for help.

People with ALS, locked-in syndrome or a severe stroke often understand everything and can say nothing. BlinkTalk reads eye movements from three electrodes on the face and turns glances and blinks into speech, iMessages and SOS alerts. Family can see what their person is saying, live, from anywhere.

Built by Neal Kapadia.

```
 electrodes ─► TI AFE4950EVM ─► SK-AM62B (on-device C model: blink / left / right)
                                   │ serial
                                   ▼
                     Python bridge (laptop) ──HTTP──┐
                                                    ▼
 iMessage ◄─► Photon ◄─► Hub ◄──WebSocket──► SpacetimeDB module ◄──WebSocket──► Patient screen (browser)
                          │                  (all state + rules)  ◄──WebSocket──► Caregiver dashboard
                          └─► AI model (Azure AI Foundry; Nemotron / Gemini as fallbacks)
```

## What it does

1. **The patient glances and blinks.** The SK-AM62B classifies each eye movement on the device, offline. Left/right moves the highlight, two blinks select, three blinks switch BlinkTalk on or off (so the patient can rest their eyes) and five blinks are SOS. Single blinks and groups of four are ignored.
2. **Every letter is live.** The bridge streams the patient's draft, eye movements and heart rate into SpacetimeDB. The caregiver dashboard shows the words appearing as they're chosen.
3. **Someone texts the patient.** Photon delivers the iMessage into SpacetimeDB and the AI agent:
   - reads the conversation and the patient's live state (heart rate, time, favourite phrases)
   - decides whether caregivers need to know
   - puts four replies, written in the patient's voice, on their screen

   One double blink sends a reply back over iMessage. The patient can also spell a few keywords ("alex pho") and pick **AI expand** to get ready-to-send messages already addressed to the right person ("to Alex: Can you bring pho tonight?"). To text anyone directly, the patient spells a message, picks **Text it**, and chooses the person.
4. **The patient blinks five times.** SpacetimeDB raises an SOS and Photon texts tier-1 caregivers. If nobody replies "OK" within 45 s, a scheduled reducer escalates to tier 2, then tier 3. When someone replies "OK" (or taps *I'm on it* on the dashboard), the patient's screen says help is coming.
5. **Family catches up.** On the dashboard, **Catch me up** writes a short handoff note from the last 3–24 hours: conversations, alerts and how fast they were answered, and heart rate.

## How it's built

| Part | What it does |
|---|---|
| **Eye-command model** (`edge/eog_c/`) | A 50-tree random forest in plain C (about 120 KB, no dependencies) on the SK-AM62B's Cortex-A53 cores. Bandpass filter, adaptive slope detector, 72 shape features per eye movement (including the small opposite spike that comes before a look), then a blink counter for select / on-off / SOS. **94% of commands recognised on held-out recordings, 91% on random cued sequences**, about 0.5 false events per minute at rest. Looks are reported about 0.9 s after the movement. |
| **Board pipeline** (`edge/blinktalk_live.py`, `edge/afe_stream.py`) | Configures the AFE4950EVM over USB, streams the eye signal (500 Hz) and PPG (50 Hz), runs the model and heart rate, and prints `BLINKTALK CMD ...` lines over the serial console. Per-person calibrated models (scikit-learn) are still supported. |
| **SpacetimeDB** (`spacetime/src/index.ts`) | The whole backend in one module: tables, reducers and a scheduled SOS-escalation reducer. It handles validation, heart-rate alert rules, phrase learning, conversation routing and acknowledgements. The bridge, hub and screens are thin clients with live subscriptions. Runs locally (`spacetime start`) or on Maincloud for remote family. |
| **Photon** (`hub/src/photon.ts`) | Gives the patient a real iMessage line. People text them like anyone else, they answer with their eyes, and caregivers get SOS alerts in the chat app they already use. Replying "OK" acknowledges an alert. |
| **AI agent** (`hub/src/agent.ts`, `hub/src/llm.ts`) | A tool-calling agent (`get_conversation`, `get_patient_state`, `list_contacts`, `alert_caregivers`, `propose_replies`, `propose_messages`) that drafts replies and expands keywords, and describes photos people text. It never speaks for the patient: nothing is sent without their own selection. Runs on GPT (`gpt-chat-latest-2`) on Azure AI Foundry when `AZURE_OPENAI_API_KEY` is set; otherwise NVIDIA Nemotron (hosted, or offline through Ollama). Falls back to built-in replies if no model is reachable. |
| **Briefings** (`hub/src/briefing.ts`) | "Catch me up" notes, written by the same Azure model (Google Gemini if only its key is set; a plain summary with no key). Only first names and the patient's own words are sent. |
| **Screens** (`dashboard/`) | React + Vite: the eyes-only patient screen and the caregiver dashboard. |

## Run it (Windows)

Prerequisites: Node 22+, Python 3.10+, the SpacetimeDB CLI.

```powershell
# 1. SpacetimeDB CLI (once)
iwr https://windows.spacetimedb.com -useb | iex

# 2. JS dependencies (repo root, npm workspaces)
npm install

# 3. Secrets: copy .env.example to .env, then fill in AZURE_OPENAI_API_KEY and the Photon keys
copy .env.example .env
npm run llm-check             # checks the AI model: text, tool calls, photos

# 4. Backend (terminal 1, leave running)
spacetime start
# (terminal 2, once per fresh database)
cd spacetime ; spacetime publish --server local -y blinktalk ; cd ..

# 5. Optional smoke tests
npm run e2e                   # plays bridge + hub + dashboard against the server, ~20 s
npm run photon-check          # confirms the Photon key and line

# 6. Hub: Photon bridge + AI agent (terminal 2)
npm run hub

# 7. Screens (terminal 3)
npm run dashboard
#    Patient screen (full screen it, F11):  http://localhost:5173/?view=patient
#    Caregiver dashboard:                   http://localhost:5173
#    Keyboard stands in for the eyes on the patient screen: arrows / Space / S

# 8. With the SK-AM62B board (terminal 4): forwards eye movements + heart rate
pip install pyserial
python speller/speller.py --serial COM12 --bridge
#    (without --bridge, the older Tk speller runs as its own patient screen)
```

Setting up the SK-AM62B and AFE4950EVM, step by step: **[docs/AM62B_SETUP.md](docs/AM62B_SETUP.md)**. Signal processing, calibration and the recording protocol: [docs/HARDWARE.md](docs/HARDWARE.md).

No backend handy? `http://localhost:5173/?demo` (caregiver) and `http://localhost:5173/?view=patient&demo` (patient) run on built-in sample data.

### Photon setup (app.beta.photon.codes)

1. **API keys:** create a key with `project:read` and `project:write`. Put it in `.env` as `PHOTON_API_KEY`, and the project id (`pho_prj_…`) as `PHOTON_PROJECT_ID`.
2. **iMessage, then Add someone to the line:** add the iPhone number of every person who should text the patient or get their SOS alerts, and assign each one a number from the shared pool. That number is the patient's BlinkTalk line.
3. **Each person texts that line once** (e.g. "hi"). A shared line can only reply to people who texted it first. The hub remembers each chat in `hub/.photon-routes.json`.
4. Add the same people in the dashboard's **Care circle** with a tier, so SOS alerts reach them in order.
5. Check it: `npm run photon-check` confirms the key works and lists recent texts to the line.

### Offline AI (optional)

With no `AZURE_OPENAI_API_KEY`, the hub can use a local Nemotron through Ollama:
```powershell
ollama pull nemotron-3-nano        # ~24 GB. Smaller machine: nemotron-3-nano:4b (~3 GB)
```
In `.env`: `NEMOTRON_BASE_URL=http://localhost:11434/v1` and `NEMOTRON_MODEL=nemotron-3-nano`. With local SpacetimeDB and the on-board eye model, only the messaging needs the internet.

### Always-on cloud box (Maritime or any container host)

`deploy/Dockerfile` runs the hub and serves the dashboard + patient screen on port 8080, against SpacetimeDB on Maincloud. Family get a public link, and the laptop only has to run the board bridge.

```powershell
pip install maritime
cd spacetime ; spacetime publish --server maincloud -y blinktalk-neal ; cd ..   # once
python scripts/maritime_deploy.py up       # deploys the current commit, prints the public links
python scripts/maritime_deploy.py status   # links + recent logs
python scripts/maritime_deploy.py down     # stop it
```
It reads the keys from `.env`; only committed files are uploaded (never `.env`). Run the board bridge on the laptop with `--spacetime https://maincloud.spacetimedb.com --db blinktalk-neal`. Run only one hub at a time (laptop *or* cloud), so each text is answered once.

### SpacetimeDB on Maincloud (remote caregivers)

```powershell
spacetime login
cd spacetime ; spacetime publish --server maincloud -y blinktalk-neal ; cd ..
```
Then set `SPACETIME_URI=wss://maincloud.spacetimedb.com` and `SPACETIME_DB=blinktalk-neal` in `.env`, run `python speller/speller.py --spacetime https://maincloud.spacetimedb.com --db blinktalk-neal`, and open the dashboard with `?uri=wss://maincloud.spacetimedb.com&db=blinktalk-neal`.

Secrets live only in `.env` (gitignored). `npm run check-secrets` scans tracked files, and `node scripts/install-hooks.mjs` makes that check a pre-commit hook.

## Tests

```bash
npm test -w spacetime        # 9 reducer tests on SpacetimeDB's in-process datastore
npm test -w hub              # 25 tests: Azure provider (tools, photos, briefings, fallbacks), agent tool loop, recipient routing, Photon polling
npm test -w dashboard        # 7 patient-screen tests: speller, recipient picker, spelling-cost model
python edge/test_gestures.py # blink gestures: 2 choose, 3 on/off, 5 SOS
python speller/test_cloud.py # 5 bridge <-> SpacetimeDB HTTP tests
npm run e2e                  # 20 end-to-end checks against a running server (E2E_ESCALATION=1 adds the 45 s escalation)
npm run llm-check            # live check of the AI model
```

## Repository

| Path | |
|---|---|
| `spacetime/` | SpacetimeDB module: the backend (TypeScript) |
| `bindings/` | Typed client bindings (same shape as `spacetime generate`) |
| `hub/` | Photon iMessage bridge, AI agent (`llm.ts` picks Azure / Nemotron), briefings, caregiver alert texting |
| `dashboard/` | Caregiver console and patient screen (React + SpacetimeDB live subscription) |
| `speller/` | Python board bridge + original Tk speller; `cloud.py` talks to SpacetimeDB |
| `edge/` | Board software: AFE4950 streaming, live pipeline, the C eye-command model (`eog_c/`), calibration |
| `board/` | Offline Python package installer for the SK-AM62B |
| `deploy/` | Container for an always-on hub + public dashboard |
| `scripts/` | End-to-end test, Photon and AI checks, secret scanner |
| `docs/` | `AM62B_SETUP.md` (step-by-step board setup), `HARDWARE.md` (signal processing and calibration) |

## Limits and safety

BlinkTalk is a research prototype, not a medical device. The eye-command model was trained and tested on one person; other people should be checked (and calibrated) before relying on it. Heart rate comes from a fingertip PPG sensor. SOS escalation depends on the laptop, network and Photon being up, so it does not replace a nurse-call system. The AI only drafts; nothing is sent without the patient's own selection, except caregiver alerts.
