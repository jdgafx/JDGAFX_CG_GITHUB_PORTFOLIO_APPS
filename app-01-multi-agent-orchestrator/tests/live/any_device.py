#!/usr/bin/env python3
"""AgentFlow on any device (T-016 design, T-017 build): one sweep over every width and one pass over 27 named devices.

  python3 tests/live/any_device.py --dist dist [--browser chromium|webkit] [--only sweep|devices] [--out DIR]
  relay_a_dark_check.py calls run() below (and skips the sweep with --quick).

States (each reached in a fresh page): idle (?replay=off), critic / synthesizer / auditing (the replay frozen there with Playwright's clock: the page's own
Date.now and timers stop, so the badge cannot move while it is measured), done, panel (done + first claim selected), stopped (Stop pressed in Critic).
Scroll positions: top, mid, bottom. Rules, each reported as "FAIL <rule> <size> <state>: <what>":
  G1 sideways scroll   G2 text outside its bordered card or clipping box   G3 text over text, pills touching   G4 text covered by another element, Stop over text
  G6 touch control under 44 px (touch rows)   G7 each layout switch changes once, at its width (sweep)   G8 Stop in the masthead, on screen; sticky only >=1000x521
  G9 source panel title on screen, hit-testable, focused when below the report, within 1 s   G10 first screen at the T-009 sizes   G11 masthead height equal in
  critic and done   G12 audit summary beside the report from 1200 px, above it below   G13 Start by keyboard puts focus on Stop without scrolling
Skipped everywhere: visually hidden boxes, line-clamped text, text inside a scroll container; text scrolled under a stuck masthead (E).
"""
import argparse, contextlib, json, multiprocessing, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import parity_walk as P

STATES = ("idle", "critic", "synthesizer", "auditing", "done", "panel", "stopped")
FROZEN = {"critic": "Running: Critic", "synthesizer": "Running: Synthesizer", "auditing": "Auditing", "stopped": "Running: Critic"}
WIDEST_TIME = "Finished · 123.4 s"
BADGE = "() => (document.querySelector('.ds-badge')?.textContent || '').trim()"
SIG = "() => (document.querySelector('.ds-app')?.dataset.run || '') + '|' + (document.querySelector('.ds-badge')?.textContent || '').trim()"
SWITCHES = (721, 1000, 1120, 1200, 826)
WIDTHS = sorted(set(range(320, 2561, 4)) | {t for s in SWITCHES for t in (s, s - 1)})
T009 = {(1440, 900), (1280, 800), (390, 844), (360, 740)}
# width, height, device pixel ratio, touch (design.md, "Device classes")
DEVICES = [(320, 568, 2, 1), (360, 740, 3, 1), (360, 780, 3, 1), (375, 667, 2, 1), (393, 659, 3, 1), (390, 844, 3, 1), (414, 896, 3, 1), (412, 839, 2.625, 1),
           (734, 343, 3, 1), (863, 360, 2.625, 1), (768, 1024, 2, 1), (800, 1280, 2, 1), (820, 1180, 2, 1), (1024, 768, 2, 1), (1180, 820, 2, 1), (1280, 800, 2, 1),
           (1280, 800, 1, 0), (1366, 635, 1, 0), (1280, 587, 1, 0), (1280, 480, 1, 0), (1536, 731, 1.25, 0), (1440, 900, 2, 0), (1920, 947, 1, 0),
           (2560, 1307, 1, 0), (3440, 1307, 1, 0), (640, 400, 2, 0), (960, 473, 2, 0)]

# One read of the page at the current width and scroll position: the problems of G1-G4 and G6, and the facts G7-G12 need.
GEOMETRY = r"""(opt) => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const add = (rule, msg) => out.push([rule, msg]);
  const label = e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '');
  const hdr = document.querySelector('.ds-header'), hr = hdr ? hdr.getBoundingClientRect() : null;
  const stuck = !!hdr && getComputedStyle(hdr).position === 'sticky' && Math.abs(hr.top) < 1 && scrollY > 0;
  const underBar = (x, y) => stuck && x >= hr.left && x <= hr.right && y >= hr.top && y <= hr.bottom;
  const stop = [...document.querySelectorAll('button')].find(b => /^Stop( audit)?$/.test(b.textContent.trim()));
  const memo = new Map();
  const skipped = el => {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (memo.has(el)) return memo.get(el);
    const s = getComputedStyle(el), b = el.getBoundingClientRect();
    const clipsBox = s.overflowX !== 'visible' || s.overflowY !== 'visible';
    const own = s.display !== 'contents' && ((s.clipPath || '').includes('inset(50%)') || (clipsBox && (b.width <= 1 || b.height <= 1))
      || (s.webkitLineClamp && s.webkitLineClamp !== 'none') || /auto|scroll/.test(s.overflowX + s.overflowY));
    const r = own || skipped(el.parentElement);
    memo.set(el, r);
    return r;
  };
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim(), p = n.parentElement;
    if (!t || !p || p.closest('script,style,noscript,title') || !p.checkVisibility({visibilityProperty: true}) || skipped(p)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      if (underBar((r.left + r.right) / 2, (r.top + r.bottom) / 2) && !hdr.contains(p)) continue;
      lines.push({p, r, t: t.slice(0, 24)});
    }
  }
  // G2: outside the nearest bordered card (sideways) or a clipping box (any side)
  for (const {p, r, t} of lines) {
    for (let a = p; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a); if (s.display === 'contents' || s.display === 'inline') continue;
      const ar = a.getBoundingClientRect();
      if (/hidden|clip/.test(s.overflowX + s.overflowY) && (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1)) add('G2', `${label(p)} "${t}" is clipped by ${label(a)}`);
      if (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0 && s.borderTopStyle !== 'none') {
        if (r.left < ar.left - 1 || r.right > ar.right + 1) add('G2', `${label(p)} "${t}" crosses the border of ${label(a)}`);
        break;
      }
    }
  }
  // G3: two lines of unrelated elements over each other; the headline pills apart
  // A text rect is the font's content area, taller than the line box when line-height is tight (the 64px "3 of 5"); layout only promises the line box.
  const box = ({p, r, t}) => { const lh = parseFloat(getComputedStyle(p).lineHeight), cut = lh < r.height ? (r.height - lh) / 2 : 0;
    return {p, t, r: {left: r.left, right: r.right, top: r.top + cut, bottom: r.bottom - cut}}; };
  const sorted = lines.map(box).sort((a, b) => a.r.top - b.r.top);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].r.top < sorted[i].r.bottom - 1; j++) {
    const a = sorted[i], b = sorted[j];
    if (a.p.contains(b.p) || b.p.contains(a.p)) continue;
    if (Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1) add('G3', `${label(a.p)} "${a.t}" overlaps ${label(b.p)} "${b.t}"`);
  }
  const pills = [...document.querySelectorAll('.relay-pill')].map(e => e.getBoundingClientRect());
  for (let i = 0; i + 1 < pills.length; i++) {
    const a = pills[i], b = pills[i + 1];
    const gap = Math.max(0, b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
    if (gap < 2) add('G3', 'the two headline pills are under 2 px apart');
  }
  // G4: the point at the middle of a visible text line hits something else; Stop over text
  for (const {p, r, t} of lines) {
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== p && !p.contains(hit)) add('G4', `${label(p)} "${t}" is under ${label(hit)}`);
  }
  const sr = stop ? stop.getBoundingClientRect() : null;
  if (sr && sr.width > 0) for (const {p, r, t} of lines) {
    if (stop.contains(p)) continue;
    const top = stuck ? Math.max(r.top, hr.bottom) : r.top;
    if (Math.min(r.right, sr.right) - Math.max(r.left, sr.left) > 0.5 && Math.min(r.bottom, sr.bottom) - Math.max(top, sr.top) > 0.5) add('G4', `${stop.textContent.trim()} covers ${label(p)} "${t}"`);
  }
  // G1
  if (document.documentElement.scrollWidth > vw) add('G1', `the page is ${document.documentElement.scrollWidth} px wide in a ${vw} px window`);
  // G6
  if (opt.touch) for (const e of document.querySelectorAll(opt.selector)) {
    const r = e.getBoundingClientRect();
    if (e.matches('textarea, .claim, a.md-cite, .md a') || r.width === 0 || r.height === 0 || !e.checkVisibility({visibilityProperty: true}) || skipped(e)) continue;
    if (underBar((r.left + r.right) / 2, (r.top + r.bottom) / 2) && !hdr.contains(e)) continue;
    if (r.width < 43.99 || r.height < 43.99) add('G6', `${label(e)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const node = document.querySelector('.relay-node'), panel = document.querySelector('.panel'), rep = document.querySelector('.audit__report');
  const summary = document.querySelector('.audit-summary'), card = document.querySelector('.relay-report');
  return {problems: out, stuck, mastH: hr ? hr.height : null,
    form: node ? (parseFloat(getComputedStyle(node).borderTopWidth) > 0 ? 'card' : 'compact') : null,
    side: panel && rep ? (panel.getBoundingClientRect().left >= rep.getBoundingClientRect().right - 1 ? 'beside' : 'below') : null,
    stop: stop ? {text: stop.textContent.trim(), inHeader: !!hdr && hdr.contains(stop), inView: sr.left >= 0 && sr.top >= 0 && sr.right <= vw && sr.bottom <= vh} : null,
    summary: summary && card ? {left: summary.getBoundingClientRect().left, bottom: summary.getBoundingClientRect().bottom, rleft: card.getBoundingClientRect().left, rright: card.getBoundingClientRect().right, rtop: card.getBoundingClientRect().top} : null};
}"""

# What a visitor does: the first cited sentence comes into view, then it is clicked.
CLICK_CLAIM = "() => { const c = document.querySelector('.claim'); if (c) { c.scrollIntoView({block: 'center', behavior: 'instant'}); c.click(); } return !!c; }"

PANEL = """() => {
  const t = document.querySelector('[data-panel-focus]'), rep = document.querySelector('.audit__report'), pa = document.querySelector('.panel');
  if (!t) return 'no panel title';
  const r = t.getBoundingClientRect(), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  const below = !!rep && !!pa && pa.getBoundingClientRect().left < rep.getBoundingClientRect().right - 1;
  if (!hit || !(hit === t || t.contains(hit))) return 'title at ' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ' is covered by ' + (hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing (off screen)');
  if (below && document.activeElement !== t) return 'panel below the report but the title has no focus';
  return null;
}"""


def tag_of(w, h, touch):
    return f"{w}x{h}" + (" touch" if touch else "")


def poll(page, expr, seconds, arg=None):
    """Polls with evaluate (Playwright's own waits use requestAnimationFrame, which the frozen clock stops)."""
    end = time.time() + seconds
    while time.time() < end:
        got = page.evaluate(expr, arg) if arg is not None else page.evaluate(expr)
        if got:
            return got
        page.wait_for_timeout(40)
    return None


def make_context(browser, size, dpr, touch):
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=dpr, has_touch=bool(touch), is_mobile=bool(touch), service_workers="block")
    ctx.route(re.compile(r"^https?://(?!(%s)).*" % "|".join(re.escape(h) for h in P.ALLOWED_HOSTS)), lambda r: r.abort())
    ctx.route(re.compile(r"^http://127\.0\.0\.1:\d+/api/.*"), lambda r: r.fulfill(status=503, body="{}"))
    return ctx


def open_state(ctx, url, state, rec, first_screen=None):
    """A fresh page in `state`. Returns (page, signature of the frozen state or None, first-screen problems)."""
    page = ctx.new_page()
    frozen = state in FROZEN
    body = P.compressed(rec, 1 if frozen or state == "idle" else 12)
    page.route(P.RAW, lambda r: r.fulfill(status=200, body=body, headers={"content-type": "application/json", "access-control-allow-origin": "*"}))
    if frozen:
        page.clock.install()  # install alone lets time flow; pause_at (below, once the page runs) stops it until run_for moves it
    page.goto(url + ("?replay=off" if state == "idle" else ""))
    if not poll(page, "() => !!document.querySelector('.live-data')", 20):
        raise RuntimeError("the page did not render")
    if not poll(page, "() => [...document.fonts].some(f => f.status === 'loaded' && f.family.includes('Plus Jakarta')) && [...document.fonts].some(f => f.status === 'loaded' && f.family.includes('Manrope'))", 20):
        raise RuntimeError("the fonts did not load (the sums need the real fonts)")
    problems = []
    if frozen:
        page.clock.pause_at(time.time() + 1)  # Python takes seconds
        want = FROZEN[state]
        for _ in range(3000):
            b = page.evaluate(BADGE)
            if b == want or (want != "Auditing" and b.startswith(want)):
                break
            page.clock.run_for(100)
            page.wait_for_timeout(5)
        else:
            raise RuntimeError(f"the replay never showed {want!r}")
        if state == "synthesizer":
            page.evaluate("(t) => document.querySelectorAll('.relay-word').forEach(e => { e.textContent = t; })", WIDEST_TIME)
        if state == "stopped":
            page.evaluate("() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Stop').click()")
            if not poll(page, "() => document.querySelector('.ds-app')?.dataset.run === 'stopped'", 10):
                raise RuntimeError("Stop did not stop the run")
    elif state in ("done", "panel"):
        P.wait_done(page, 150)  # a loaded machine is slow; the replay itself is compressed to seconds
        if first_screen and state == "done":
            page.wait_for_timeout(2000)
        if state == "panel":
            page.evaluate(CLICK_CLAIM)
            if not poll(page, "() => !!document.querySelector('.panel')", 5):
                raise RuntimeError("the first claim opened no source panel")
    if first_screen and state in ("idle", "critic", "done"):
        res = page.evaluate(first_screen)
        want = r"^Live data" if state == "idle" else r"^Recorded data: .+"
        problems = res["problems"] + ([] if re.match(want, res["chip"]) else [f"chip reads {res['chip']!r}, wanted /{want}/"])
    return page, (page.evaluate(SIG) if frozen else None), problems


def scan(page, touch):
    """G1-G4 and G6 plus the facts, at top, mid and bottom."""
    res = []
    for pos, f in (("top", 0), ("mid", 0.5), ("bottom", 1)):
        page.evaluate("(f) => scrollTo({top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant'})", f)
        info = page.evaluate(GEOMETRY, {"touch": touch, "selector": P.SELECTOR})
        info["pos"] = pos
        res.append(info)
    page.evaluate("() => scrollTo({top: 0, behavior: 'instant'})")
    return res


def merge_ranges(ws):
    out, ws = [], sorted(set(ws))
    for w in ws:
        if out and w - out[-1][1] <= 4:
            out[-1][1] = w
        else:
            out.append([w, w])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in out)


# ---- the width sweep -----------------------------------------------------------------------------------------------------

def sweep_task(args):
    url, browser_name, state, widths, rec = args
    res = {"state": state, "found": {}, "form": {}, "side": {}, "error": None}
    with sync_playwright() as pw:
        browser = getattr(pw, browser_name).launch()
        try:
            ctx = make_context(browser, (1280, 800), 1, False)
            page, sig, _ = open_state(ctx, url, state, rec)
            for w in widths:
                page.set_viewport_size({"width": w, "height": 800})
                for info in scan(page, False):
                    for rule, msg in info["problems"]:
                        e = res["found"].setdefault(f"{rule}|{msg}", {"w": set(), "pos": set()})
                        e["w"].add(w); e["pos"].add(info["pos"])
                    if info["pos"] == "top":
                        if state == "synthesizer":
                            res["form"][w] = info["form"]
                        if state == "panel":
                            res["side"][w] = info["side"]
            if sig is not None and page.evaluate(SIG) != sig:
                res["error"] = f"frozen state moved: {sig} -> {page.evaluate(SIG)}"
        except Exception as e:
            res["error"] = str(e).splitlines()[0][:200]
        finally:
            browser.close()
    return res


def one_switch(vals, first, last, expect, name, fail, browser_name):
    ws = sorted(vals)
    seq = [vals[w] for w in ws]
    changes = [ws[i] for i in range(1, len(ws)) if seq[i] != seq[i - 1]]
    if seq[0] != first or seq[-1] != last or len(changes) != 1:
        fail(f"G7 {name} {browser_name}: goes {first} -> {last} {len(changes)} times, at {changes[:8]} px; wanted once, at {expect} +-4")
    elif abs(changes[0] - expect) > 4:
        fail(f"G7 {name} {browser_name}: switches at {changes[0]} px, wanted {expect} +-4")
    return len(changes) == 1 and abs(changes[0] - expect) <= 4


def sweep(url, log, fail, browser_name="chromium", rec=None, pool_size=14):
    jobs = []
    for state in STATES:
        n = 2
        for k in range(n):
            jobs.append((url, browser_name, state, WIDTHS[k::n], rec))
    start = time.time()
    with multiprocessing.get_context("spawn").Pool(pool_size) as pool:
        got = pool.map(sweep_task, jobs, chunksize=1)
    merged = {s: {"found": {}, "form": {}, "side": {}} for s in STATES}
    for r in got:
        if r["error"]:
            fail(f"sweep {r['state']}: could not finish: {r['error']}")
        m = merged[r["state"]]
        m["form"].update(r["form"]); m["side"].update(r["side"])
        for k, v in r["found"].items():
            e = m["found"].setdefault(k, {"w": set(), "pos": set()})
            e["w"] |= v["w"]; e["pos"] |= v["pos"]
    bad = 0
    for state in STATES:
        for k, v in sorted(merged[state]["found"].items()):
            rule, msg = k.split("|", 1)
            bad += 1
            fail(f"{rule} {merge_ranges(v['w'])}x800 {state}: {msg} [{','.join(sorted(v['pos']))}] ({len(v['w'])} widths)")
    g7 = one_switch(merged["synthesizer"]["form"], "compact", "card", 1120, "track compact -> card (synthesizer)", fail, browser_name) if merged["synthesizer"]["form"] else False
    g7 = one_switch(merged["panel"]["side"], "below", "beside", 826, "source panel below -> beside (panel)", fail, browser_name) and g7 if merged["panel"]["side"] else False
    if not bad and g7:
        log(f"sweep {browser_name}: {len(WIDTHS)} widths x {len(STATES)} states x 3 scroll positions, no G1-G4 problem; track switches once at 1120, panel once at 826 ({time.time() - start:.0f} s)")
    else:
        log(f"sweep {browser_name}: {len(WIDTHS)} widths x {len(STATES)} states x 3 scroll positions done in {time.time() - start:.0f} s; {bad} distinct G1-G4 problems")


# ---- the 27 devices ---------------------------------------------------------------------------------------------------------

def check_panel(page, clock, seconds=1.0):
    """G9: within `seconds` of the click the panel title is hit-testable, and focused when the panel is below the report."""
    end, last = time.time() + seconds, None
    while time.time() < end:
        if clock:
            page.clock.run_for(100)
        last = page.evaluate(PANEL)
        if last is None:
            return None
        page.wait_for_timeout(60)
    return last


def device_task(args):
    url, browser_name, dev, rec, first_screen, out = args
    w, h, dpr, touch = dev
    tag = tag_of(w, h, touch)
    fails, notes, stats = [], [], {}
    sticky_ok = w >= 1000 and h >= 521
    with sync_playwright() as pw:
        browser = getattr(pw, browser_name).launch()
        try:
            for state in STATES:
                ctx = make_context(browser, (w, h), dpr, touch)  # a fresh context per state: a context that has held a frozen page does not replay again
                try:
                    fs =first_screen if (w, h) in T009 and state in ("idle", "critic", "done") else None
                    page, sig, fs_problems = open_state(ctx, url, state, rec, fs)
                    if fs_problems:
                        fails.append(f"G10 {tag} {state}: " + "; ".join(fs_problems))
                    if state == "panel":
                        bad = check_panel(page, False)
                        if bad:
                            fails.append(f"G9 {tag} {state}: {bad}")
                    seen = scan(page, bool(touch))
                    found = {}
                    for info in seen:
                        for rule, msg in info["problems"]:
                            found.setdefault((rule, msg), set()).add(info["pos"])
                    for (rule, msg), pos in sorted(found.items()):
                        fails.append(f"{rule} {tag} {state}: {msg} [{','.join(sorted(pos))}]")
                    by = {i["pos"]: i for i in seen}
                    stats[state] = by["top"]["mastH"]
                    if state in ("critic", "synthesizer", "auditing"):
                        want = "Stop audit" if state == "auditing" else "Stop"
                        s = by["top"]["stop"]
                        if not s or s["text"] != want or not s["inHeader"] or not s["inView"]:
                            fails.append(f"G8 {tag} {state}: at top Stop is {s} (wanted {want!r} inside the masthead and on screen)")
                        for pos in ("mid", "bottom"):
                            i = by[pos]
                            if sticky_ok and not (i["stuck"] and i["stop"] and i["stop"]["inHeader"] and i["stop"]["inView"]):
                                fails.append(f"G8 {tag} {state}: at {pos} the masthead is not stuck with Stop on screen (stuck {i['stuck']}, Stop {i['stop']})")
                            if not sticky_ok and i["stuck"]:
                                fails.append(f"G8 {tag} {state}: at {pos} the masthead is stuck in a {w}x{h} window (only >=1000x521 may stick)")
                    if state in ("done", "panel"):
                        for i in seen[:1]:
                            sm = i["summary"]
                            if not sm:
                                fails.append(f"G12 {tag} {state}: no audit summary")
                            elif w >= 1200 and sm["left"] < sm["rright"] - 1:
                                fails.append(f"G12 {tag} {state}: the audit summary (left {sm['left']:.0f}) is not beside the report (right {sm['rright']:.0f}) at {w} px")
                            elif w < 1200 and sm["bottom"] > sm["rtop"] + 1:
                                fails.append(f"G12 {tag} {state}: the audit summary (bottom {sm['bottom']:.0f}) is not above the report (top {sm['rtop']:.0f}) at {w} px")
                    if sig is not None and page.evaluate(SIG) != sig:
                        fails.append(f"FROZEN {tag} {state}: the state moved from {sig} to {page.evaluate(SIG)} while it was measured")
                    if state == "auditing" and page.evaluate(CLICK_CLAIM):
                        bad = check_panel(page, True)
                        if bad:
                            fails.append(f"G9 {tag} {state}: a source panel opened now: {bad}")
                    out.mkdir(parents=True, exist_ok=True)
                    page.evaluate("() => scrollTo({top: 0, behavior: 'instant'})")
                    page.screenshot(path=str(out / f"{tag.replace(' ', '-')}-{state}.png"))
                    page.close()
                except Exception as e:
                    fails.append(f"{tag} {state}: could not reach or measure the state: {str(e).splitlines()[0][:160]}")
                ctx.close()
            ctx = make_context(browser, (w, h), dpr, touch)
            if stats.get("critic") is not None and stats.get("done") is not None and abs(stats["critic"] - stats["done"]) > 1:
                fails.append(f"G11 {tag}: the masthead is {stats['critic']:.0f} px tall in critic and {stats['done']:.0f} px in done")
            # G13: Start by keyboard puts focus on Stop and the page does not move
            try:
                page = ctx.new_page()
                held = []  # requests to /api/ are held open (never answered), so the run stays on; they are aborted before the page closes
                page.route(re.compile(r"/api/"), lambda r: held.append(r))
                page.goto(url + "?replay=off")
                poll(page, "() => !!document.querySelector('#research-query')", 20)
                page.focus("#research-query")
                page.keyboard.type("test topic")
                page.keyboard.press("Tab")
                at = page.evaluate("() => (document.activeElement?.textContent || '').trim()")
                y0 = page.evaluate("() => scrollY")
                page.keyboard.press("Enter")
                page.wait_for_timeout(500)
                now = page.evaluate("() => [(document.activeElement?.textContent || '').trim(), scrollY]")
                if not at.startswith("Start research") or now[0] != "Stop" or now[1] != y0:
                    fails.append(f"G13 {tag}: Tab reached {at!r}; after Enter focus is on {now[0]!r}, scrollY {y0} -> {now[1]} (wanted Start research, then Stop, no scroll)")
                for r in held:
                    with contextlib.suppress(Exception):
                        r.abort()
                page.close()
            except Exception as e:
                fails.append(f"G13 {tag}: {str(e).splitlines()[0][:160]}")
        finally:
            browser.close()
    return tag, fails


def devices(url, log, fail, first_screen, out, browser_name="chromium", rec=None, pool_size=12):
    start = time.time()
    jobs = [(url, browser_name, d, rec, first_screen, out) for d in DEVICES]
    with multiprocessing.get_context("spawn").Pool(pool_size) as pool:
        got = pool.map(device_task, jobs, chunksize=1)
    bad = 0
    for tag, fails in got:
        for f in fails:
            fail(f)
        bad += len(fails)
        if not fails:
            log(f"device {tag}: {len(STATES)} states x 3 scroll positions, G1-G4, G6, G8-G13 all pass")
    log(f"devices {browser_name}: {len(DEVICES)} rows done in {time.time() - start:.0f} s, {bad} problems; screenshots in {out}")


def run(url, log, fail, quick, first_screen, out, recording=None, browser_name="chromium", only=None):
    rec = P.published_replay(recording)
    if only != "devices" and not quick:
        sweep(url, log, fail, browser_name, rec)
    if only != "sweep":
        devices(url, log, fail, first_screen, Path(out) / "devices", browser_name, rec)


def main():
    import relay_a_dark_check as R
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True)
    ap.add_argument("--browser", default="chromium", choices=["chromium", "webkit"])
    ap.add_argument("--only", choices=["sweep", "devices"])
    ap.add_argument("--recording")
    ap.add_argument("--out", default=f"/tmp/any-device-{int(time.time())}")
    args = ap.parse_args()
    fails = []
    app_root = Path(__file__).resolve().parents[2]

    def fail(m):
        fails.append(m); print("FAIL", m, flush=True)

    with R.serve_dist(Path(args.dist).resolve(), R.netlify_csp(app_root)) as url:
        run(url, lambda m: print("ok  ", m, flush=True), fail, False, R.FIRST_SCREEN, args.out, args.recording, args.browser, args.only)
    print(f"\n{'FAILED: %d problems' % len(fails) if fails else 'PASSED'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
