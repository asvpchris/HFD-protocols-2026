/* =====================================================================
   app.js — MedicPrep application logic
   ---------------------------------------------------------------------
   Features:
     - Dashboard with progress stats
     - Section hubs with four tabs: Quiz, Study, Flashcards, Cheat Sheet
     - Quiz: timed/untimed, difficulty filter, review-missed-only
     - Study: question-by-question with full explanations always visible
     - Flashcards: flip + shuffle + deck progress
     - Cheat sheet view
     - Rapid Review (20 cross-section Qs), Scenario Mode, Review Missed Only
     - Global search (protocols/drugs/topics)
     - Light/Dark theme toggle (stored in localStorage)
     - LocalStorage-based progress: per-question right/wrong, per-section
       stats, weak-areas tracker, streak, answered count
   ===================================================================== */

/* ------------------------------------------------------------------
   Storage helpers
   ------------------------------------------------------------------ */
const LS_KEY = "medicprep.v1";

const Store = {
    _data: null,
    _default() {
        return {
            theme: "light",
            // per-question state: { [qid]: { right: n, wrong: n, lastCorrect: bool, lastAnswered: ISO } }
            qstate: {},
            // per-section stats: { [sectionId]: { answered, correct } }
            sstate: {},
            // history (for dashboard streaks): ISO date strings where at least 1 Q was answered
            days: [],
            // list of missed question ids for easy review
            missed: []
        };
    },
    load() {
        if (this._data) return this._data;
        try {
            const raw = localStorage.getItem(LS_KEY);
            this._data = raw ? JSON.parse(raw) : this._default();
        } catch (e) {
            console.warn("Storage parse failed, resetting", e);
            this._data = this._default();
        }
        // Backfill missing top-level keys (forward compat)
        const def = this._default();
        for (const k of Object.keys(def)) {
            if (!(k in this._data)) this._data[k] = def[k];
        }
        return this._data;
    },
    save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(this._data)); } catch (e) {}
    },
    reset() {
        const theme = this.load().theme;
        this._data = this._default();
        this._data.theme = theme;
        this.save();
    },
    /* Record an answer */
    record(sectionId, qid, correct) {
        const d = this.load();
        // qstate
        const qs = d.qstate[qid] || { right: 0, wrong: 0 };
        if (correct) qs.right++; else qs.wrong++;
        qs.lastCorrect = correct;
        qs.lastAnswered = new Date().toISOString();
        d.qstate[qid] = qs;
        // sstate
        const ss = d.sstate[sectionId] || { answered: 0, correct: 0 };
        ss.answered++;
        if (correct) ss.correct++;
        d.sstate[sectionId] = ss;
        // missed list
        if (!correct && !d.missed.includes(qid)) d.missed.push(qid);
        if (correct) d.missed = d.missed.filter(x => x !== qid);
        // days
        const today = new Date().toISOString().slice(0, 10);
        if (!d.days.includes(today)) d.days.push(today);
        this.save();
    }
};

/* ------------------------------------------------------------------
   Utilities
   ------------------------------------------------------------------ */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (k === "class")       n.className = v;
        else if (k === "html")   n.innerHTML = v;
        else if (k === "onclick")n.addEventListener("click", v);
        else if (k.startsWith("data-")) n.setAttribute(k, v);
        else if (k in n)         n[k] = v;
        else                     n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
        if (c == null) continue;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function useTemplate(id) {
    const tpl = document.getElementById(id);
    if (!tpl) return null;
    return tpl.content.firstElementChild.cloneNode(true);
}

/* ------------------------------------------------------------------
   Streak helper
   ------------------------------------------------------------------ */
function computeStreak(days) {
    if (!days || days.length === 0) return 0;
    const set = new Set(days);
    let s = 0;
    const d = new Date();
    for (;;) {
        const key = d.toISOString().slice(0, 10);
        if (set.has(key)) { s++; d.setDate(d.getDate() - 1); }
        else break;
    }
    return s;
}

/* ------------------------------------------------------------------
   Router (hash-based) — simple views: #/, #/section/:id, #/rapid, ...
   ------------------------------------------------------------------ */
const Router = {
    go(hash) { window.location.hash = hash; },
    parse() {
        const h = (location.hash || "#/").replace(/^#/, "");
        const parts = h.split("/").filter(Boolean);
        return parts;
    }
};

/* ------------------------------------------------------------------
   Theme
   ------------------------------------------------------------------ */
function applyTheme() {
    const t = Store.load().theme || "light";
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById("themeToggle");
    if (btn) btn.querySelector(".theme-icon").textContent = (t === "dark" ? "☀" : "◐");
}
function toggleTheme() {
    const d = Store.load();
    d.theme = d.theme === "dark" ? "light" : "dark";
    Store.save();
    applyTheme();
}

/* ------------------------------------------------------------------
   Search index (built on first use)
   ------------------------------------------------------------------ */
let SEARCH_INDEX = null;
function buildSearchIndex() {
    if (SEARCH_INDEX) return SEARCH_INDEX;
    const rows = [];
    for (const sec of PROTOCOL_DATA.sections) {
        // Questions
        for (const q of sec.questions) {
            rows.push({
                sectionId: sec.id, sectionName: sec.name,
                title: q.q,
                meta: sec.name + " · " + q.diff + " · Question",
                hay: (q.q + " " + q.choices.join(" ") + " " + q.why_right + " " + q.why_wrong).toLowerCase(),
                target: `#/section/${sec.id}/study/${q.id}`
            });
        }
        // Flashcards
        for (const f of (sec.flashcards || [])) {
            rows.push({
                sectionId: sec.id, sectionName: sec.name,
                title: f.front,
                meta: sec.name + " · Flashcard",
                hay: (f.front + " " + f.back).toLowerCase(),
                target: `#/section/${sec.id}/flash`
            });
        }
        // Cheat sheet items
        for (const cs of (sec.cheatSheet || [])) {
            for (const it of cs.items) {
                rows.push({
                    sectionId: sec.id, sectionName: sec.name,
                    title: it.slice(0, 120),
                    meta: sec.name + " · " + cs.heading,
                    hay: (cs.heading + " " + it).toLowerCase(),
                    target: `#/section/${sec.id}/cheat`
                });
            }
        }
    }
    SEARCH_INDEX = rows;
    return rows;
}
function doSearch(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const terms = q.split(/\s+/);
    return buildSearchIndex()
        .map(r => {
            let score = 0;
            for (const t of terms) {
                const i = r.hay.indexOf(t);
                if (i < 0) return null;
                // earlier match = higher score
                score += 1 + (r.hay.length - i) / r.hay.length;
                if (r.title.toLowerCase().includes(t)) score += 2;
            }
            return { r, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map(x => x.r);
}

/* ==================================================================
   VIEW: Dashboard
   ================================================================== */
function renderDashboard() {
    const root = $("#view");
    root.innerHTML = "";
    const node = useTemplate("tpl-dashboard");
    root.appendChild(node);

    // Stats
    const d = Store.load();
    const totalAnswered = Object.values(d.qstate).reduce((s, v) => s + v.right + v.wrong, 0);
    const totalRight = Object.values(d.qstate).reduce((s, v) => s + v.right, 0);
    $("[data-stat='answered']").textContent = totalAnswered;
    $("[data-stat='accuracy']").textContent = totalAnswered ? Math.round(100 * totalRight / totalAnswered) + "%" : "—";
    $("[data-stat='streak']").textContent = computeStreak(d.days);

    // Weakest section (by lowest accuracy, min 5 answered)
    let weakest = "—";
    let weakestAcc = 1.01;
    for (const s of PROTOCOL_DATA.sections) {
        const ss = d.sstate[s.id];
        if (!ss || ss.answered < 5) continue;
        const acc = ss.correct / ss.answered;
        if (acc < weakestAcc) { weakestAcc = acc; weakest = s.name; }
    }
    $("[data-stat='weak']").textContent = weakest;

    // Action buttons
    root.querySelector("[data-action='rapid']").onclick = () => Router.go("#/rapid");
    root.querySelector("[data-action='scenario']").onclick = () => Router.go("#/scenario");
    root.querySelector("[data-action='missed']").onclick = () => Router.go("#/missed");

    // Section grid
    const grid = $("#sectionGrid");
    for (const s of PROTOCOL_DATA.sections) {
        const card = el("button", { class: "sec-card", type: "button", onclick: () => Router.go("#/section/" + s.id) }, [
            el("div", { class: "sec-icon", html: s.icon }),
            el("div", { class: "sec-title" }, s.name),
            el("div", { class: "sec-blurb" }, s.blurb || "")
        ]);
        const meta = el("div", { class: "sec-meta" });
        meta.appendChild(el("span", { class: "pill" }, (s.questions ? s.questions.length : 0) + " questions"));
        meta.appendChild(el("span", { class: "pill" }, (s.flashcards ? s.flashcards.length : 0) + " cards"));
        const ss = d.sstate[s.id];
        if (ss && ss.answered) {
            const acc = Math.round(100 * ss.correct / ss.answered);
            meta.appendChild(el("span", { class: "pill" }, acc + "% correct"));
        }
        card.appendChild(meta);
        grid.appendChild(card);
    }
}

/* ==================================================================
   VIEW: Section hub
   ================================================================== */
function renderSection(sectionId, subView, subArg) {
    const section = PROTOCOL_DATA.sections.find(s => s.id === sectionId);
    if (!section) { Router.go("#/"); return; }

    const root = $("#view");
    root.innerHTML = "";
    const node = useTemplate("tpl-section");
    node.querySelector("[data-slot='title']").textContent = section.name;
    node.querySelector("[data-slot='blurb']").textContent = section.blurb || "";

    const ss = Store.load().sstate[section.id];
    const stats = node.querySelector("[data-slot='stats']");
    stats.appendChild(el("span", { class: "pill" }, section.questions.length + " questions"));
    stats.appendChild(el("span", { class: "pill" }, (section.flashcards || []).length + " flashcards"));
    if (ss && ss.answered) {
        const acc = Math.round(100 * ss.correct / ss.answered);
        stats.appendChild(el("span", { class: "pill" }, "Accuracy: " + acc + "%"));
        stats.appendChild(el("span", { class: "pill" }, ss.answered + " answered"));
    }

    node.querySelector("[data-back]").onclick = () => Router.go("#/");
    root.appendChild(node);

    // Tabs
    const tabs = Array.from(node.querySelectorAll(".tab"));
    const panels = {
        quiz:  node.querySelector("[data-panel='quiz']"),
        study: node.querySelector("[data-panel='study']"),
        flash: node.querySelector("[data-panel='flash']"),
        cheat: node.querySelector("[data-panel='cheat']")
    };

    function activateTab(name) {
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        Object.entries(panels).forEach(([k, el]) => el.hidden = (k !== name));
        // lazy render
        if (name === "quiz"  && !panels.quiz.dataset.rendered)  { renderQuizPanel(panels.quiz, section); panels.quiz.dataset.rendered = 1; }
        if (name === "study" && !panels.study.dataset.rendered) { renderStudyPanel(panels.study, section, subArg); panels.study.dataset.rendered = 1; }
        if (name === "flash" && !panels.flash.dataset.rendered) { renderFlashPanel(panels.flash, section); panels.flash.dataset.rendered = 1; }
        if (name === "cheat" && !panels.cheat.dataset.rendered) { renderCheatPanel(panels.cheat, section); panels.cheat.dataset.rendered = 1; }
    }
    tabs.forEach(t => t.onclick = () => activateTab(t.dataset.tab));
    activateTab(subView || "quiz");
}

/* ==================================================================
   Quiz panel
   ================================================================== */
function renderQuizPanel(root, section) {
    root.innerHTML = "";
    const start = useTemplate("tpl-quizStart");
    start.querySelector("[data-start]").onclick = () => {
        const cfg = {
            count: parseInt(start.querySelector("[data-cfg='count']").value, 10),
            difficulty: start.querySelector("[data-cfg='difficulty']").value,
            timer: parseInt(start.querySelector("[data-cfg='timer']").value, 10),
            missedOnly: start.querySelector("[data-cfg='missed']").checked
        };
        root.innerHTML = "";
        runQuiz(root, section, cfg, questionsForQuiz(section, cfg));
    };
    root.appendChild(start);
}

function questionsForQuiz(section, cfg) {
    let pool = section.questions.slice();
    if (cfg.difficulty && cfg.difficulty !== "any") {
        pool = pool.filter(q => q.diff === cfg.difficulty);
    }
    if (cfg.missedOnly) {
        const missed = new Set(Store.load().missed);
        pool = pool.filter(q => missed.has(q.id));
    }
    pool = shuffle(pool);
    return pool.slice(0, cfg.count || 20);
}

/**
 * Runs a quiz in-place. Used both for section quizzes, Rapid Review, and Missed review.
 */
function runQuiz(root, sectionOrNull, cfg, questions, titleOverride) {
    if (!questions || !questions.length) {
        root.appendChild(el("div", { class: "card" }, [
            el("p", {}, "No questions matched your filters. Try different settings."),
            el("button", { class: "ghost", onclick: () => (sectionOrNull ? renderQuizPanel(root, sectionOrNull) : Router.go("#/")) }, "Back")
        ]));
        return;
    }

    let idx = 0, correctCount = 0;
    // for per-section breakdown in results
    const byDiff = { basic: {t:0,r:0}, intermediate: {t:0,r:0}, advanced: {t:0,r:0} };
    const wrongList = [];
    const head = el("div", { class: "quiz-head" });
    const progress = el("div", { class: "quiz-progress" }, el("span", { class: "bar" }));
    const label = el("div", {}, titleOverride || (sectionOrNull ? sectionOrNull.name + " · Quiz" : "Quiz"));
    const score = el("div", {}, "0/0");
    const timerEl = el("div", { class: "timer" }, "");
    head.appendChild(label); head.appendChild(progress); head.appendChild(timerEl); head.appendChild(score);
    root.appendChild(head);

    const body = el("div", {});
    root.appendChild(body);

    let timerId = null;
    function clearTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

    function renderQ() {
        clearTimer();
        const q = questions[idx];
        body.innerHTML = "";

        // Progress
        progress.firstChild.style.width = ((idx / questions.length) * 100) + "%";
        score.textContent = (correctCount) + "/" + (idx);

        // Timer
        if (cfg.timer && cfg.timer > 0) {
            let remain = cfg.timer;
            timerEl.textContent = remain + "s";
            timerEl.classList.remove("warn", "alert");
            timerId = setInterval(() => {
                remain--;
                timerEl.textContent = remain + "s";
                if (remain <= 10) timerEl.classList.add("warn");
                if (remain <= 5)  timerEl.classList.add("alert");
                if (remain <= 0) { clearTimer(); handleAnswer(null); }
            }, 1000);
        } else {
            timerEl.textContent = "";
        }

        // Question text + difficulty badge
        const diffClass = q.diff;
        const qtext = el("div", { class: "qtext" });
        qtext.appendChild(document.createTextNode(q.q));
        qtext.appendChild(el("span", { class: "badge " + diffClass }, q.diff));
        body.appendChild(qtext);

        // Choices
        const letters = ["A","B","C","D","E","F"];
        const choiceBox = el("div", { class: "choices" });
        q.choices.forEach((c, i) => {
            const btn = el("button", { class: "choice", type: "button" }, [
                el("span", { class: "letter" }, letters[i]),
                el("span", {}, c)
            ]);
            btn.onclick = () => handleAnswer(i);
            choiceBox.appendChild(btn);
        });
        body.appendChild(choiceBox);

        function handleAnswer(selected) {
            clearTimer();
            const buttons = Array.from(choiceBox.querySelectorAll(".choice"));
            buttons.forEach(b => b.disabled = true);
            if (selected !== null) buttons[selected].classList.add(selected === q.correct ? "correct" : "wrong");
            buttons[q.correct].classList.add("correct");

            const isCorrect = (selected === q.correct);
            if (isCorrect) correctCount++;
            byDiff[q.diff].t++;
            if (isCorrect) byDiff[q.diff].r++;
            if (!isCorrect) wrongList.push(q);

            // Record
            const secId = sectionOrNull ? sectionOrNull.id : inferSectionIdForQuestion(q.id);
            Store.record(secId, q.id, isCorrect);

            // Explanation
            const ex = el("div", { class: "explain" }, [
                el("h4", {}, isCorrect ? "Correct" : "Not quite"),
                el("p", { html: "<b>Why this answer is right:</b> " + q.why_right }),
                el("p", { html: "<b>Why the others are wrong:</b> " + q.why_wrong })
            ]);
            body.appendChild(ex);

            const wrap = el("div", { class: "next-wrap" });
            const next = el("button", { class: "primary" }, idx === questions.length - 1 ? "See results" : "Next question →");
            next.onclick = () => {
                if (idx === questions.length - 1) { showResults(); }
                else { idx++; renderQ(); }
            };
            wrap.appendChild(next);
            body.appendChild(wrap);
            progress.firstChild.style.width = (((idx + 1) / questions.length) * 100) + "%";
            score.textContent = correctCount + "/" + (idx + 1);
        }
    }

    function showResults() {
        clearTimer();
        body.innerHTML = "";
        progress.firstChild.style.width = "100%";

        const pct = Math.round(100 * correctCount / questions.length);
        const card = el("div", { class: "result" }, [
            el("div", { class: "score" }, correctCount + " / " + questions.length),
            el("div", { class: "pct" }, pct + "% correct"),
        ]);
        // Breakdown
        const bd = el("div", { class: "breakdown" }, el("strong", {}, "By difficulty"));
        for (const key of ["basic","intermediate","advanced"]) {
            const b = byDiff[key];
            if (!b.t) continue;
            bd.appendChild(el("div", { class: "row" }, [
                el("span", {}, key),
                el("span", {}, b.r + "/" + b.t + " · " + Math.round(100 * b.r / b.t) + "%")
            ]));
        }
        card.appendChild(bd);

        const actions = el("div", { class: "result-actions" });
        actions.appendChild(el("button", {
            class: "primary",
            onclick: () => {
                if (sectionOrNull) {
                    // Re-render the quiz-start form in the same panel
                    renderQuizPanel(root, sectionOrNull);
                } else {
                    Router.go("#/rapid");
                }
            }
        }, "New quiz"));
        actions.appendChild(el("button", {
            class: "ghost",
            onclick: () => Router.go("#/")
        }, "Dashboard"));
        if (wrongList.length) {
            actions.appendChild(el("button", {
                class: "ghost",
                onclick: () => {
                    root.innerHTML = "";
                    runQuiz(root, sectionOrNull, { timer: 0 }, wrongList, "Review missed");
                }
            }, "Review my " + wrongList.length + " missed"));
        }
        card.appendChild(actions);
        body.appendChild(card);
    }

    renderQ();
}

function inferSectionIdForQuestion(qid) {
    for (const s of PROTOCOL_DATA.sections) {
        if (s.questions.some(q => q.id === qid)) return s.id;
    }
    return "misc";
}

/* ==================================================================
   Study panel — one question at a time, explanation always visible
   ================================================================== */
function renderStudyPanel(root, section, startQid) {
    root.innerHTML = "";
    const list = section.questions.slice(); // keep original order
    let idx = startQid ? Math.max(0, list.findIndex(q => q.id === startQid)) : 0;

    const toolbar = el("div", { class: "study-toolbar" }, [
        el("div", { class: "study-index" }, ""),
        el("div", {}, [
            el("button", { class: "ghost", onclick: () => { idx = Math.max(0, idx - 1); render(); } }, "← Previous"),
            " ",
            el("button", { class: "ghost", onclick: () => { idx = Math.min(list.length - 1, idx + 1); render(); } }, "Next →"),
            " ",
            el("button", { class: "ghost", onclick: () => { idx = Math.floor(Math.random() * list.length); render(); } }, "🎲 Random")
        ])
    ]);
    root.appendChild(toolbar);

    const body = el("div", {});
    root.appendChild(body);

    function render() {
        const q = list[idx];
        toolbar.querySelector(".study-index").textContent = "Q " + (idx + 1) + " of " + list.length;
        body.innerHTML = "";

        const qtext = el("div", { class: "qtext" });
        qtext.appendChild(document.createTextNode(q.q));
        qtext.appendChild(el("span", { class: "badge " + q.diff }, q.diff));
        body.appendChild(qtext);

        const letters = ["A","B","C","D","E","F"];
        const cb = el("div", { class: "choices" });
        q.choices.forEach((c, i) => {
            const cls = "choice " + (i === q.correct ? "correct" : "");
            const btn = el("button", { class: cls, type: "button", disabled: true }, [
                el("span", { class: "letter" }, letters[i]),
                el("span", {}, c)
            ]);
            cb.appendChild(btn);
        });
        body.appendChild(cb);

        const ex = el("div", { class: "explain" }, [
            el("h4", {}, "Explanation"),
            el("p", { html: "<b>Why this answer is right:</b> " + q.why_right }),
            el("p", { html: "<b>Why the others are wrong:</b> " + q.why_wrong })
        ]);
        body.appendChild(ex);
    }
    render();
}

/* ==================================================================
   Flashcard panel
   ================================================================== */
function renderFlashPanel(root, section) {
    root.innerHTML = "";
    let deck = shuffle(section.flashcards || []);
    let idx = 0;

    if (!deck.length) {
        root.appendChild(el("p", { class: "muted" }, "No flashcards in this section."));
        return;
    }

    const card = el("div", { class: "flashcard" }, [
        el("div", { class: "flash-inner" }, [
            el("div", { class: "flash-face flash-front" }, [
                el("div", { class: "flash-label" }, "Front · tap to flip"),
                el("div", { class: "flash-text" }, "")
            ]),
            el("div", { class: "flash-face flash-back" }, [
                el("div", { class: "flash-label" }, "Back"),
                el("div", { class: "flash-text" }, "")
            ])
        ])
    ]);
    const info = el("div", { class: "muted" }, "");
    const tools = el("div", { class: "flash-tools" }, [
        el("button", { class: "ghost", onclick: () => { idx = (idx - 1 + deck.length) % deck.length; render(); } }, "← Prev"),
        el("button", { class: "primary", onclick: () => {
            card.querySelector(".flash-inner").classList.toggle("flipped");
        } }, "Flip"),
        el("button", { class: "ghost", onclick: () => { idx = (idx + 1) % deck.length; render(); } }, "Next →"),
        el("button", { class: "ghost", onclick: () => { deck = shuffle(deck); idx = 0; render(); } }, "🔀 Shuffle")
    ]);

    const wrap = el("div", { class: "flash-wrap" }, [card, tools, info]);
    root.appendChild(wrap);

    card.addEventListener("click", (e) => {
        // ignore when clicking tools below
        card.querySelector(".flash-inner").classList.toggle("flipped");
    });

    function render() {
        card.querySelector(".flash-inner").classList.remove("flipped");
        card.querySelector(".flash-front .flash-text").textContent = deck[idx].front;
        card.querySelector(".flash-back .flash-text").textContent  = deck[idx].back;
        info.textContent = "Card " + (idx + 1) + " of " + deck.length;
    }
    render();
}

/* ==================================================================
   Cheat-sheet panel
   ================================================================== */
function renderCheatPanel(root, section) {
    root.innerHTML = "";
    const cheat = el("div", { class: "cheat card" });
    if (!section.cheatSheet || !section.cheatSheet.length) {
        cheat.appendChild(el("p", { class: "muted" }, "No cheat sheet yet for this section."));
        root.appendChild(cheat);
        return;
    }
    for (const block of section.cheatSheet) {
        cheat.appendChild(el("h3", {}, block.heading));
        const ul = el("ul");
        for (const it of block.items) ul.appendChild(el("li", { html: highlightDoses(escapeHtml(it)) }));
        cheat.appendChild(ul);
    }
    root.appendChild(cheat);
}

function escapeHtml(s) {
    return s.replace(/[&<>"]/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[ch]));
}
// Add a tiny visual treat for dose-like text inside cheat items
function highlightDoses(s) {
    return s.replace(
        /\b\d+[\d\.]*\s?(mg|g|mcg|IU|mL|L|J|%|bpm|h|min|sec|mmHg|mEq|kg)\b/gi,
        m => `<span class="dose">${m}</span>`
    );
}

/* ==================================================================
   Rapid Review  (20-question mix across sections)
   ================================================================== */
function renderRapid() {
    const root = $("#view");
    root.innerHTML = "";
    const wrap = el("div", {});
    root.appendChild(wrap);

    wrap.appendChild(el("button", { class: "back", onclick: () => Router.go("#/") }, "← Back to dashboard"));
    wrap.appendChild(el("h1", {}, "⚡ Rapid Review"));
    wrap.appendChild(el("p", { class: "muted" }, "20 mixed questions drawn from across all protocol sections. 30-second timer."));
    const container = el("div", { class: "card" });
    wrap.appendChild(container);

    const pool = [];
    for (const s of PROTOCOL_DATA.sections) pool.push(...s.questions);
    const picks = shuffle(pool).slice(0, 20);
    runQuiz(container, null, { timer: 30 }, picks, "Rapid Review · 20 Q");
}

/* ==================================================================
   Missed-only review
   ================================================================== */
function renderMissed() {
    const root = $("#view");
    root.innerHTML = "";
    const wrap = el("div", {});
    root.appendChild(wrap);

    wrap.appendChild(el("button", { class: "back", onclick: () => Router.go("#/") }, "← Back to dashboard"));
    wrap.appendChild(el("h1", {}, "🔁 Review Missed Questions"));

    const missedIds = new Set(Store.load().missed);
    const pool = [];
    for (const s of PROTOCOL_DATA.sections) {
        for (const q of s.questions) if (missedIds.has(q.id)) pool.push(q);
    }
    wrap.appendChild(el("p", { class: "muted" }, pool.length ? ("You have " + pool.length + " question(s) to re-attempt.") : "You have no missed questions yet — try a quiz first."));
    const container = el("div", { class: "card" });
    wrap.appendChild(container);
    if (!pool.length) return;
    runQuiz(container, null, { timer: 0 }, shuffle(pool), "Missed question review");
}

/* ==================================================================
   Scenario Mode — multi-step patient case
   ================================================================== */
function renderScenario() {
    const root = $("#view");
    root.innerHTML = "";
    const wrap = el("div", {});
    root.appendChild(wrap);
    wrap.appendChild(el("button", { class: "back", onclick: () => Router.go("#/") }, "← Back to dashboard"));
    wrap.appendChild(el("h1", {}, "🚑 Scenario Mode"));
    wrap.appendChild(el("p", { class: "muted" }, "Step-by-step patient cases. Make decisions the way you would in the field."));

    // Flatten all scenarios
    const scenarios = [];
    for (const s of PROTOCOL_DATA.sections) for (const sc of (s.scenarios || [])) scenarios.push({ section: s, sc });
    if (!scenarios.length) {
        wrap.appendChild(el("div", { class: "card" },
            el("p", {}, "No scenarios available yet. Add more in data.js under sections[i].scenarios.")));
        return;
    }

    // Show a picker
    const picker = el("div", { class: "section-grid" });
    for (const { section, sc } of scenarios) {
        const card = el("button", { class: "sec-card", onclick: () => runScenario(wrap, section, sc) }, [
            el("div", { class: "sec-icon" }, "🚑"),
            el("div", { class: "sec-title" }, sc.title),
            el("div", { class: "sec-blurb" }, section.name + " · " + sc.steps.length + " steps")
        ]);
        picker.appendChild(card);
    }
    wrap.appendChild(picker);
}
function runScenario(wrap, section, sc) {
    wrap.innerHTML = "";
    wrap.appendChild(el("button", { class: "back", onclick: renderScenario }, "← Back to scenarios"));
    wrap.appendChild(el("h1", {}, sc.title));
    wrap.appendChild(el("p", { class: "muted" }, section.name + " · " + sc.steps.length + " steps"));

    const container = el("div", { class: "card" });
    wrap.appendChild(container);
    let idx = 0, rights = 0;

    function step() {
        const s = sc.steps[idx];
        container.innerHTML = "";
        container.appendChild(el("div", { class: "qtext" }, "Step " + (idx + 1) + " of " + sc.steps.length + ": " + s.prompt));
        const cb = el("div", { class: "choices" });
        const letters = ["A","B","C","D"];
        s.choices.forEach((c, i) => {
            const btn = el("button", { class: "choice", type: "button" }, [
                el("span", { class: "letter" }, letters[i]),
                el("span", {}, c)
            ]);
            btn.onclick = () => {
                Array.from(cb.querySelectorAll(".choice")).forEach(b => b.disabled = true);
                if (i === s.correct) { btn.classList.add("correct"); rights++; }
                else { btn.classList.add("wrong"); cb.children[s.correct].classList.add("correct"); }
                const ex = el("div", { class: "explain" }, [
                    el("h4", {}, i === s.correct ? "Good call" : "Consider this"),
                    el("p", {}, s.explain)
                ]);
                container.appendChild(ex);
                const nxt = el("div", { class: "next-wrap" });
                if (idx < sc.steps.length - 1) {
                    nxt.appendChild(el("button", { class: "primary", onclick: () => { idx++; step(); } }, "Next →"));
                } else {
                    nxt.appendChild(el("button", { class: "primary", onclick: () => {
                        container.innerHTML = "";
                        container.appendChild(el("div", { class: "result" }, [
                            el("div", { class: "score" }, rights + "/" + sc.steps.length),
                            el("div", { class: "pct" }, Math.round(100 * rights / sc.steps.length) + "% correct decisions"),
                            el("div", { class: "result-actions" }, [
                                el("button", { class: "primary", onclick: () => runScenario(wrap, section, sc) }, "Replay"),
                                el("button", { class: "ghost", onclick: renderScenario }, "Pick another"),
                                el("button", { class: "ghost", onclick: () => Router.go("#/") }, "Dashboard")
                            ])
                        ]));
                    } }, "Finish"));
                }
                container.appendChild(nxt);
            };
            cb.appendChild(btn);
        });
        container.appendChild(cb);
    }
    step();
}

/* ==================================================================
   Search UI
   ================================================================== */
function wireSearch() {
    const input = $("#globalSearch");
    const box   = $("#searchResults");
    input.addEventListener("input", () => {
        const q = input.value;
        if (q.trim().length < 2) { box.hidden = true; box.innerHTML = ""; return; }
        const rows = doSearch(q);
        box.innerHTML = "";
        if (!rows.length) {
            box.appendChild(el("div", { class: "sr-meta", style: "padding:10px" }, "No matches."));
            box.hidden = false;
            return;
        }
        rows.forEach(r => {
            const row = el("button", { class: "search-row", onclick: () => {
                input.value = "";
                box.hidden = true;
                Router.go(r.target);
            } }, [
                el("span", { class: "sr-title" }, r.title),
                el("span", { class: "sr-meta"  }, r.meta)
            ]);
            box.appendChild(row);
        });
        box.hidden = false;
    });
    document.addEventListener("click", (e) => {
        if (!$(".search-wrap").contains(e.target)) { box.hidden = true; }
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { input.value = ""; box.hidden = true; }
    });
}

/* ==================================================================
   Router dispatch
   ================================================================== */
function dispatch() {
    const parts = Router.parse();
    // #/, #/section/:id[/tab[/arg]], #/rapid, #/missed, #/scenario
    if (parts.length === 0) { renderDashboard(); return; }
    if (parts[0] === "section" && parts[1]) {
        renderSection(parts[1], parts[2], parts[3]);
        return;
    }
    if (parts[0] === "rapid")    { renderRapid();    return; }
    if (parts[0] === "missed")   { renderMissed();   return; }
    if (parts[0] === "scenario") { renderScenario(); return; }
    renderDashboard();
}

/* ==================================================================
   Init
   ================================================================== */
function init() {
    Store.load();
    applyTheme();
    wireSearch();

    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#brandBtn").addEventListener("click", () => Router.go("#/"));
    $("#resetBtn").addEventListener("click", () => {
        if (confirm("Reset all progress? (Your theme will be kept.)")) {
            Store.reset();
            dispatch();
        }
    });
    window.addEventListener("hashchange", dispatch);
    dispatch();
}
document.addEventListener("DOMContentLoaded", init);
