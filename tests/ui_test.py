import os, json, time, sys
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
from playwright.sync_api import sync_playwright
URL = "http://localhost:8765/"
errors, results = [], {}
def check(name, cond, detail=""):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def tap_key(page, label):
    page.locator("#pad .k", has_text=label).filter(has=None).first.tap() if False else None
    btns = page.locator("#pad .k")
    for i in range(btns.count()):
        if btns.nth(i).inner_text().strip() == label:
            btns.nth(i).tap(); return
    raise Exception("no key " + label)

def type_keys(page, seq):
    for k in seq: tap_key(page, k)

with sync_playwright() as p:
    b = p.chromium.launch()
    _nc = b.new_context
    def _seeded(**kw):
        c = _nc(**kw)
        c.add_init_script("if (!localStorage.getItem('eecalc.profile')) localStorage.setItem('eecalc.profile', JSON.stringify({name: 'Tester', tag: Math.floor(4096 + Math.random() * 61439).toString(16), xp: 0}));")
        return c
    b.new_context = _seeded
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1")
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    t0 = time.time(); page.goto(URL); page.wait_for_selector("#pad .k")
    check("loads and shows 30 keys", page.locator("#pad .k").count() == 30)
    # the user's example, typed on the keypad
    type_keys(page, ["3", "4", ",", "5", "∠", "9", "8", "−", "6", "3", "∠", "3"])
    tap_key(page, "fn"); tap_key(page, "rad")
    page.wait_for_timeout(150)
    prev = page.inner_text("#preview")
    check("live preview while typing", "57,5680553 + j25,27368786" in prev, prev)
    tap_key(page, "=")
    page.wait_for_timeout(100)
    out = page.locator(".entry .out").all_inner_texts()
    check("result in history (rect + polar)", out[:2] == ["57,5680553 + j25,27368786", "62,87161752 ∠ 23,70256875°"], out)
    check("expression line cleared", page.evaluate("__eecalc.main.text") == "")
    # tap a result to reuse it, then edit with ◀ and ⌫
    page.locator(".entry .out").first.tap()
    check("tap result inserts it", page.evaluate("__eecalc.main.text") == "57,5680553 + j25,27368786")
    tap_key(page, "◀"); tap_key(page, "⌫")
    check("cursor keys and delete", page.evaluate("__eecalc.main.text") == "57,5680553 + j25,2736876")
    page.locator("#pad .k").nth(4).dispatch_event("pointerdown")      # hold ⌫ to clear
    page.wait_for_timeout(650); page.locator("#pad .k").nth(4).dispatch_event("pointerup")
    check("hold ⌫ clears the line", page.evaluate("__eecalc.main.text") == "")
    # assignment through the fn page, then use of the variable
    page.evaluate("__eecalc.main.set('Z1 = 4k7 + j2k2')"); tap_key(page, "=")
    page.evaluate("__eecalc.main.set('Z1 // 10k∠-30')"); tap_key(page, "=")
    last = page.locator(".entry").last.locator(".out").all_inner_texts()
    check("variables and parallel operator", last and last[0].startswith("3773,930841"), last)
    # tap-to-place caret inside the expression line
    page.evaluate("__eecalc.main.set('123456789')")
    box = page.locator("#expr").bounding_box()
    page.mouse.click(box["x"] + 14 + 3.5 * 15.6, box["y"] + box["height"] / 2)
    caret = page.evaluate("__eecalc.main.caret")
    check("tap places the caret inside the line", 1 <= caret <= 6, caret)
    page.evaluate("__eecalc.main.clear()")
    # error display
    page.evaluate("__eecalc.main.set('1/0')"); tap_key(page, "=")
    check("errors are reported, not evaluated", "Division by zero" in page.inner_text("#preview"))
    page.evaluate("__eecalc.main.clear()")
    # long-press on a history entry opens the action sheet
    page.locator(".entry .out").first.dispatch_event("pointerdown")
    page.wait_for_timeout(600)
    page.locator(".entry .out").first.dispatch_event("pointerup")
    check("long-press opens actions", page.is_visible("#sheet") and "Copy full precision" in page.inner_text("#sheet"))
    page.locator("#sheet .act", has_text="Cancel").tap()
    page.screenshot(path="/home/claude/shot_iphone_calc.png")
    # fn page screenshot
    tap_key(page, "fn"); page.screenshot(path="/home/claude/shot_iphone_fn.png"); tap_key(page, "fn")
    # energy tools
    page.evaluate("__eecalc.show('energy')"); page.wait_for_timeout(100)
    check("energy list, keypad hidden", page.locator(".tool").count() == 15 and not page.is_visible("#pad"))
    page.locator(".tool", has_text="Three-phase power").tap()
    eds = page.locator(".fields .editor")
    eds.nth(0).tap(); type_keys(page, ["4", "0", "0"])
    tap_key(page, "=")                       # next field
    type_keys(page, ["1", "0", "0", "∠", "−", "3", "6", ",", "8", "7"])
    page.wait_for_timeout(200)
    res = page.inner_text(".results")
    check("three-phase power result", "55,42555158k + j41,56931839k VA" in res and "lagging" in res, res[:200])
    page.screenshot(path="/home/claude/shot_iphone_tool.png")
    page.locator(".res", has_text="VA").first.tap()
    check("tap result → calculator with variable", page.evaluate("__eecalc.st.view") == "calc" and page.evaluate("__eecalc.main.text") == "S")
    tap_key(page, "=")
    check("stored value is exact", page.locator(".entry").last.locator(".out").first.inner_text() == "55425,55158 + j41569,31839")
    page.evaluate("__eecalc.show('vars')"); page.wait_for_timeout(100)
    check("variables view", "S" in page.inner_text("#v-vars") and "Z1" in page.inner_text("#v-vars"))
    page.evaluate("__eecalc.show('help')"); page.wait_for_timeout(100)
    check("help view", "Precision" in page.inner_text("#v-help") and "Privacy" in page.inner_text("#v-help"))
    page.evaluate("__eecalc.show('calc')"); page.wait_for_timeout(100)
    # settings
    page.locator("#s-unit").tap()
    check("radians switch re-renders history", "rad" in page.inner_text("#history"))
    page.locator("#s-unit").tap()
    # nothing stored
    store = page.evaluate("({ls: localStorage.length, ss: sessionStorage.length, cookies: document.cookie})")
    check("only the profile is stored", store == {"ls": 1, "ss": 0, "cookies": ""} and page.evaluate("localStorage.key(0)") == "eecalc.profile", store)
    # in-browser golden subset through the bundled engine
    gold = json.load(open("/home/claude/webapp/tests/golden.json"))
    subset = [c for c in gold["cases"] if c["group"] == "hand"][:400]
    mism = page.evaluate("""([cases, setup]) => { const {E} = __eecalc; let bad = [];
      for (const c of cases) { const eng = new E.Engine(); eng.angleUnit = c.unit; for (const s of setup) eng.evaluate(s); eng.evaluate('7∠10');
        let js; try { const r = eng.evaluate(c.text); js = {ok: true, f12: E.formatValue(r.value, c.unit, 12, 'auto').map(x => x[0])}; }
        catch (e) { js = {ok: false, msg: e.msg}; }
        const same = c.py.ok ? (js.ok && JSON.stringify(js.f12) === JSON.stringify(c.py.f12)) : (!js.ok && js.msg === c.py.msg);
        if (!same) bad.push(c.text); } return bad; }""", [subset, gold["setup"]])
    check(f"bundled engine in browser matches Python ({len(subset)} cases)", not mism, mism[:5])
    # performance and memory: 1500 Enter presses with live preview
    stats = page.evaluate("""() => { const g = __eecalc; const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const t0 = performance.now(); for (let i = 0; i < 1500; i++) { g.main.set(`${i % 97 + 1}∠${i % 360} // ${(i % 13) + 1}k7`); g.key('exe'); }
      const dt = (performance.now() - t0) / 1500; const nodes = document.getElementsByTagName('*').length;
      return {ms: dt, nodes, entries: document.querySelectorAll('.entry').length, heapMB: performance.memory ? (performance.memory.usedJSHeapSize - heap0) / 1e6 : null}; }""")
    check("history capped at 200 entries", stats["entries"] == 200, stats)
    check(f"Enter + render ≤ 10 ms (measured {stats['ms']:.2f} ms)", stats["ms"] <= 10, stats)
    page.evaluate("() => { if (window.gc) gc(); }")
    heap2 = page.evaluate("""() => { const g = __eecalc; const h0 = performance.memory.usedJSHeapSize;
      for (let i = 0; i < 1500; i++) { g.main.set(`${i % 97 + 1}∠${i % 360} // ${(i % 13) + 1}k7`); g.key('exe'); }
      return (performance.memory.usedJSHeapSize - h0) / 1e6; }""")
    nodes2 = page.evaluate("document.getElementsByTagName('*').length")
    check(f"no leak: DOM nodes stable ({stats['nodes']} → {nodes2})", abs(nodes2 - stats["nodes"]) < 20)
    check(f"no leak: heap growth over 1500 more runs {heap2:+.1f} MB", heap2 < 8)
    # offline: service worker caches the app; reload with the network off
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null || (location.reload(), false)", timeout=8000) if False else None
    page.evaluate("navigator.serviceWorker.ready")
    page.reload(); page.wait_for_selector("#pad .k")
    ctx.set_offline(True)
    page.reload(); page.wait_for_selector("#pad .k", timeout=5000)
    page.evaluate("__eecalc.main.set('sqrt(-4)')"); page.evaluate("__eecalc.key('exe')")
    check("works offline after first load", page.locator(".entry .out").first.inner_text() == "j2")
    check("memory is wiped when the app restarts", page.evaluate("__eecalc.eng.vars.size") == 0)
    ctx.set_offline(False)
    # iPad layouts
    for name, vp in (("ipad_portrait", {"width": 820, "height": 1180}), ("ipad_landscape", {"width": 1180, "height": 820})):
        c2 = b.new_context(viewport=vp, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = c2.new_page(); pg.goto(URL); pg.wait_for_selector("#pad .k")
        for s in ["Y = [2-j5 | -1+j2 ; -1+j2 | 3-j6]", "inv(Y)", "34,5∠98 - 63∠3 rad", "seq(1∠0; 1∠-110; 0,9∠125)"]:
            pg.evaluate(f"__eecalc.main.set({json.dumps(s)})"); pg.evaluate("__eecalc.key('exe')")
        pg.evaluate("__eecalc.main.set('Z1 // 10∠-30')"); pg.wait_for_timeout(150)
        pg.screenshot(path=f"/home/claude/shot_{name}.png")
        pad = pg.locator("#pad").bounding_box()
        check(f"{name}: keypad placement", (pad["x"] > vp["width"] / 2) if name.endswith("landscape") else (pad["y"] > vp["height"] / 2), pad)
        c2.close()
    b.close()
check("no JavaScript errors", not errors, errors[:3])
print(f"\n{sum(results.values())}/{len(results)} checks passed")
