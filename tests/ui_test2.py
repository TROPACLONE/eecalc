import os, json, re, sys
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
from playwright.sync_api import sync_playwright
URL = "http://localhost:8765/"
REF = json.load(open("/home/claude/webapp/tests/pf_ref.json")); SC = json.load(open("/home/claude/webapp/tests/sc_ref.json"))
results, errors = {}, []
def check(name, cond, detail=""):
    results[name] = bool(cond); print(("PASS " if cond else "FAIL ") + name + (f"  [{str(detail)[:300]}]" if not cond else ""), flush=True)
IPHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, bypass_csp=True)
def tap_key(page, label):
    btns = page.locator("#pad .k")
    for i in range(btns.count()):
        if btns.nth(i).inner_text().strip() == label: btns.nth(i).tap(); return
    raise Exception("no key " + label)
def menu(page, *path):
    page.locator("#menu-btn").tap()
    for p in path:
        it = page.locator("#sheet .mi", has_text=re.compile("^" + re.escape(p))).first
        if "grp" in (it.get_attribute("class") or "") and "open" in (it.get_attribute("class") or ""): continue   # already expanded
        it.tap()
        page.wait_for_timeout(150)
def discard_if_asked(page):
    page.wait_for_timeout(150)
    if page.locator("#sheet .act", has_text="Discard").count(): page.locator("#sheet .act", has_text="Discard").tap(); page.wait_for_timeout(150)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    _nc = b.new_context
    def _seeded(**kw):
        c = _nc(**kw)
        c.add_init_script("if (!localStorage.getItem('eecalc.profile')) localStorage.setItem('eecalc.profile', JSON.stringify({name: 'Tester', tag: Math.floor(4096 + Math.random() * 61439).toString(16), xp: 0}));")
        return c
    b.new_context = _seeded
    ctx = b.new_context(**IPHONE, accept_downloads=True)
    ctx.add_init_script("window.__EECALC_BROKERS = ['ws://localhost:8899/mqtt'];")
    page = ctx.new_page(); page.set_default_timeout(15000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL); page.wait_for_selector("#pad .k")
    for k in ["3", "4", ",", "5", "∠", "9", "8", "−", "6", "3", "∠", "3"]: tap_key(page, k)
    tap_key(page, "fn"); tap_key(page, "rad"); tap_key(page, "=")
    check("calculator still exact", page.locator(".entry .out").first.inner_text() == "57,5680553 + j25,27368786")
    page.locator("#menu-btn").tap(); page.screenshot(path="/home/claude/m_menu.png")
    page.locator("#sheet .mi", has_text="Energy tools").tap(); page.wait_for_timeout(150)
    page.screenshot(path="/home/claude/m_menu_open.png")
    page.locator("#sheet .mi", has_text="Three-phase power").tap()
    check("menu opens a tool directly; title shows it", page.inner_text("#title") == "Three-phase power")
    page.locator(".fields .editor").nth(0).tap()
    for k in ["4", "0", "0", "=", "1", "0", "0"]: tap_key(page, k)
    page.wait_for_timeout(200)
    page.locator(".res").first.tap()
    check("tool result → calculator variable", page.evaluate("__eecalc.st.view") == "calc" and page.evaluate("__eecalc.main.text") == "S")
    page.evaluate("__eecalc.main.clear()")
    # ── case editor
    menu(page, "Network", "Case editor"); page.wait_for_selector("table.grid")
    check("case editor opens with the WSCC 9-bus example", "WSCC 9-bus" in page.inner_text(".casename") and page.locator("table.grid tbody tr").count() == 9)
    check("keypad hidden until a cell is edited", not page.is_visible("#pad"))
    page.locator("table.grid tbody tr").nth(4).locator("td").nth(4).tap()
    check("tapping a cell opens the cell editor and the keypad", page.is_visible(".celledit") and page.is_visible("#pad"))
    for k in ["⌫", "⌫", "1", "0", "0", "="]: tap_key(page, k)
    check("= commits and moves to the next row", page.locator("table.grid tbody tr").nth(4).locator("td").nth(4).inner_text() == "100" and "row 6" in page.inner_text(".celllabel"))
    page.locator(".cellbtn.muted").tap()
    check("edited case is marked not saved", "Not saved" in page.inner_text(".badge"))
    page.screenshot(path="/home/claude/m_case.png")
    with page.expect_download() as dl:
        page.locator(".btn", has_text="Save").tap()
    saved_path = dl.value.path(); saved = json.loads(open(saved_path).read())
    check("save writes an EE Calc case file", saved["format"] == "eecalc-case" and saved["case"]["buses"][4]["pd"] == "100")
    page.wait_for_timeout(200)
    check("saved case no longer marked unsaved", "Not saved" not in page.inner_text(".badge"))
    # ── power flow on IEEE 14
    page.locator(".btn", has_text="Examples").tap(); page.locator("#sheet .act", has_text="IEEE 14-bus").tap(); discard_if_asked(page)
    menu(page, "Network", "Power flow")
    page.locator(".btn.big").tap(); page.wait_for_selector(".status.ok")
    stt = page.inner_text(".status.ok")
    check("power flow: Newton converged in 4 iterations, verified", "converged in 4 iterations" in stt and "verified (42 digits)" in stt, stt)
    page.locator(".seg button", has_text="Buses").tap()
    rows = page.locator("table.grid tbody tr")
    vm = [float(rows.nth(k).locator("td").nth(2).inner_text().replace(",", ".")) for k in range(14)]
    check("bus voltages match PYPOWER (6 digits)", all(abs(v - r) < 5e-6 for v, r in zip(vm, REF["case14"]["vm"])), list(zip(vm, REF["case14"]["vm"]))[:3])
    page.screenshot(path="/home/claude/m_pf_buses.png")
    page.locator(".seg button", has_text="Iterations").tap()
    check("iteration log with voltages and Jacobian", page.locator("table.grid").count() >= 2)
    page.locator(".seg button", has_text="Summary").tap()
    page.locator(".btn", has_text="Send Vbus and Ybus").tap()
    check("Ybus and Vbus sent to the calculator", page.evaluate("__eecalc.eng.vars.get('Ybus').rows") == 14 and page.evaluate("__eecalc.eng.vars.get('Vbus').rows") == 14)
    page.evaluate("__eecalc.main.set('abs(Vbus(14))')"); tap_key(page, "=")
    v14 = float(page.locator(".entry").last.locator(".out").first.inner_text().replace(",", "."))
    check("calculator uses the network result", abs(v14 - REF["case14"]["vm"][13]) < 1e-9, v14)
    # ── short circuit with sequence data typed into the table
    menu(page, "Network", "Case editor")
    page.locator(".btn", has_text="Examples").tap(); page.locator("#sheet .act", has_text="WSCC 9-bus").tap(); discard_if_asked(page)
    page.locator(".seg button", has_text="Generators").tap()
    for i, x in enumerate(["0,0608", "0,1198", "0,1813"]):
        page.locator("table.grid tbody tr").nth(i).locator("td").nth(7).tap()
        for ch in x: tap_key(page, ch)
        page.locator(".cellbtn", has_text="✓").tap()
    menu(page, "Network", "Short circuit")
    page.locator(".btn.big", has_text="Compute").tap(); page.wait_for_selector(".status.ok")
    txt = page.inner_text(".kv")
    ref3 = next(f for f in SC["faults"] if f["pre"] == "flat" and f["kind"] == "3ph" and f["bus"] == 5)["Iabc"][0]
    got = float(re.search(r"Fault current\s+([\d,]+)", txt).group(1).replace(",", "."))
    check("three-phase fault at bus 5 matches the reference", abs(got - ref3) < 1e-5 * ref3, (got, ref3))
    page.screenshot(path="/home/claude/m_sc.png")
    page.locator(".seg button", has_text="SLG").tap(); page.locator(".btn.big", has_text="Compute").tap(); page.wait_for_timeout(300)
    check("SLG without zero-sequence data asks for it", "Zero-sequence data needed" in page.inner_text("#v-net"))
    # ── N-1
    menu(page, "Network", "Contingency (N-1)")
    page.locator(".btn.big", has_text="Run").tap()
    page.wait_for_function("() => !document.querySelector('#v-net .status') && document.querySelectorAll('#v-net table.grid tbody tr').length > 0", timeout=90000)
    n = page.locator("table.grid tbody tr").count()
    check("N-1: 9 branch + 2 generator outages analysed", n == 11, n)
    rows_ = page.locator("table.grid tbody tr")
    k = next(i for i in range(rows_.count()) if rows_.nth(i).locator("td").nth(1).inner_text() != "Islanding")
    rows_.nth(k).locator("td").nth(0).tap(); page.wait_for_timeout(300)
    check("tap an outage → its full power-flow results", page.evaluate("__eecalc.st.sub") == "pf" and " out" in page.inner_text(".status.ok"))
    # ── open the saved file
    menu(page, "Network", "Case editor")
    with page.expect_file_chooser() as fc:
        page.locator(".btn", has_text="Open").tap(); discard_if_asked(page)
    fc.value.set_files(saved_path); page.wait_for_timeout(400)
    page.locator(".seg button", has_text="Buses").tap()
    check("open a saved case file", page.locator("table.grid tbody tr").nth(4).locator("td").nth(4).inner_text() == "100")
    check("only the profile is stored", page.evaluate("localStorage.length === 1 && localStorage.key(0) === 'eecalc.profile' && sessionStorage.length === 0") and page.evaluate("document.cookie") == "")
    # ── chat between two devices
    menu(page, "Chat"); page.wait_for_function("() => document.querySelector('.chatstatus').classList.contains('online')", timeout=10000)
    ctx2 = b.new_context(**IPHONE); ctx2.add_init_script("window.__EECALC_BROKERS = ['ws://localhost:8899/mqtt'];")
    p2 = ctx2.new_page(); p2.set_default_timeout(10000); p2.goto(URL); p2.wait_for_selector("#pad .k")
    menu(p2, "Chat"); p2.wait_for_function("() => document.querySelector('.chatstatus').classList.contains('online')", timeout=10000)
    page.fill(".chatform input", "Olá 👋 V = 230∠-30°"); page.locator(".chatform .btn").tap()
    p2.wait_for_selector(".msg .txt", timeout=5000)
    check("message delivered to the other device", p2.locator(".msg .txt").first.inner_text() == "Olá 👋 V = 230∠-30°")
    page.wait_for_timeout(1600)
    page.fill(".chatform input", "see www.example.com now"); page.locator(".chatform .btn").tap(); page.wait_for_timeout(300)
    check("links are refused", "Links are not allowed" in page.inner_text("#toast") and p2.locator(".msg").count() == 1)
    p2.fill(".chatform input", "<img src=x onerror=alert(1)>"); p2.locator(".chatform .btn").tap(); page.wait_for_timeout(600)
    check("markup is never executed (refused or shown as text)", page.locator(".msg img").count() == 0)
    page.screenshot(path="/home/claude/m_chat.png")
    menu(p2, "Calculator"); p2.wait_for_timeout(150)
    page.wait_for_timeout(1600); page.fill(".chatform input", "unread test"); page.locator(".chatform .btn").tap(); p2.wait_for_timeout(600)
    check("unread dot on the menu button", p2.is_visible("#dot"))
    ctx.set_offline(True); page.evaluate("dispatchEvent(new Event('offline'))"); page.wait_for_timeout(200)
    check("chat locked when offline", page.is_visible(".chatlock"))
    menu(page, "Calculator"); page.locator("#menu-btn").tap()
    check("menu shows the chat locked", "🔒" in page.inner_text("#sheet"))
    page.locator("#sheet .act.muted").tap(); ctx.set_offline(False)
    # ── iPad landscape and memory
    c3 = b.new_context(viewport={"width": 1180, "height": 820}, device_scale_factor=2, is_mobile=True, has_touch=True)
    p3 = c3.new_page(); p3.set_default_timeout(15000); p3.goto(URL); p3.wait_for_selector("#pad .k")
    menu(p3, "Network", "Power flow"); p3.locator(".btn.big").tap(); p3.wait_for_selector(".status.ok")
    p3.locator(".seg button", has_text="Branches").tap(); p3.screenshot(path="/home/claude/m_ipad_pf.png")
    heap = p3.evaluate("""async () => { const h0 = performance.memory.usedJSHeapSize;
       for (let i = 0; i < 20; i++) { document.querySelector('.btn.big').click(); await new Promise(r => setTimeout(r, 350)); }
       return (performance.memory.usedJSHeapSize - h0) / 1e6; }""")
    check(f"20 repeated verified solves: heap change {heap:+.1f} MB", heap < 15)
    b.close()
check("no JavaScript errors", not [e for e in errors if "WebSocket" not in e], errors[:4])
print(f"\n{sum(results.values())}/{len(results)} checks passed", flush=True)
