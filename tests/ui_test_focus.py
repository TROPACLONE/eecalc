"""UI test: profile / onboarding, Pomodoro + XP (controlled clock), radio paths, chat level badge and unread count.
Run tests/serve.sh first (dist/ on :8765 and the local broker on :8899)."""
import os, re, json, math, struct, wave
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
from playwright.sync_api import sync_playwright
URL = "http://localhost:8765/"
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
errors, results = [], {}
def check(name, cond, detail=""):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail!r}]" if not cond else ""))

def wav(name, amp):                                   # 20 s of 440 Hz (or silence) for the radio test
    with wave.open(os.path.join(DIST, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        w.writeframes(b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050 * 20)))
wav("tone.wav", 8000); wav("silence.wav", 0)
IPHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
def seed(ctx, **p):
    ctx.add_init_script("if (!localStorage.getItem('eecalc.profile')) localStorage.setItem('eecalc.profile', JSON.stringify(%s));" % json.dumps(p) + "window.__EECALC_BROKERS = ['ws://localhost:8899/mqtt'];")
def hook(page):
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "tone" not in m.text and "Content Security" not in m.text else None)
prof = lambda page: page.evaluate("JSON.parse(localStorage.getItem('eecalc.profile'))")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    # ── 1. first launch: name, tag, stored profile ───────────────────────────────────────────────
    c = b.new_context(**IPHONE); page = c.new_page(); hook(page)
    page.goto(URL); page.wait_for_selector(".onb .ninput")
    check("first launch asks for a name", page.is_visible(".onb"))
    page.screenshot(path="/home/claude/f_onboard.png")
    page.fill(".onb .ninput", "ab"); page.click(".onb .btn.accent")
    check("invalid name refused with the rule", "3–20" in page.inner_text(".onb .perr"))
    page.fill(".onb .ninput", "João_EE"); page.click(".onb .btn.accent"); page.wait_for_timeout(100)
    pr = prof(page)
    check("name stored with a 4-hex device tag and 0 XP", page.locator(".onb").count() == 0 and pr["name"] == "João_EE" and re.fullmatch("[0-9a-f]{4}", pr["tag"]) and pr["xp"] == 0, pr)
    page.reload(); page.wait_for_selector("#pad .k")
    check("no name prompt on the next launch", page.locator(".onb").count() == 0)
    lv = page.evaluate("[0, 99, 100, 299, 300, 599, 600, 4499, 4500, 5500].map(x => __eecalc.ctx.profile.levelOf(x))")
    check("level curve: level L+1 needs 100·L more XP", lv == [1, 1, 2, 2, 3, 3, 4, 9, 10, 11], lv)
    page.evaluate("__eecalc.show('profile')"); page.wait_for_selector(".prof")
    page.fill(".prof .ninput", "Miguel-2"); page.click("text=Save name"); page.wait_for_timeout(80)
    check("rename from the Profile screen", prof(page)["name"] == "Miguel-2" and "Miguel-2" in page.inner_text(".pname"))
    page.screenshot(path="/home/claude/f_profile.png")
    page.click("text=Reset profile"); page.locator("#sheet .act", has_text="Reset profile").click(); page.wait_for_timeout(100)
    check("reset deletes the profile and asks for a name again", page.is_visible(".onb") and page.evaluate("localStorage.length") == 0)
    c.close()

    # ── 2. Pomodoro with a controlled clock ───────────────────────────────────────────────────────
    c = b.new_context(**IPHONE); seed(c, name="Clock", tag="beef", xp=0, radio={"st": "off", "vol": 60}); c.clock.install()
    page = c.new_page(); hook(page); page.goto(URL); page.wait_for_selector("#pad .k")
    page.evaluate("window.__xp = []; __eecalc.ctx.profile.onChange(w => { if (w && w.xp) __xp.push([w.why, w.xp]); }); 0")
    page.evaluate("__eecalc.show('focus')"); page.wait_for_selector(".fclock")
    check("Focus screen idle at 25:00", page.inner_text(".fclock") == "25:00")
    page.click("text=Start focus"); page.clock.run_for(2000)
    check("top-bar countdown while focusing", page.is_visible("#pomo") and page.inner_text("#pomo") in ("24:58", "24:59"), page.inner_text("#pomo"))
    page.screenshot(path="/home/claude/f_running.png")
    page.clock.run_for("25:00")
    log = page.evaluate("__xp")
    check("focus complete: +50 XP (2 per minute)", ["focus", 50] in log, log)
    check("app use: 1 XP per 2 minutes (12 in 25 min)", sum(x for w, x in log if w == "use") == 12, log)
    check("break offered, not started automatically", "Start break (5 min)" in page.inner_text(".facts"))
    page.click("text=Start break"); page.clock.run_for("05:01")
    check("break complete: +5 XP (1 per minute)", ["break", 5] in page.evaluate("__xp"), page.evaluate("__xp"))
    page.evaluate("__eecalc.ctx.profile.setPomo('every', 2)")           # one more focus completes the set
    page.click("text=Start focus"); page.clock.run_for("25:01")
    check("full set: 50 + 25 bonus, long break offered", ["set", 75] in page.evaluate("__xp") and "Start long break (15 min)" in page.inner_text(".facts"), page.evaluate("__xp"))
    page.click("text=Skip"); page.click("text=Start focus"); page.clock.run_for("03:00")
    xp0 = prof(page)["xp"]
    page.click("text=Stop (no XP)"); page.locator("#sheet .act", has_text="Stop session").click(); page.wait_for_timeout(50)
    check("stopping a session earns nothing and clears the timer", prof(page)["xp"] == xp0 and prof(page)["run"] is None and page.is_hidden("#pomo"))
    # the app is closed during a session and reopened after it ended: it is credited on launch
    page.click("text=Start focus"); page.clock.run_for("10:00")
    page.reload(); page.wait_for_selector("#pad .k")
    check("session survives an app restart", page.is_visible("#pomo") and re.match(r"1[45]:", page.inner_text("#pomo")), page.inner_text("#pomo"))
    xp1 = prof(page)["xp"]; page.close(); c.clock.fast_forward("30:00")
    page = c.new_page(); hook(page); page.goto(URL); page.wait_for_selector("#pad .k"); page.wait_for_timeout(100)
    pr = prof(page)
    check("session that ended while closed is credited on launch", pr["xp"] - xp1 >= 50 and pr["run"]["pending"], (xp1, pr))
    page.locator("#menu-btn").click()
    check("menu: Focus and Profile items", page.locator("#sheet .mi", has_text="Focus").count() == 1 and "Level" in page.inner_text("#sheet .mi:has-text('Profile')"))
    page.keyboard.press("Escape"); c.close()

    # ── 3. radio: gain path, silence fallback, blocked stream, missing address ─────────────────────
    c = b.new_context(**IPHONE); seed(c, name="Radio", tag="cafe", xp=0, radio={"st": "rfm", "vol": 60})
    c.add_init_script("window.__EECALC_STATIONS = [{id: 'observador', name: 'Observador', url: null}, {id: 'rfm', name: 'RFM', url: '/tone.wav'},"
                      " {id: 'comercial', name: 'Comercial', url: '/silence.wav'}];")
    page = c.new_page(); hook(page); page.goto(URL); page.wait_for_selector("#pad .k")
    page.evaluate("__eecalc.show('focus')"); page.wait_for_selector(".fclock")
    page.click("text=Start focus"); page.wait_for_timeout(1500)
    st = page.evaluate("({mode: __eecalc.focus.radio.mode, el: !!__eecalc.focus.radio.el})")
    check("radio starts with focus, through the gain stage", st == {"mode": "gain", "el": True} and "Playing RFM" in page.inner_text(".fstat"), (st, page.inner_text(".fstat")))
    loud = page.evaluate("() => { const a = __eecalc.focus.radio.an, u = new Uint8Array(a.fftSize); a.getByteTimeDomainData(u); return Math.max(...u) - Math.min(...u); }")
    check("audio actually flows through Web Audio", loud > 20, loud)
    page.locator(".fvolrow button", has_text="+").click(); page.wait_for_timeout(400)
    g = page.evaluate("__eecalc.focus.radio.gain.gain.value")
    check("volume + raises the gain (70 % → 0,49)", prof(page)["radio"]["vol"] == 70 and abs(g - 0.49) < 0.02 and "70 %" in page.inner_text(".fvol"), g)
    page.screenshot(path="/home/claude/f_radio.png")
    page.locator(".fradio .seg button", has_text="Comercial").click(); page.wait_for_timeout(6000)
    check("silent through Web Audio (no CORS) → direct playback, device volume", page.evaluate("__eecalc.focus.radio.mode") == "direct"
          and "device buttons" in page.inner_text(".fstat") and page.locator(".fvolrow button").first.is_disabled(), page.inner_text(".fstat"))
    page.locator(".fradio .seg button", has_text="Observador").click(); page.wait_for_timeout(200)
    check("station without a stream address says so", "isn't available yet" in page.inner_text(".fstat"))
    page.evaluate("__eecalc.ctx.profile.setRadio({st: 'rfm'}); __eecalc.focus.radio.st = {id: 'x', name: 'Blocked', url: 'http://127.0.0.1:8765/tone.wav'}; __eecalc.focus.radio.open(false)")
    page.wait_for_timeout(800)
    check("stream blocked by the CSP (not https) → clear error", "can't be played" in page.inner_text(".fstat"), page.inner_text(".fstat"))
    page.locator(".fradio .seg button", has_text="RFM").click(); page.wait_for_timeout(800)
    page.click("text=Pause"); page.wait_for_timeout(1700)
    check("radio stops when focus pauses and releases its audio nodes", page.evaluate("__eecalc.focus.radio.el") is None and page.evaluate("__eecalc.focus.radio.nodes") is None)
    page.click("text=Resume"); page.wait_for_timeout(1200)
    check("radio resumes with focus", page.evaluate("__eecalc.focus.radio.mode") == "gain")
    c.close()

    # ── 4. chat: tag + level on messages, unread count on the menu ────────────────────────────────
    ca = b.new_context(**IPHONE, bypass_csp=True); seed(ca, name="Alice", tag="aaaa", xp=350)
    cb = b.new_context(**IPHONE, bypass_csp=True); seed(cb, name="Bob", tag="bbbb", xp=0)
    A = ca.new_page(); hook(A); B = cb.new_page(); hook(B)
    for pg in (A, B):
        pg.goto(URL); pg.wait_for_selector("#pad .k"); pg.evaluate("__eecalc.show('chat')")
        for _ in range(80):
            if pg.evaluate("!!document.querySelector('.chatstatus.online')"): break
            pg.wait_for_timeout(100)
    check("chat header shows name, tag and level", "Alice #aaaa · Lv 3" in A.inner_text(".chathead"))
    A.evaluate("__eecalc.show('calc')"); A.wait_for_timeout(100)
    for t in ["one", "two", "three"]:
        B.fill(".chatform input", t); B.click(".chatform .btn"); B.wait_for_timeout(1600)
    A.wait_for_timeout(300)
    check("☰ shows the unread dot", A.is_visible("#dot"))
    A.locator("#menu-btn").click()
    badge = A.locator("#sheet .mi .badge")
    check("Chat item shows the unread count", badge.count() == 1 and badge.inner_text() == "3", badge.all_inner_texts())
    A.screenshot(path="/home/claude/f_menu_badge.png")
    A.locator("#sheet .mi", has_text="Chat").click(); A.wait_for_timeout(200)
    who = A.locator(".msg .who b").last.inner_text()
    check("received message shows Bob #bbbb Lv 1", "Bob" in who and "#bbbb" in who and "Lv 1" in who, who)
    check("opening the chat clears the badge and dot", A.is_hidden("#dot") and A.evaluate("__eecalc.st.unread") == 0)
    A.fill(".chatform input", "hello from level 3"); A.click(".chatform .btn"); B.wait_for_timeout(500)
    whoB = B.locator(".msg .who b").last.inner_text()
    check("sent message carries Alice #aaaa Lv 3", "Alice" in whoB and "#aaaa" in whoB and "Lv 3" in whoB, whoB)
    A.screenshot(path="/home/claude/f_chat.png")
    ca.close(); cb.close()
    check("no page errors", not errors, errors[:5])
    b.close()
for f in ("tone.wav", "silence.wav"): os.remove(os.path.join(DIST, f))
print(f"\n{sum(results.values())}/{len(results)} passed")
