# BlinkTalk handoff: read this first

Context for any coding agent (Cursor, Claude Code, Windsurf…) picking up this repo. Written Sunday 8 Nov 2026, ~3am CT, during HackUTD 2026: Zero Day. **Submissions are due at 12:00pm CT on Sunday 8 Nov 2026**; judging runs 1–4pm.

## The project in one paragraph

**Blink Blink Blink Tahur** (product name **BlinkTalk**) lets people who can't speak or move (ALS, locked-in syndrome, severe stroke) talk, text and call for help with only their eyes. Three forehead electrodes feed a **TI AFE4950EVM**. A per-user scikit-learn model on a **TI SK-AM62B** classifies eye movements on-device: left/right glances move a highlight, **2 blinks = choose, 3 blinks = switch BlinkTalk on/off (rest mode), 5 blinks = SOS** (4 is deliberately unused). The patient uses a full-screen browser "patient screen". Family use a caregiver dashboard. Texts arrive and leave over real iMessage through **Photon**. An **NVIDIA Nemotron** agent drafts replies, routes keyword messages to the right person and describes photos. All state and rules live in a **SpacetimeDB** module.

## Hackathon tracks entered (max 3 company tracks)

1. **Spacetime: "Build on Spacetime"**: the majority of the backend must be SpacetimeDB, with a public GitHub repo.
2. **Photon: Best Use of Photon API**: the project must be live on a Photon channel (iMessage).
3. **NVIDIA: "Use Nemotron Beyond a Chatbot"**: multi-step agents, tool use, real-world use.

The scam-detection feature (built for T-Mobile) was **removed on purpose**. Don't re-add it.

## Architecture

```
electrodes ─► AFE4950EVM ─► SK-AM62B (edge ML) ─serial─► Python bridge (speller/speller.py --bridge) ─HTTP─┐
                                                                                                         ▼
iMessage ◄─► Photon API ◄─► hub (Node) ◄─WebSocket─► SpacetimeDB module "blinktalk" ◄─WebSocket─► patient screen (/?view=patient)
                              │                       (all state + rules)             ◄─WebSocket─► caregiver dashboard (/)
                              └─► Nemotron (NVIDIA API or local Ollama)
```

| Path | What |
|---|---|
| `spacetime/src/index.ts` | **The backend.** SpacetimeDB 2.14.1 TypeScript module: 11 tables (patient, contact, message, suggestion, intent, alert, eye_event, heart_sample, phrase, agent_step, sos_timer), ~23 reducers, scheduled `escalate_sos` (45 s per tier, max 3). Snake_case names everywhere. |
| `bindings/index.ts` | Hand-written client bindings in `spacetime generate` shape. **Update it whenever the module schema or reducers change** (or regenerate: `spacetime generate --lang typescript --out-dir bindings --module-path spacetime`). |
| `hub/src/main.ts` | Wires SpacetimeDB to Photon and the agent: inbound texts → `receive_message`; queued outbound → Photon → `mark_message`; alerts → texts caregivers tier by tier; caregiver replies "OK" → `ack_alert_by_reply`. |
| `hub/src/photon.ts` | Photon **2.0 beta HTTP API** (`https://api.photon.codes`, `Authorization: Bearer <PHOTON_API_KEY>`). Polls `GET /v1/projects/{id}/messages?direction=received&order=asc&orderBy=created_at&createdSince=…` and replies with `POST /v1/projects/{id}/messages` (`spaceId`, `senderId`, `content:{type:'text',format:'plain',text}`, `idempotency-key` header). Downloads photos from `/attachments/{id}/content`. **Shared-line rule:** the line can only text people who are assigned to it and texted it first; routes are saved in `hub/.photon-routes.json`. Not the stable `spectrum-ts` SDK, which is for non-beta projects. |
| `hub/src/agent.ts` | Nemotron agent (OpenAI-compatible `/chat/completions` with tools): `get_conversation`, `get_patient_state`, `list_contacts`, `alert_caregivers`, `propose_replies`, `propose_messages` (keyword intents → messages addressed to contacts). `describeImage()` = Nemotron VL photo description (`[Photo: …]` tag in the message body). Falls back to JSON mode on 4xx tool errors, then to built-in replies. |
| `dashboard/` | Vite + React. `src/PatientScreen.tsx` (endless ribbon, one lit choice, rest + SOS screens, recipient picker), `src/speller.ts` (pure speller logic + `spellCost()` used for "eye movements saved"), `src/App.tsx` (caregiver dashboard), `src/EyeTrace.tsx` (EOG-style live eye trace: the signature visual), `src/data.ts` (SpacetimeDB subscription + `?demo` scripted data). |
| `speller/speller.py` | Tk app. With `--serial COM12 --bridge` it only forwards board commands and heart rate to SpacetimeDB and keeps the board calibration panel. `speller/cloud.py` is the HTTP client. |
| `edge/` | On-board signal processing + ML. `features.py: blink_command()` holds the gesture mapping. **Copy `edge/` to the board after changing it.** |
| `scripts/e2e.ts` | End-to-end test against a running SpacetimeDB (plays speller + hub + dashboard). |
| `scripts/photon-check.ts` | Confirms Photon key/project and lists recent texts to the line. |
| `scripts/maritime_deploy.py`, `deploy/` | Optional always-on cloud box (Maritime). The user decided to **skip Maritime**. |
| `docs/DEVPOST.md` | Devpost copy. `docs/HARDWARE.md` covers the EOG pipeline, wiring and calibration. |

## Run it (Windows, PowerShell, repo root)

```powershell
npm install
spacetime start                                                   # terminal 1, leave running
cd spacetime ; spacetime publish --server local -y blinktalk ; cd ..   # add --delete-data after schema changes
npm run e2e            # 19 checks, ~20 s
npm run photon-check   # key + line OK?
npm run hub            # terminal 2 (only ONE hub at a time)
npm run dashboard      # terminal 3 → http://localhost:5173 (caregiver), /?view=patient (patient), ?demo for sample data
python speller/speller.py --serial COM12 --bridge   # with the board; keyboard on the patient screen: arrows, Space(2), P(3), S(5)
```

`spacetime publish` with no `--server` defaults to **maincloud**, so always pass `--server local` for local work. The "tsc not found" warning during publish is harmless (workspaces hoist TypeScript to the root).

## Configuration: `.env` (gitignored, never commit)

`NVIDIA_API_KEY`, `NEMOTRON_MODEL` (default `nvidia/nemotron-3.5-super-vl-120b-a12b`), `NEMOTRON_BASE_URL` (default `https://integrate.api.nvidia.com/v1`, or `http://localhost:11434/v1` with `ollama pull nemotron-3-nano` for offline), optional `NEMOTRON_VISION_MODEL`, `PHOTON_PROJECT_ID` (`pho_prj_…`, **not** the `pho_sk_…` key id), `PHOTON_API_KEY` (the secret), `SPACETIME_URI`, `SPACETIME_DB`, `BLINKTALK_PATIENT` (default `neal`), `MARITIME_API_KEY` (unused). `npm run check-secrets` and the pre-commit hook (`node scripts/install-hooks.mjs`) block key-shaped strings.

The Photon line: the user's iPhone **+1 (972) 979-6413** is assigned to the shared line **+1 (628) 502-4649**.

## Tests (all passing at handoff)

`npm test -w spacetime` (8) · `npm test -w hub` (15) · `npm test -w dashboard` (7) · `python speller/test_cloud.py` (5) · `python edge/test_gestures.py` (3) · `npm run e2e` (19, needs the server). Live browser checks were also run (patient screen + dashboard on a real server): spelling, live draft, AI replies, one-blink reply, recipient picker, rest mode, SOS, caregiver ack.

Verified live by the user: Nemotron tool calls through build.nvidia.com, the Photon key, and SpacetimeDB local publish plus e2e. **Not yet verified live:** a full Photon round trip (text the line while the hub runs), Nemotron vision on a real photo, and the board running the new 5-blink `edge/` code.

## Conventions and the user's decisions (keep these)

- **Git:** commits authored *and* committed as `Neal Kapadia <nkapadia15@outlook.com>`, **with no AI co-author or session trailers**. Remote `https://github.com/NealKapadia/TalkTalkTahur.git`, branch `main`. The user pushes from their laptop.
- **Design: "lamplight".** No purple/violet anywhere. Patient screen: warm dark `#17130F`, paper ink `#F3EADB`, lamp amber focus `#F6B24A` (glowing), sage `#8FCB9B` ok, red `#E8503A` SOS. Rationale: a bedside screen at night should emit no blue light. Dashboard: stone `#E9ECE7` / walnut `#2A211A` / amber, automatic night mode = lamplight. Fonts: **Literata** (anything the patient says) + **Atkinson Hyperlegible** (UI, low-vision). Soft tactile (neumorphic) tiles/panels, SVG icons only (no emoji), reduced-motion respected.
- **Copy:** README says "the patient" (not "Neal"). The demo family: **Mom** (tier 1), **Alex** (brother, tier 2; never "Adrian" in demo data), Night nurse (tier 3).
- **Gestures:** 2 = choose, 3 = on/off, 5 = SOS, 4 = nothing. SOS works while paused; toggling never hides an SOS.
- **Nemotron's role** is a *keyboard accelerator that never speaks for the patient*: it drafts, the patient chooses. Messages sent from a suggestion are marked `assisted`, and the dashboard reports eye movements saved (`spellCost()` simulation).
- `docs/HARDWARE.md` still mentions "UT Dallas HackEdge 2026". The user knows; leave how to describe the project's history to them.

## Open items / ideas (in priority order)

1. Live end-to-end with the board + Photon + Nemotron, then record the demo video (see `docs/PITCH.md`).
2. Devpost submission (copy in `docs/DEVPOST.md`), repo made public, push.
3. Optional: image/GIF *replies* (Nemotron can't generate images; would need an image model such as FLUX on build.nvidia.com plus Photon attachment upload).
4. Optional MLH side prizes: GoDaddy Registry domain, DEV Writing Challenge (post-event article).
5. Security hardening if time allows: SpacetimeDB reducers are callable anonymously; restrict caregiver/hub reducers by identity.
