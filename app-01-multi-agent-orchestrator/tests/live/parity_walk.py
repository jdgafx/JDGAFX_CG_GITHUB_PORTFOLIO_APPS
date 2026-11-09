"""Parity walk: every control that works on main (1cb0af1) still works, with the same visible result, in the branch build.

The set of controls comes from main's own DOM (button, a[href], [role=button], [role=tab], [role=link], summary, text fields; the cited
sentences are role=button), never from a hand list. For each width and each state a visitor can be in (idle, replay finished, replay
running, run stopped) the walk:
  1. loads main's built app, lists every visible control with its accessible name,
  2. clicks each one (fresh load per control) and records the outcome: the texts that appear or disappear, the focus target, a
     download, a new tab, the field value, the control's own aria/open state, and where on screen the first new text sits,
  3. does the same on the branch build, finds the control with the same name and asserts it exists, is enabled as on main, and
     that its outcome is visible inside the viewport within 1 s (scrolled into view or focused), as it is on main,
  4. checks that a control that sticks to the screen on main (position sticky or fixed: the Stop dock) is still on screen after a scroll.
A control removed or renamed on purpose is listed in CANON / REPLACED below with its replacement, and the replacement is asserted the same way.
Both builds are fed the same published replay (fetched once); its clock is compressed so a replay takes seconds, not 30 s.
"""
from __future__ import annotations

import contextlib, json, multiprocessing, re, shutil, subprocess, tempfile, time, urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-01-multi-agent-orchestrator.json"
BASE_COMMIT = "1cb0af1"
ALLOWED_HOSTS = ("127.0.0.1", "raw.githubusercontent.com", "fonts.googleapis.com", "fonts.gstatic.com")
EXAMPLE_LABELS = ["Space telescope", "Gene editing", "Systems languages"]
SELECTOR = "button, a[href], [role=button], [role=tab], [role=link], summary, textarea, input:not([type=hidden])"
SETTLE_MS = 1000  # the outcome of a click must be on screen within this

# ---- deliberate changes -----------------------------------------------------------------------------------------------------------
# A main control name -> the name it carries in the branch. Both sides are canonicalised before they are paired.
CANON = [
    # The example buttons name their question and source list on main and only the short label in the A look (the question is the title).
    (re.compile(r"^(" + "|".join(EXAMPLE_LABELS) + r").+$"), r"\1"),
    # The disclosure over the citation list reads "Sources (n)" on main and "Cited sources (n)" in the A look.
    (re.compile(r"^Cited sources \((\d+)\)$"), r"Sources (\1)"),
]
# A main control that is gone on purpose -> (why, replacement check run on the branch in the same state, returns a problem or None).
# "Examples" was a summary that opened a list; the A look shows the three example buttons all the time.
REPLACED = {
    "Examples": ("the list is always open as a row of example buttons", "examples_visible"),
    # Main folds the steps away once a result shows (button 'Show'); the ticket keeps them open during a replay (button 'Hide').
    "Show": ("the steps stay open during a replay; the button folds and unfolds them", "howto_toggle"),
    "Hide": ("same toggle, open state", "howto_toggle"),
}


# Copy that main shows and the A look does not, or words it differently. A text that appears or disappears on main and matches one of these is
# not held against the branch. Only static copy is listed: every text a control produces from data (a claim, a source, a stage output) is compared.
TEXT_CANON = [(re.compile(r"^Sources \($"), "Cited sources (")]
TEXT_IGNORED = [
    (re.compile(r"^web pages, arXiv papers, Hacker News stories and Wikipedia articles$"), "the example buttons carry the label; the question is the tooltip"),
    (re.compile(r"^(What this showcases:|a fixed multi-agent pipeline grounded in live public sources)"), "the showcase line moved from the masthead to the footer, where it is always shown"),
    (re.compile(r"^[\d,.]+ (ms|s)$"), "a stage time depends on when the replay was stopped or finished, and differs from one load to the next"),
    (re.compile(r"^(Export report|Save the report as a file\.|PDF|DOCX|Markdown)$"), "the export bar is kept after a stopped or failed run (round 1 fix), so it does not go away with the report"),
    (re.compile(r"^(Available when the run ends|Available once a run has output|Exports all four stages|Exports research, analysis)"),
     "the export help line belongs to the export bar, which the A look shows after the report"),
]


def canon_text(t: str) -> str:
    for rx, rep in TEXT_CANON:
        if rx.match(t):
            return rep
    return t


def ignored_text(t: str) -> bool:
    return any(rx.search(t) for rx, _ in TEXT_IGNORED)


def canon(name: str) -> str:
    for rx, rep in CANON:
        if rx.match(name):
            return rx.sub(rep, name)
    return name


# ---- in-page scripts --------------------------------------------------------------------------------------------------------------

CONTROLS = """(sel) => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({visibilityProperty: true}); };
  const name = e => {
    let n = e.getAttribute('aria-label');
    if (!n && e.getAttribute('aria-labelledby')) n = e.getAttribute('aria-labelledby').split(' ').map(i => document.getElementById(i)?.textContent || '').join(' ');
    if (!n && e.labels && e.labels.length) n = [...e.labels].map(l => l.textContent).join(' ');
    if (!n) n = e.textContent || '';
    if (!n) n = e.getAttribute('title') || e.getAttribute('placeholder') || '';
    return n.replace(/\\s+/g, ' ').trim();
  };
  const sticky = e => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const out = [];
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e)) continue;
    out.push({name: name(e), tag: e.tagName.toLowerCase(), href: e.getAttribute('href'), disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', sticky: sticky(e)});
  }
  return out;
}"""

# The element behind the i-th entry of CONTROLS.
NTH = """(args) => { const [sel, i] = args;
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({visibilityProperty: true}); };
  return [...document.querySelectorAll(sel)].filter(vis)[i]; }"""

SNAP = """() => {
  const texts = {}, vh = innerHeight; let seq = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.textContent.replace(/\\s+/g, ' ').trim(); const p = n.parentElement;
    if (!t || !p || p.closest('script,style,noscript,title') || !p.checkVisibility({visibilityProperty: true}) || p.closest('.howto, [aria-labelledby=graph-title], .relay-track-card')) continue;
    const r = p.getBoundingClientRect(), live = !!p.closest('[aria-live],[role=status],[role=alert]');
    if ((r.width === 0 || r.height === 0) && !live) continue;
    (texts[t] ||= []).push({seq: seq++, top: Math.round(r.top), bottom: Math.round(r.bottom), live: live && (r.width === 0 || r.height === 0)});
  }
  const a = document.activeElement;
  const name = e => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const ar = a ? a.getBoundingClientRect() : null;
  return {texts, vh, scrollY: Math.round(scrollY),
    values: [...document.querySelectorAll('textarea,input')].map(e => e.value),
    focus: a && a !== document.body ? {name: name(a), tag: a.tagName.toLowerCase(), inView: ar.top >= 0 && ar.top < vh} : null};
}"""

SELF_STATE = """(e) => { const d = e.closest('details');
  return [e.getAttribute('aria-expanded'), e.getAttribute('aria-selected'), e.getAttribute('aria-pressed'), d ? String(d.open) : null, e.disabled ? 'disabled' : null].join('|'); }"""

# Controls that stay on screen after a scroll: name and whether each is inside the viewport at the middle and at the bottom of the page.
REACH = """(sel) => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({visibilityProperty: true}); };
  const els = [...document.querySelectorAll(sel)].filter(vis);
  const inView = e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
  const max = document.documentElement.scrollHeight - innerHeight, res = els.map(() => ({}));
  for (const [key, y] of [['mid', max / 2], ['bottom', max]]) { scrollTo(0, y); els.forEach((e, i) => { res[i][key] = inView(e); }); }
  scrollTo(0, 0);
  return res;
}"""


# ---- build the reference ---------------------------------------------------------------------------------------------------------

def reference_build(repo_root: Path, app: str) -> Path:
    """main at 1cb0af1 built outside the worktree: git archive, npm ci, the same build. Reused when it is already there."""
    base = Path(tempfile.gettempdir()) / f"agentflow-parity-{BASE_COMMIT}"
    dist = base / app / "dist"
    if (dist / "index.html").exists():
        return base / app
    shutil.rmtree(base, ignore_errors=True)
    base.mkdir(parents=True)
    tar = base / "src.tar"
    subprocess.run(["git", "archive", "-o", str(tar), BASE_COMMIT, app, "shared"], cwd=repo_root, check=True)
    subprocess.run(["tar", "-x", "-f", str(tar), "-C", str(base)], check=True)
    subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=base / app, check=True, capture_output=True)
    subprocess.run(["npm", "run", "build"], cwd=base / app, check=True, capture_output=True)
    return base / app


def published_replay(path: str | None) -> dict:
    if path:
        return json.loads(Path(path).read_text())
    with urllib.request.urlopen(RAW, timeout=30) as r:
        return json.loads(r.read())


def compressed(rec: dict, factor: float) -> str:
    """The same exchanges in the same order with every time divided by factor, so a replay of 30 s plays in 30/factor s."""
    rec = json.loads(json.dumps(rec))
    for ex in rec["exchanges"]:
        for k in ("t_start", "t_headers", "t_end"):
            ex[k] = ex[k] / factor
        for c in ex["chunks"]:
            c["t"] = c["t"] / factor
    return json.dumps(rec)


# ---- one build, one width, one state ---------------------------------------------------------------------------------------------

STATES = ("idle", "done", "running", "stopped")
FACTOR = {"idle": 1, "done": 12, "running": 2, "stopped": 2}


class Session:
    def __init__(self, browser, url, size, rec, state):
        self.url, self.state = url, state
        self.ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, service_workers="block", accept_downloads=True)
        self.ctx.route(re.compile(r"^https?://(?!(%s)).*" % "|".join(re.escape(h) for h in ALLOWED_HOSTS)), lambda r: r.abort())
        self.ctx.route(re.compile(r"^http://127\.0\.0\.1:\d+/api/.*"), lambda r: r.fulfill(status=503, body="{}"))
        body = compressed(rec, FACTOR[state])
        self.ctx.route(RAW, lambda r: r.fulfill(status=200, body=body, headers={"content-type": "application/json", "access-control-allow-origin": "*"}))
        self.page = self.ctx.new_page()
        self.popups: list[str] = []
        self.downloads: list[str] = []
        self.ctx.on("page", lambda p: self.popups.append(p))
        self.page.on("download", lambda d: self.downloads.append(d.suggested_filename))

    def reach(self):
        p = self.page
        for extra in self.ctx.pages:
            if extra is not p:
                extra.close()
        self.popups.clear(); self.downloads.clear()
        p.goto(self.url + ("?replay=off" if self.state == "idle" else ""))
        p.wait_for_selector(".live-data")
        if self.state == "idle":
            p.wait_for_timeout(300)
            return
        if self.state == "done":
            wait_done(p)
            return
        if self.state == "stopped":
            # Stop is pressed inside the page, in the same task in which the Critic's badge appears, so the stopped state is the same on every load.
            p.evaluate("""() => { const stop = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Stop');
              const obs = new MutationObserver(() => { if ((document.querySelector('.ds-badge')?.textContent || '').includes('Running: Critic') && stop()) { stop().click(); obs.disconnect(); } });
              obs.observe(document.body, {subtree: true, childList: true, characterData: true}); }""")
            p.wait_for_selector(".ds-app[data-run=stopped]", timeout=40000)
            p.wait_for_timeout(500)
            return
        badge = "() => document.querySelector('.ds-badge')?.textContent || ''"
        for attempt in range(3):  # a loaded machine can let the Critic window pass before the poll sees it: load again
            deadline = time.time() + 40
            while time.time() < deadline and "Running: Critic" not in p.evaluate(badge):
                p.wait_for_timeout(20)
            if "Running: Critic" in p.evaluate(badge):
                return
            p.goto(self.url)
            p.wait_for_selector(".live-data")
        raise RuntimeError("the replay never reached the Critic stage")

    def close(self):
        self.ctx.close()


def wait_done(page, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        if page.evaluate("() => document.querySelector('.ds-app')?.dataset.run === 'done' && document.querySelector('.ds-badge')?.textContent.trim() !== 'Auditing'"):
            page.wait_for_timeout(700)
            return
        page.wait_for_timeout(100)
    raise TimeoutError("the replay did not finish")


def outcome(sess: Session, index: int, ctl: dict) -> dict:
    p = sess.page
    if ctl["disabled"]:
        return {"disabled": True}
    el = p.evaluate_handle(NTH, [SELECTOR, index]).as_element()
    el.evaluate("e => e.scrollIntoView({block: 'center'})")
    p.wait_for_timeout(50)
    before = p.evaluate(SNAP)
    ctl_top = el.evaluate("e => Math.round(e.getBoundingClientRect().top)")
    s0 = el.evaluate(SELF_STATE)
    if ctl["tag"] in ("textarea", "input"):
        el.fill("What causes the tides in the ocean?")
    else:
        el.click(timeout=4000)
    p.wait_for_timeout(SETTLE_MS)
    # An export is slow to build (PDF): its result is the file, so wait for the "Preparing..." label to go before reading the page.
    end = time.time() + 25
    while time.time() < end and p.evaluate("() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Preparing'))"):
        p.wait_for_timeout(200)
    after = p.evaluate(SNAP)
    try:
        s1 = el.evaluate(SELF_STATE)
    except Exception:
        s1 = "(re-rendered)"
    vh = after["vh"]
    shown = lambda o: o["top"] < vh and o["bottom"] > 0  # noqa: E731
    added, removed, removed_in_view = [], [], False
    for t, owners in after["texts"].items():
        n0 = len(before["texts"].get(t, []))
        for o in owners[n0:]:
            added.append({"t": t, "seq": o["seq"], "inView": shown(o), "top": o["top"], "live": o["live"]})
    for t, owners in before["texts"].items():
        n1 = len(after["texts"].get(t, []))
        if n1 < len(owners):
            removed.append(t)
            removed_in_view = removed_in_view or any(shown(o) for o in owners[n1:])
    added.sort(key=lambda a: a["seq"])
    popup = sess.popups[0].url if sess.popups else None
    f = after["focus"]
    focus_elsewhere = bool(f) and f["inView"] and not ctl["name"].startswith(f["name"][:40]) and not f["name"].startswith(ctl["name"][:40])
    value = after["values"] if after["values"] != before["values"] else False
    # What a visitor sees happen: new text on screen, text gone from the screen, the page scrolling, focus landing somewhere else, a file, a tab.
    visible = any(a["inView"] and not a["live"] for a in added) or removed_in_view or after["scrollY"] != before["scrollY"] or focus_elsewhere \
        or bool(sess.downloads) or popup is not None or value is not False
    return {"disabled": False, "added": added, "removed": removed, "value": value, "focus": f, "self": [s0, s1], "download": sess.downloads[:1],
            "popup": popup, "visible": visible, "vh": vh}


def sweep(browser, url, size, rec, state, with_outcomes):
    """All controls of one state with their outcomes. Returns (controls, outcomes, reach)."""
    sess = Session(browser, url, size, rec, state)
    try:
        sess.reach()
        ctls = sess.page.evaluate(CONTROLS, SELECTOR)
        reach = sess.page.evaluate(REACH, SELECTOR)
        outs = []
        if with_outcomes:
            for i, c in enumerate(ctls):
                if i:
                    sess.reach()
                try:
                    outs.append(outcome(sess, i, c))
                except Exception as e:
                    outs.append({"error": str(e).splitlines()[0][:160]})
        return ctls, outs, reach
    finally:
        sess.close()


# ---- compare -----------------------------------------------------------------------------------------------------------------------

def replacement_problem(kind: str, browser, url, size, rec, state):
    sess = Session(browser, url, size, rec, state)
    try:
        sess.reach()
        p = sess.page
        if kind == "examples_visible":
            got = p.evaluate("(labels) => labels.map(l => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === l); "
                             "return !!b && b.getBoundingClientRect().width > 0; })", EXAMPLE_LABELS)
            return None if all(got) else f"example buttons visible: {got}"
        if kind == "howto_toggle":
            def steps():
                return p.evaluate("() => [...document.querySelectorAll('.howto__steps li')].filter(l => l.getBoundingClientRect().height > 0).length")
            btn = p.locator("button.howto__toggle")
            if btn.count() != 1:
                return "no How-to toggle"
            first = steps()
            btn.click(); p.wait_for_timeout(300)
            second = steps()
            btn.click(); p.wait_for_timeout(300)
            third = steps()
            return None if (first == 4) != (second == 4) and first == third else f"steps visible {first} -> {second} -> {third}"
        return f"unknown replacement {kind}"
    finally:
        sess.close()


def compare(m: dict, b: dict) -> list[str]:
    """Problems of branch outcome b against main outcome m (empty = parity)."""
    if "error" in m:
        return []  # a click main itself could not perform proves nothing; reported by the caller
    if "error" in b:
        return [f"click failed on the branch: {b['error']}"]
    if m["disabled"] != b["disabled"]:
        return [f"enabled on main: {not m['disabled']}, on the branch: {not b['disabled']}"]
    if m["disabled"]:
        return []
    out = []
    flipped_default = m["self"][0].split("|")[3] != b["self"][0].split("|")[3]
    if flipped_default:
        # A disclosure that opens on main and starts open in the A look (the cited sources on a phone): judged by whether it still toggles.
        if m["self"][0] != m["self"][1] and b["self"][0] == b["self"][1]:
            out.append("the disclosure no longer toggles")
        return out
    btexts = {a["t"]: a for a in b["added"]}
    for a in (dict(a, t=canon_text(a["t"])) for a in m["added"] if not a["live"] and not ignored_text(a["t"])):
        if a["t"] not in btexts:
            out.append(f"result text missing: {a['t'][:200]!r}")
    if m["visible"] and not b["visible"]:
        out.append("the click shows something on screen on main (text, scroll, focus, file or tab) and nothing on the branch: no scroll, no focus, nothing in view")
    gone = [canon_text(t) for t in m["removed"] if not ignored_text(t)]
    gone = [t for t in gone if t not in b["removed"]]
    if gone:
        out.append(f"text that goes away on main stays: {gone[0][:200]!r}")
    if m["value"] != b["value"]:
        out.append(f"field value after: main {m['value']}, branch {b['value']}")
    if m["self"][1] != m["self"][0] and m["self"][1] != "(re-rendered)" and b["self"][1] == b["self"][0]:
        out.append(f"control state did not change ({m['self'][0]} -> {m['self'][1]} on main)")
    if bool(m["download"]) != bool(b["download"]):
        out.append(f"download: main {m['download']}, branch {b['download']}")
    if (m["popup"] or "").split("#")[0] != (b["popup"] or "").split("#")[0]:
        out.append(f"new tab: main {m['popup']}, branch {b['popup']}")
    mf, bf = m["focus"], b["focus"]
    if mf and not (bf and canon(mf["name"]) == canon(bf["name"])) :
        out.append(f"focus: main {mf['name'][:40]!r}, branch {(bf or {}).get('name', 'none')[:40]!r}")
    return out


def pair(mctls, bctls):
    """Index of the branch control for each main control: same canonical name, n-th of the same name with the n-th."""
    seen: dict[str, int] = {}
    bmap: dict[str, list[int]] = {}
    for j, c in enumerate(bctls):
        bmap.setdefault(canon(c["name"]), []).append(j)
    res = []
    for c in mctls:
        k = canon(c["name"])
        n = seen.get(k, 0)
        seen[k] = n + 1
        res.append(bmap.get(k, [])[n] if len(bmap.get(k, [])) > n else None)
    return res


def task(args):
    """One (width, build, state): the controls with their outcomes, and, on the branch, the replacement checks. Runs in its own process."""
    size, which, dist, csp, rec, state = args
    from playwright.sync_api import sync_playwright
    from relay_a_dark_check import serve_dist
    with serve_dist(Path(dist), csp) as url, sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            ctls, outs, reach = sweep(browser, url, size, rec, state, state != "running")
            repl = {k: replacement_problem(k, browser, url, size, rec, state) for k in ("examples_visible", "howto_toggle")} if which == "branch" else {}
            return {"size": size, "which": which, "state": state, "ctls": ctls, "outs": outs, "reach": reach, "repl": repl}
        except Exception as e:
            return {"size": size, "which": which, "state": state, "error": str(e).splitlines()[0][:200]}
        finally:
            browser.close()


def judge(tag, state, m, b, enabled_later):
    """(total, ok, lines) for one width and state."""
    if "error" in m or "error" in b:
        return 1, 0, [f"FAIL {tag} {state}: could not reach the state: {m.get('error') or b.get('error')}"]
    lines, total, ok = [], 0, 0
    with_out = state != "running"
    idx = pair(m["ctls"], b["ctls"])
    for i, c in enumerate(m["ctls"]):
        total += 1
        label = f"{tag} {state} {c['name'][:50]!r}"
        if with_out and "error" in m["outs"][i]:
            lines.append(f"FAIL {label}: the click failed on main itself ({m['outs'][i]['error']}): the walk cannot judge it")
            continue
        j = idx[i]
        key = canon(c["name"])
        if j is None and c["disabled"] and key in enabled_later:
            ok += 1  # disabled on main in this state; on the branch it appears, enabled, in the state where it works (checked there)
            continue
        if j is None or key in ("Show", "Hide"):
            why = REPLACED.get(key)
            if not why:
                lines.append(f"FAIL {label}: control is gone in the branch and no replacement is listed")
                continue
            prob = b["repl"][why[1]]
            if prob:
                lines.append(f"FAIL {label}: replaced on purpose ({why[0]}) but the replacement fails: {prob}")
            else:
                ok += 1
                lines.append(f"ok   {label}: replaced on purpose ({why[0]}); replacement works")
            continue
        probs = []
        if b["ctls"][j]["disabled"] != c["disabled"]:
            probs.append(f"enabled on main: {not c['disabled']}, on the branch: {not b['ctls'][j]['disabled']}")
        if with_out:
            probs += compare(m["outs"][i], b["outs"][j])
        # A run in progress is cancelled with the control that stays on screen on main (the Stop dock). The idle rail of main (research field,
        # examples, export beside the report) is gone on purpose in the A layout, where the research card is the hero at the top of the page.
        if state == "running" and not c["disabled"] and c["sticky"] and m["reach"][i].get("bottom") and m["reach"][i].get("mid"):
            r = b["reach"][j]
            if not (r.get("bottom") and r.get("mid")):
                probs.append("stays on screen while the page scrolls on main (sticky) but scrolls out of view on the branch")
        if probs:
            lines.append(f"FAIL {label}: " + "; ".join(probs))
        else:
            ok += 1
    return total, ok, lines


def run(sizes, main_app: Path, branch_app: Path, csp: str, recording: str | None, log, fail):
    rec = published_replay(recording)
    jobs = [(s, w, str((main_app if w == "main" else branch_app) / "dist"), csp, rec, st) for s in sizes for w in ("main", "branch") for st in STATES]
    with multiprocessing.get_context("spawn").Pool(12) as pool:
        got = pool.map(task, jobs, chunksize=1)
    res = {(r["size"], r["which"], r["state"]): r for r in got}
    for s in sizes:
        tag = f"{s[0]}x{s[1]}"
        total = ok = 0
        enabled_later = {canon(c["name"]) for st in STATES if "ctls" in res[(s, "branch", st)] for c in res[(s, "branch", st)]["ctls"] if not c["disabled"]}
        for st in STATES:
            t, o, lines = judge(tag, st, res[(s, "main", st)], res[(s, "branch", st)], enabled_later)
            total += t; ok += o
            for l in lines:
                (fail if l.startswith("FAIL") else log)(l[5:])
        (log if ok == total else fail)(f"{tag}: {ok} of {total} controls parity ok")
