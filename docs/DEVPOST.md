# Devpost submission: Blink Blink Blink Talkur (aka BlinkTalk)

**Elevator pitch (tagline):** Talk, text and call for help with only your eyes: two blinks to choose, five to bring family running.

---

## Inspiration
My uncle had ALS, and he passed away this past month. Watching him slowly lose the ability to move and then to speak was one of the hardest things I've been through. He understood everything going on around him, but by the end he could barely get a word out. The tools we found were expensive, stopped at a screen by his bed, and couldn't text his family or call for help when nobody was in the room. I built BlinkTalk for people like him, and for the families sitting next to them.

## What it does
BlinkTalk lets someone who can't speak or move talk, text and call for help using only their eyes.

- **Eyes in:** three electrodes on the forehead pick up the eye's electrical signal. A small TI board recognises each movement on-device: look left or right to move, **two blinks** to choose, **three blinks** to switch BlinkTalk off so they can rest their eyes, and **five blinks** to call for help. Four blinks do nothing, so turning it off can never be mistaken for an SOS.
- **A screen made for eyes:** one choice is lit at a time on an endless ribbon, the message they're answering sits on top, and their words appear in large type. The colours are warm, with no blue light, because it's on at the bedside all night.
- **Real iMessage:** the patient has their own iMessage line through **Photon**. Family text them like anyone else, and photos show up described on screen.
- **AI that never speaks for them:** an **NVIDIA Nemotron** agent drafts four replies in their voice. Spell "alex pho" and it works out who it's for: *"to Alex: Can you bring pho tonight?"*. One double blink sends it. The dashboard counts the eye movements it saved.
- **Help in five blinks:** an SOS texts the first caregiver. If nobody replies "OK" within 45 seconds it moves to the next person, then the next. When someone answers, the patient's screen says help is on the way.
- **Family can be there from anywhere:** a caregiver dashboard shows their words appearing letter by letter, a live eye trace drawn the way the electrodes see it, heart rate, the conversation and every step the AI took.

## How we built it
- **Hardware:** a TI AFE4950EVM reads the eye signal (EOG) and a fingertip heart-rate sensor. A per-person scikit-learn model on a TI SK-AM62B classifies each movement in about 90 ms, fully offline, and calibrates for a new person in about a minute.
- **SpacetimeDB is the entire backend:** one TypeScript module with 11 tables and ~23 reducers holds every rule: heart-rate alerts, phrase learning, message routing, and SOS escalation as a *scheduled reducer*, so it still escalates if every screen crashes. The patient screen and dashboard are pure live subscriptions with no API layer.
- **Photon 2.0:** a Node hub polls the patient's iMessage line, turns incoming texts and photos into database rows, and delivers replies and SOS alerts from the same number. Replying "OK" acknowledges an alert.
- **NVIDIA Nemotron:** a tool-calling agent (`get_conversation`, `get_patient_state`, `list_contacts`, `alert_caregivers`, `propose_replies`, `propose_messages`) plus Nemotron's vision model for photos. It can run on build.nvidia.com or fully offline through Ollama.
- **Front end:** React + Vite for the patient screen and the dashboard; Literata for anything the patient says, Atkinson Hyperlegible (designed for low vision) for the interface.
- **Testing:** unit tests for the backend, agent, Photon bridge and speller, an end-to-end script against a live SpacetimeDB server, and browser tests that drive both screens at once.

## Challenges we ran into
- **Making blinks a reliable language.** Natural blinks happen constantly, so single blinks are ignored, the gestures are spaced (2, 3, 5), and four is unused so on/off and SOS can never be confused.
- **AI that helps without speaking for someone.** Nemotron only drafts; the patient always chooses. Getting replies short enough to be worth a glance but different enough to be useful took a lot of prompt and tool design.
- **iMessage rules.** A shared Photon line can only reply to people who texted it first, so the hub remembers each caregiver's conversation and warns when someone hasn't said hi yet.
- **Escalation that can't silently fail.** The SOS timer lives in the database as a scheduled reducer instead of in a browser tab.
- **Endless scrolling with eyes.** The choice ribbon wraps forever without jumping, so the patient never loses their place.

## Accomplishments that we're proud of
- A full loop from an eye movement to a real iMessage on a family member's phone and back.
- Five blinks reliably reach a real phone, with escalation and a "help is on the way" confirmation for the patient.
- Measuring the AI instead of hand-waving: every AI-drafted message is compared with what spelling it would have cost.
- A patient screen designed for the bedside at night, not a generic dashboard.
- 57 automated checks, including an end-to-end run against a live SpacetimeDB server.

## What we learned
- When the database *is* the backend, the clients get simple: the screens are just subscriptions, and the speller talks to the backend through a short HTTP client.
- For assistive tech, the AI's job is to save effort, not to talk. Every design decision got better once that was the rule.
- Accessibility is in the details: one thing in focus, big type, no blue light at night, and gestures that can't be triggered by accident.

## What's next for BlinkTalk
- Testing with more people and clinicians, including people living with ALS.
- Voice calls on Photon's voice line, with the patient's replies spoken on a real phone call.
- A personal synthesized voice, and long-term tracking of gesture accuracy to help care teams notice changes over time.

## Built with
spacetimedb, typescript, node.js, react, vite, photon, imessage, nvidia-nemotron, nvidia-nim, ollama, python, tkinter, scikit-learn, numpy, scipy, texas-instruments, am62, afe4950, websockets, vitest, playwright, html5, css3

(Add `gemini`, `vultr`, `tiger-data` and so on only if you actually ship those integrations.)
