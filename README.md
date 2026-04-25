# MedicPrep — EMS / NREMT Paramedic Study App

A lightweight, offline-capable single-page web app built for paramedic / NREMT
prep, with content adapted from the **Hollywood Fire Rescue (HFD) EMS Protocols
2026** PDF.

No build step, no dependencies, no backend. Just four files.

---

## Features

- **8 protocol sections** — Cardiac, Respiratory, Trauma, Medical / Neuro,
  OB/GYN, Toxicology, Environmental / Peds, Pharmacology
- **240 NREMT-style MCQs** (30 per section) with 4 choices, a correct answer,
  and detailed "why right / why wrong" explanations
- **120 flashcards** with a 3-D flip animation and shuffle
- **45 cheat-sheet blocks** of high-yield bullets with drug doses highlighted
- **6 multi-step clinical scenarios** (chest pain, severe asthma, multi-system
  trauma, stroke, pre-eclampsia / eclampsia, opioid OD)
- **Quiz Mode** — configurable length (10/20/30/50), difficulty filter, optional
  per-question timer (30/45/60/90 s), missed-only filter, results breakdown
- **Study Mode** — step through questions with explanations always visible;
  Previous / Next / Random
- **Rapid Review** — 20-question mixed quiz with a 30-second timer
- **Scenario Mode** — multi-step patient cases, consequence-based feedback
- **Review Missed Only** — rebuilds a deck from every question you've missed
- **Dashboard** — questions answered, overall accuracy, day-streak, weakest
  section
- **Global search** across questions, flashcards, and cheat sheets
- **Dark / light mode** toggle, persisted
- **localStorage persistence** (`medicprep.v1`) — progress saved on the device,
  no account needed
- **Mobile-responsive** down to ~520 px

---

## File structure

```
index.html     — HTML shell, templates for each view
styles.css     — all styling, CSS variables for theming
data.js        — PROTOCOL_DATA object: sections, questions, flashcards,
                 cheat sheets, scenarios
app.js         — state store, router, renderers, quiz/scenario engines
README.md      — this file
```

Content and logic are separated — to add questions, edit `data.js` only.

---

## How to run

Because the app is 100% static, you can just open it. Two easy options:

### Option 1 — Double-click

1. Open the folder containing the four files.
2. Double-click `index.html`. It should open in your default browser.

That works in Chrome, Safari, Firefox, and Edge with no further setup.

### Option 2 — Local web server (recommended if double-click has issues)

Some browsers (notably Chrome on strict settings) restrict `file://` scripts.
If that happens, serve the folder over HTTP. From the folder in a terminal:

```bash
# Python 3
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

or

```bash
# Node.js
npx serve .
# or
npx http-server .
```

Any static server works — no backend is needed.

---

## How your data is stored

Progress is written to `localStorage` under the key `medicprep.v1`:

- `theme` — `"light"` or `"dark"`
- `qstate` — per-question `{ correct, attempts, lastSeen }`
- `sstate` — per-section aggregate stats
- `days` — set of ISO dates used to compute the day-streak
- `missed` — set of question IDs you got wrong (feeds the Missed deck)

Nothing is sent anywhere. Clearing site data or hitting the ↺ button in the
topbar resets everything.

---

## Adding or editing content

Open `data.js`. Each section is pushed to `PROTOCOL_DATA.sections` with this
shape:

```js
PROTOCOL_DATA.sections.push({
    id: "cardiac",
    name: "Cardiac",
    icon: "❤",
    blurb: "Short description for the dashboard card.",
    cheatSheet: [
        { heading: "ACLS basics", items: ["Epi 1 mg IV q3–5 min", "..."] }
    ],
    flashcards: [
        { front: "Adult compression rate", back: "100–120/min, ≥2 in depth" }
    ],
    questions: [
        Q("id-unique", "basic|intermediate|advanced",
            "Question prompt",
            ["Choice A", "Choice B", "Choice C", "Choice D"],
            1,                 // index (0-3) of the correct answer
            "Why the correct choice is right",
            "Why the distractors are wrong")
    ],
    scenarios: [
        {
            title: "Scenario title",
            steps: [
                { prompt: "...", choices: ["..."], correct: 0,
                  explain: "Teaching point for this step" }
            ]
        }
    ]
});
```

Any new question id must be unique across the whole file. That's the only
constraint. The global search index and stats update automatically.

---

## Notes / disclaimers

- Content is adapted from the **HFD 2026 EMS protocols** for study purposes.
  Always follow your local medical director, agency protocols, and current
  guidelines in the field.
- This is a study aid. It is **not** a clinical decision tool.
- All progress is stored locally on the device it is opened from. Different
  browsers / profiles / devices keep separate progress.

Study safe, and good luck on NREMT. 🚑
