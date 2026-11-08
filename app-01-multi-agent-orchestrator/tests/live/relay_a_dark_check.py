#!/usr/bin/env python3
"""AgentFlow in the Relay A dark look, checked as a cold visitor sees it, in a real Chromium (Python Playwright).

  python3 tests/live/relay_a_dark_check.py <draft URL> [--live] [--recording FILE] [--out DIR]
  python3 tests/live/relay_a_dark_check.py --dist dist          (serves the built app here, with the CSP of netlify.toml)

Per viewport (1440x900, 1280x800, 390x844, 360x740), in a fresh browser context each:
  idle page (?replay=off)         first screen has the task line, the 4 How-to steps and the chip 'Live data'
  default URL: at load, mid-replay, 2 s after the replay ends: the same three things inside the viewport, scrollY 0;
                the chip says 'Recorded data: <sources>' while the recording plays
  relay track: node n is active exactly while stage n runs, driven by the page's own steps data (logged in the page)
Once (at 1440x900): fonts loaded, 0 CSP errors, browser-reported colours equal the A dark hex values, every text/background
pair on the page >= 4.5:1 (>= 3:1 large text), tokens.css and components.css byte-identical to 1cb0af1.
--live types one real question on the page and needs fresh cited sources (a paid model call: run it once, on the draft copy).
--recording FILE plays that recording (a fresh run recorded on the draft copy) instead of the published one.
A contact sheet (each screenshot beside its A dark design screen) is written to --out.
"""
import argparse, base64, contextlib, functools, http.server, json, os, re, subprocess, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_COMMIT = "1cb0af1"
RAW = "https://raw.githubusercontent.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/replays/app-01-multi-agent-orchestrator.json"
DESIGN = Path.home() / "factory-hq/drafts/JDGAFX-T-013/A"
VIEWPORTS = [(1440, 900), (1280, 800), (390, 844), (360, 740)]
AGENTS = ["Researcher", "Analyst", "Critic", "Synthesizer"]
NODE_HEX = ["#6aa2ff", "#2dd4cf", "#ff9340", "#b6ee3c"]
BG, TEXT, BUTTON = "#07162b", "#eaf2ff", "#6aa2ff"
fails: list[str] = []


def fail(msg):
    fails.append(msg)
    print("FAIL", msg)


def ok(msg):
    print("ok  ", msg)


def rgb(hexcode):
    return "rgb(%d, %d, %d)" % tuple(int(hexcode[i:i + 2], 16) for i in (1, 3, 5))


# ---- in-page helpers -------------------------------------------------------------------------------------------------

# Logs every change of the relay nodes and of the status badge, so the order and the overlap with the running stage can be read afterwards.
LOGGER = """
window.__relayLog = [];
const read = () => ({
  t: performance.now(),
  badge: (document.querySelector('.ds-badge')?.textContent || '').trim(),
  nodes: [...document.querySelectorAll('[data-relay-node]')].map(n => n.getAttribute('data-state')),
});
const push = () => { const r = read(); const last = window.__relayLog[window.__relayLog.length - 1];
  if (!last || last.badge !== r.badge || last.nodes.join() !== r.nodes.join()) window.__relayLog.push(r); };
new MutationObserver(push).observe(document, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state']});
"""

FIRST_SCREEN = """() => {
  const vw = innerWidth, vh = innerHeight;
  const inside = (el, name) => {
    if (!el) return name + ' missing';
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) return name + ' not visible';
    if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) return name + ' outside the viewport (' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ' in ' + vw + 'x' + vh + ')';
    return null;
  };
  const problems = [inside(document.querySelector('#research-query'), 'task line')];
  const steps = [...document.querySelectorAll('.howto__steps li')];
  if (steps.length !== 4) problems.push('How-to steps: ' + steps.length + ' instead of 4');
  steps.forEach((li, i) => problems.push(inside(li, 'step ' + (i + 1))));
  problems.push(inside(document.querySelector('.live-data'), 'data chip'));
  if (scrollY !== 0) problems.push('scrollY is ' + scrollY);
  if (document.documentElement.scrollWidth > vw) problems.push('horizontal overflow ' + document.documentElement.scrollWidth + ' > ' + vw);
  return {problems: problems.filter(Boolean), chip: (document.querySelector('.live-data')?.textContent || '').trim()};
}"""

# Every text node's colour against the background actually behind it (alpha-composited up the ancestors); a gradient behind text is reported, not skipped.
CONTRAST = """() => {
  const parse = c => { const m = c.match(/[\\d.]+/g).map(Number); return {r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1}; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a);
    return a === 0 ? {r: 0, g: 0, b: 0, a: 0} : {r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a}; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const behind = el => { let bg = {r: 7, g: 22, b: 43, a: 1}; const chain = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) chain.push(e);
    let grad = false, op = 1;
    for (const e of chain.reverse()) { const s = getComputedStyle(e); op *= Number(s.opacity);
      if (s.backgroundImage !== 'none') grad = true;
      const c = parse(s.backgroundColor); if (c.a > 0) bg = over(c, bg); }
    return {bg, grad, op}; };
  const out = [], seen = new Set();
  const test = (el, text, fg) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') return;
    const {bg, grad, op} = behind(el);
    const f = over({...fg, a: fg.a * op}, bg);
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5, got = ratio(f, bg);
    const key = el.tagName + el.className + text + got.toFixed(2);
    if (seen.has(key)) return; seen.add(key);
    out.push({text: text.slice(0, 40), tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''), got: Math.round(got * 100) / 100, need, grad, ok: got >= need});
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim(); if (!t || !n.parentElement || n.parentElement.closest('script,style,noscript,title')) continue;
    test(n.parentElement, t, parse(getComputedStyle(n.parentElement).color));
  }
  for (const el of document.querySelectorAll('textarea,input')) {
    const s = getComputedStyle(el);
    test(el, el.value || el.placeholder || '(field)', parse(el.value ? s.color : getComputedStyle(el, '::placeholder').color));
  }
  return out;
}"""

COLOURS = """() => {
  const c = (el, p) => el ? getComputedStyle(el)[p] : null;
  return {bg: c(document.body, 'backgroundColor'), h1: c(document.querySelector('h1'), 'color'),
    h1font: c(document.querySelector('h1'), 'fontFamily'), bodyfont: c(document.body, 'fontFamily'),
    button: c(document.querySelector('button[type=submit]'), 'backgroundColor'),
    nodes: [...document.querySelectorAll('[data-relay-node] [data-relay-dot]')].map(d => getComputedStyle(d).borderTopColor),
    fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight),
    check800: document.fonts.check('800 54px "Plus Jakarta Sans"'), check500: document.fonts.check('500 14px Manrope')};
}"""


# ---- local server ------------------------------------------------------------------------------------------------------

@contextlib.contextmanager
def serve_dist(dist: Path, csp: str):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            p = Path(super().translate_path(path))
            return str(p if p.exists() and p.is_file() else dist / "index.html")

        def end_headers(self):
            self.send_header("Content-Security-Policy", csp)
            super().end_headers()

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()


def netlify_csp(root: Path) -> str:
    m = re.search(r'Content-Security-Policy\s*=\s*"([^"]+)"', (root / "netlify.toml").read_text())
    return m.group(1) if m else ""


# ---- the checks --------------------------------------------------------------------------------------------------------

def new_page(browser, size, errors, recording):
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, service_workers="block")
    page = ctx.new_page()
    page.add_init_script(LOGGER)
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    if recording:
        page.route(RAW, lambda route: route.fulfill(status=200, body=Path(recording).read_text(), headers={"content-type": "application/json", "access-control-allow-origin": "*"}))
    return ctx, page


def wait_ended(page, seconds):
    """Polls with evaluate, which the page's CSP allows; wait_for_function would need unsafe-eval."""
    end = time.time() + seconds
    while time.time() < end:
        if page.evaluate("() => document.querySelector('.ds-app')?.dataset.run === 'done' && document.querySelector('.ds-badge')?.textContent.trim() !== 'Auditing'"):
            return
        page.wait_for_timeout(250)
    raise TimeoutError("the run did not end")


def first_screen(page, tag, want_chip):
    res = page.evaluate(FIRST_SCREEN)
    if res["problems"]:
        fail(f"{tag}: " + "; ".join(res["problems"]))
    elif not re.match(want_chip, res["chip"]):
        fail(f"{tag}: chip reads {res['chip']!r}, wanted /{want_chip}/")
    else:
        ok(f"{tag}: task line, 4 steps and chip in view at scrollY 0; chip {res['chip']!r}")


def check_relay_log(page, tag):
    log = page.evaluate("() => window.__relayLog")
    first_active, bad = {}, []
    for e in log:
        active = [AGENTS[i] for i, s in enumerate(e["nodes"]) if s == "active"]
        running = re.match(r"Running: (\w+)", e["badge"])
        want = [running.group(1)] if running and running.group(1) in AGENTS else []
        if active != want and not (e["badge"] == "Auditing" and not active):
            if not (not want and not active):
                bad.append(f"badge {e['badge']!r} but active nodes {active}")
        for a in active:
            first_active.setdefault(a, e["t"])
    order = sorted(first_active, key=first_active.get)
    if bad:
        fail(f"{tag}: relay node not in step with the running stage: {bad[:3]}")
    elif order != AGENTS:
        fail(f"{tag}: relay nodes became active in order {order}, wanted {AGENTS} (log of {len(log)} changes)")
    else:
        ok(f"{tag}: relay node n active exactly while stage n runs, in order {order}")


def run_viewport(browser, url, size, recording, out, shots):
    w, h = size
    tag = f"{w}x{h}"
    phone = w < 700
    # idle: no replay, as a visitor sees it when no recording is fresh
    errors = []
    ctx, page = new_page(browser, size, errors, recording)
    page.goto(url + ("&" if "?" in url else "?") + "replay=off")
    page.wait_for_selector(".live-data")
    page.evaluate("() => document.fonts.ready.then(() => true)")
    first_screen(page, f"{tag} idle", r"^Live data")
    page.screenshot(path=str(out / f"{tag}-idle.png"))
    shots.append((tag, "idle", out / f"{tag}-idle.png", "phone-dark-first.png" if phone else "laptop-dark-first.png"))
    ctx.close()

    # cold visit: the default URL plays the stored real run
    errors = []
    ctx, page = new_page(browser, size, errors, recording)
    page.goto(url)
    page.wait_for_selector(".live-data")
    first_screen(page, f"{tag} at load", r"^(Live|Recorded) data")
    page.screenshot(path=str(out / f"{tag}-load.png"))
    shots.append((tag, "load", out / f"{tag}-load.png", "phone-dark-first.png" if phone else "laptop-dark-first.png"))
    try:
        page.wait_for_selector("[data-relay-node][data-state=active]", timeout=40000)
    except Exception:
        fail(f"{tag}: no replay started on the default URL (no relay node became active)")
        ctx.close()
        return errors
    page.wait_for_timeout(300)
    first_screen(page, f"{tag} mid-replay", r"^Recorded data: .+")
    page.screenshot(path=str(out / f"{tag}-mid.png"))
    shots.append((tag, "mid-replay", out / f"{tag}-mid.png", "phone-dark-first.png" if phone else "laptop-dark-first.png"))
    try:
        wait_ended(page, 120)
    except Exception:
        fail(f"{tag}: the replay did not end within 120 s")
        ctx.close()
        return errors
    page.wait_for_timeout(2000)
    first_screen(page, f"{tag} 2 s after the replay", r"^Recorded data: .+")
    page.screenshot(path=str(out / f"{tag}-after.png"))
    page.screenshot(path=str(out / f"{tag}-after-full.png"), full_page=True)
    shots.append((tag, "2 s after", out / f"{tag}-after.png", "phone-dark-first.png" if phone else "laptop-dark-first.png"))
    shots.append((tag, "full result", out / f"{tag}-after-full.png", "phone-dark-result.png" if phone else "laptop-dark-result.png"))
    check_relay_log(page, tag)
    if w == 1440:
        page.evaluate("() => document.fonts.ready.then(() => true)")
        colours = page.evaluate(COLOURS)
        if colours["bg"] != rgb(BG) or colours["h1"] != rgb(TEXT) or colours["button"] != rgb(BUTTON):
            fail(f"colours: page {colours['bg']}, heading {colours['h1']}, main button {colours['button']}; wanted {rgb(BG)}, {rgb(TEXT)}, {rgb(BUTTON)}")
        elif colours["nodes"] != [rgb(x) for x in NODE_HEX]:
            fail(f"relay node colours {colours['nodes']}, wanted {[rgb(x) for x in NODE_HEX]}")
        else:
            ok(f"colours equal the A dark values: page {BG}, heading {TEXT}, button {BUTTON}, nodes {NODE_HEX}")
        loaded = " ".join(colours["fonts"])
        if not (colours["check800"] and colours["check500"] and "Plus Jakarta Sans 800" in loaded and "Manrope 500" in loaded):
            fail(f"fonts: check800 {colours['check800']}, check500 {colours['check500']}, loaded {colours['fonts']}")
        elif not colours["h1font"].startswith(("\"Plus Jakarta Sans\"", "Plus Jakarta Sans")) or not colours["bodyfont"].startswith(("Manrope", "\"Manrope\"")):
            fail(f"fonts not applied: heading {colours['h1font']}, body {colours['bodyfont']}")
        else:
            ok("fonts: Plus Jakarta Sans 800 and Manrope 500 loaded and applied")
        rows = page.evaluate(CONTRAST)
        low = [r for r in rows if not r["ok"]]
        if not rows:
            fail("contrast: no text found")
        elif low:
            fail(f"contrast: {len(low)} of {len(rows)} text/background pairs under the limit: " + "; ".join(f"{r['tag']} {r['text']!r} {r['got']}<{r['need']}" for r in low[:8]))
        else:
            ok(f"contrast: all {len(rows)} text/background pairs on the page pass (lowest {min(r['got'] for r in rows)}:1)")
    css = [e for e in errors if "Content Security Policy" in e or "CSP" in e]
    other = [e for e in errors if e not in css]
    if css:
        fail(f"{tag}: {len(css)} CSP console errors: {css[:2]}")
    if other:
        fail(f"{tag}: console/page errors: {other[:3]}")
    ctx.close()
    return errors


def live_question(browser, url, size, out):
    errors = []
    ctx, page = new_page(browser, size, errors, None)
    page.goto(url + ("&" if "?" in url else "?") + "replay=off")
    page.wait_for_selector("#research-query")
    question = "What are the main differences between SQLite and PostgreSQL?"
    page.fill("#research-query", question)
    started = time.time()
    page.click("button[type=submit]")
    wait_ended(page, 150)
    page.wait_for_timeout(1000)
    chip = page.inner_text(".live-data").strip()
    links = page.eval_on_selector_all(".source-list li a.ds-cite__title", "els => els.map(e => [e.textContent, e.href])")
    page.screenshot(path=str(out / "live-question.png"), full_page=True)
    m = re.search(r"fetched (\d\d):(\d\d)", chip)
    fresh = False
    if m:
        now = time.localtime()
        fresh = abs((now.tm_hour * 60 + now.tm_min) - (int(m.group(1)) * 60 + int(m.group(2)))) <= 2
    if not chip.startswith("Live data:") or not fresh or len(links) < 2 or not all(u.startswith("http") for _, u in links):
        fail(f"live question: chip {chip!r}, fresh {fresh}, {len(links)} cited sources")
    else:
        ok(f"live question ({time.time() - started:.0f} s): chip {chip!r}; {len(links)} cited sources, e.g. {links[0][0][:50]!r} {links[0][1]}")
    if errors:
        fail(f"live question console errors: {errors[:2]}")
    ctx.close()


def contact_sheet(browser, shots, out):
    cells = []
    for tag, state, shot, design in shots:
        a = base64.b64encode(shot.read_bytes()).decode()
        b = base64.b64encode((DESIGN / design).read_bytes()).decode()
        cells.append(f"<div class=c><h3>{tag} {state}: built (left) | A dark design (right)</h3><img src='data:image/png;base64,{a}'><img src='data:image/png;base64,{b}'></div>")
    html = "<style>body{background:#07162b;color:#eaf2ff;font:14px sans-serif;margin:8px}.c{margin:0 0 24px}img{height:420px;max-width:48%;object-fit:contain;object-position:top;margin-right:8px;border:1px solid #1f3a5f}</style>" + "".join(cells)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.set_content(html)
    page.screenshot(path=str(out / "contact-sheet.png"), full_page=True)
    page.close()
    ok(f"contact sheet: {out / 'contact-sheet.png'} ({len(shots)} screenshots, each beside its design screen)")


def tokens_unchanged():
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    r = subprocess.run(["git", "diff", BASE_COMMIT, "--", "*/tokens.css", "*/components.css"], capture_output=True, text=True, cwd=root)
    if r.returncode or r.stdout.strip():
        fail(f"tokens.css / components.css differ from {BASE_COMMIT}: {r.stdout[:200] or r.stderr[:200]}")
    else:
        ok(f"git diff {BASE_COMMIT} -- '*/tokens.css' '*/components.css' is empty")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", nargs="?")
    ap.add_argument("--dist")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--recording")
    ap.add_argument("--out", default=f"/tmp/relay-a-dark-check-{int(time.time())}")
    args = ap.parse_args()
    if bool(args.url) == bool(args.dist):
        ap.error("give a draft URL or --dist <dir>")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    app_root = Path(__file__).resolve().parents[2]
    shots: list = []
    with contextlib.ExitStack() as stack:
        url = args.url or stack.enter_context(serve_dist(Path(args.dist).resolve(), netlify_csp(app_root)))
        pw = stack.enter_context(sync_playwright())
        browser = pw.chromium.launch()
        for size in VIEWPORTS:
            run_viewport(browser, url, size, args.recording, out, shots)
        if args.live:
            live_question(browser, url, (1440, 900), out)
        contact_sheet(browser, shots, out)
        browser.close()
    tokens_unchanged()
    print(f"evidence in {out}")
    if fails:
        print(f"\nFAILED: {len(fails)} problems")
        return 1
    print("\nPASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
