"""UI test for the induction-machine tools (iPhone 13 and iPad emulation, Chromium). Serve dist/ on :8765 first."""
import os, json
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
from playwright.sync_api import sync_playwright
URL = "http://localhost:8765/"
errors, results = [], {}
def check(name, cond, detail=""):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

CHAP = {"V": "460", "f": "60", "poles": "4", "R1": "0,641", "X1": "1,106", "R2": "0,332", "X2": "0,464", "Xm": "26,3", "Pfw": "1100",
        "s": "0,022", "tbl": "0,01;0,022;0,2;1"}
def fill(page, vals):
    page.evaluate("""(v) => { const e = __eecalc.energy; for (const ed of e.fields) if (ed.key in v) ed.set(v[ed.key]); e.compute(); }""", vals)
    page.wait_for_timeout(60)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-precise-memory-info", "--js-flags=--expose-gc"])
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
    reqs = []
    page.on("request", lambda r: reqs.append(r.url.rsplit("/", 1)[-1]))
    page.goto(URL); page.wait_for_selector("#pad .k"); page.wait_for_timeout(300)
    startup = set(reqs)
    page.evaluate("__eecalc.show('energy')"); page.wait_for_timeout(100)
    check("energy list has 15 tools, machine tools listed", page.locator(".tool").count() == 15 and
          page.locator(".tool", has_text="Induction machine: operating point").count() == 1)
    before = len(reqs)
    page.locator(".tool", has_text="Induction machine: operating point").tap()
    page.wait_for_selector(".fields .editor"); page.wait_for_timeout(100)
    lazy = [r for r in reqs[before:] if r.startswith("c-")]
    check("machine formulas load on first open only", len(lazy) == 1 and lazy[0] not in startup, (lazy, sorted(startup)))
    check("title shows the tool", page.inner_text("#title") == "Induction machine: operating point")
    check("two selectors (connection, circuit)", page.locator(".fields .seg").count() == 2)
    # type V on the keypad, the rest programmatically
    page.locator(".fields .editor").nth(0).tap()
    for k in ["4", "6", "0"]:
        btns = page.locator("#pad .k")
        for i in range(btns.count()):
            if btns.nth(i).inner_text().strip() == k: btns.nth(i).tap(); break
    check("keypad types into the first field", page.evaluate("__eecalc.energy.fields[0].text") == "460")
    fill(page, CHAP)
    res = page.inner_text(".results")
    check("Chapman Ex. 6-3 on screen", "1760,4 rpm" in res and "18,89194" in res and "83,6585" in res and "56,8398" in res, res[:400])
    check("section headings", "Operating point" in res and "Machine" in res)
    rows = page.locator(".rtab tr").count()
    check("slip table: header + 4 rows", rows == 5, rows)
    cell = page.locator(".rtab td").nth(2 * 5 + 2).inner_text()      # row s = 0,2, column T_em
    check("table cell shows T_em at s = 0,2", cell.startswith("230,79"), cell)
    page.screenshot(path="/home/claude/im_op_top.png")
    page.locator(".results").scroll_into_view_if_needed(); page.evaluate("document.querySelector('.rtab').scrollIntoView()")
    page.screenshot(path="/home/claude/im_op_table.png")
    over = page.evaluate("document.scrollingElement.scrollWidth - innerWidth")
    check("no horizontal page overflow on iPhone", over <= 0, over)
    # connection selector recomputes
    i_y = page.locator(".res", has_text="I₁").first.inner_text()
    page.locator(".fields .seg").nth(0).locator("button", has_text="Delta").tap(); page.wait_for_timeout(80)
    i_d = page.locator(".res", has_text="I₁").first.inner_text()
    check("Δ selector recomputes (I₁ changes)", i_y != i_d and "A" in i_d, (i_y, i_d))
    page.locator(".fields .seg").nth(0).locator("button", has_text="Star").tap(); page.wait_for_timeout(80)
    # reverse solve and its error message
    fill(page, {"s": "", "Pout": "10478,353"})
    check("reverse solve from P out gives s ≈ 0,022", "0,02199999957" in page.locator(".res", has_text="motor").first.inner_text())
    fill(page, {"Pout": "", "Tl": "1M"})
    msg = page.inner_text(".results")
    check("impossible load → clear message", "No stable operating point" in msg and "T_max" in msg, msg[:200])
    fill(page, {"Tl": "", "s": "0,022"})
    # tap a table cell → calculator variable with the exact value
    page.locator(".rtab td").nth(2 * 5 + 2).tap(); page.wait_for_timeout(80)
    check("table cell → calculator variable", page.evaluate("__eecalc.st.view") == "calc" and page.evaluate("__eecalc.main.text") == "T_t3")
    page.evaluate("__eecalc.key('exe')"); page.wait_for_timeout(80)
    out = page.locator(".entry").last.locator(".out").first.inner_text()
    check("stored value is exact", out.startswith("230,797"), out)
    # parameters from tests (Chapman Ex. 6-8)
    page.evaluate("__eecalc.show('energy', 'imtest')"); page.wait_for_selector(".fields .editor")
    fill(page, {"f": "60", "R1": "13,6/(2*28)", "V0": "208", "I0": "8,17", "P0": "420", "Vlr": "25", "Ilr": "27,9", "Plr": "920", "flr": "15"})
    res = page.inner_text(".results")
    check("test reduction on screen (R₁, P_Fe)", "242,857142" in res and "371,368658" in res, res[:300])
    check("three selectors (connection, circuit, class)", page.locator(".fields .seg").count() == 3)
    page.locator(".fields .seg").nth(2).locator("button", has_text="B").tap(); page.wait_for_timeout(80)
    x1 = page.locator(".res", has_text="X₁").first.inner_text(); x2 = page.locator(".res", has_text="X₂′").first.inner_text()
    check("design class B splits 0,4 / 0,6", "536," in x1 and "804," in x2, (x1, x2))
    page.screenshot(path="/home/claude/im_test.png")
    # memory: 300 recomputations of the table case
    page.evaluate("__eecalc.show('energy', 'imop')"); page.wait_for_selector(".fields .editor"); fill(page, CHAP)
    m = page.evaluate("""() => { const e = __eecalc.energy; gc(); const h0 = performance.memory.usedJSHeapSize, n0 = document.getElementsByTagName('*').length;
        const t0 = performance.now(); for (let i = 0; i < 300; i++) { e.fields.find(f => f.key === 's').set(String(0.001 + i / 1000).replace('.', ',')); e.compute(); }
        const ms = (performance.now() - t0) / 300; gc();
        return {ms, heap: (performance.memory.usedJSHeapSize - h0) / 1e6, nodes: document.getElementsByTagName('*').length - n0}; }""")
    check(f"recompute with table ≤ 15 ms in the browser (measured {m['ms']:.1f} ms)", m["ms"] <= 15, m)
    check(f"no leak over 300 recomputes (heap {m['heap']:+.2f} MB, DOM {m['nodes']:+d})", m["heap"] < 2 and abs(m["nodes"]) < 5, m)
    store = page.evaluate("({ls: localStorage.length, ss: sessionStorage.length, cookies: document.cookie})")
    check("only the profile is stored", store == {"ls": 1, "ss": 0, "cookies": ""} and page.evaluate("localStorage.key(0)") == "eecalc.profile", store)
    # offline: the lazily loaded machine module must come from the service-worker cache
    page.evaluate("navigator.serviceWorker.ready"); page.reload(); page.wait_for_selector("#pad .k")
    ctx.set_offline(True); page.reload(); page.wait_for_selector("#pad .k", timeout=5000)
    page.evaluate("__eecalc.show('energy', 'imop')"); page.wait_for_selector(".fields .editor", timeout=5000); fill(page, CHAP)
    check("machine tool works offline", "1760,4 rpm" in page.inner_text(".results"))
    ctx.set_offline(False)
    # iPad landscape and portrait
    for name, vp in (("ipad_landscape", {"width": 1180, "height": 820}), ("ipad_portrait", {"width": 820, "height": 1180})):
        c2 = b.new_context(viewport=vp, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = c2.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL); pg.wait_for_selector("#pad .k")
        pg.evaluate("__eecalc.show('energy', 'imop')"); pg.wait_for_selector(".fields .editor"); fill(pg, CHAP)
        pg.screenshot(path=f"/home/claude/im_{name}.png")
        ov = pg.evaluate("document.scrollingElement.scrollWidth - innerWidth")
        check(f"{name}: results and table, no overflow", "1760,4 rpm" in pg.inner_text(".results") and pg.locator(".rtab tr").count() == 5 and ov <= 0, ov)
        c2.close()
    check("no console or page errors", not errors, errors[:5])
    b.close()
print(f"\n{sum(results.values())}/{len(results)} passed")
