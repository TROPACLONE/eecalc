# EE Calc for iPhone and iPad

A web app installed on the Home Screen: it opens full screen, works offline (except the chat and the radio), and stores nothing but a small profile.

## What's inside

- **Calculator:** complex numbers and phasors, with every result verified at 50 and 80 digits.
- **Energy tools:** 15 energy-systems tools, including the induction machine (parameters from tests, operating point, torque table).
- **Network:**
  - a case editor (tables, up to 50 buses);
  - power flow (Newton-Raphson, fast-decoupled, Gauss-Seidel, DC);
  - short circuit (3φ, SLG, LL, LLG), with the ±30° shift of Δ-Y transformers (taken as clock 11: Dyn11, YNd11) in the phase voltages;
  - N-1 contingency.
- **Focus:** a Pomodoro timer with XP and levels; its durations are set on the same screen.
- **Media** (its own screen in the ☰ menu): 27 radio stations from 9 countries, 14 lofi and ambient streams, and 52 LibriVox audiobooks in five categories (classics; adventure, mystery and science fiction; science and engineering; philosophy; Portuguese), plus search over all of LibriVox, chapters and resume where you stopped. It keeps playing on every screen until paused or stopped; elsewhere a round button at the top right opens the player.
- **Chat:** a global room, text and emoji only, showing name, device tag and level. It is locked when offline.
- **Privacy:** only a small profile (name, tag, XP, Focus settings) is kept on the device; Profile → Reset deletes it.

## Files

- `dist/` (built, not in the repository): the 20 files that are published, about 279 KB in total, plus 41 station logos (74 KB) that are cached the first time they are shown. `app.js` is the calculator shell; the `c-….js` files are the engine and the Network, Chat, Focus, Media and machine-tool modules (the last five load when first used).
- `src/`: the source code.
  - `engine.js`: the verified multi-precision engine (decimal.js).
  - `energy.js`: the energy tools.
  - `machines.js`: the induction-machine formulas.
  - `network.js`: power flow, short circuit and N-1.
  - `chat.js`: the minimal MQTT client, with text-only validation.
  - `profile.js`: the profile, XP and the Pomodoro engine.
  - `media.js`, `mediaui.js`, `catalog.js`, `logos/`: the player, its interface and the list of stations, lofi streams and audiobooks.
  - `app.js`, `ui.js`, `netui.js`, `chatui.js`, `focusui.js`, `index.html`: the interface.
  - `examples.js`: the MATPOWER example cases (BSD licence).
- `tests/`: reference data and test scripts.
- `.github/workflows/pages.yml`: runs the tests, builds `dist/` and publishes it to GitHub Pages.

## Verification

- **Calculator:** 7,922 of 7,924 reference expressions match the original Python engine. The other 2 have the same values but a verified-digit estimate of 23 instead of 22.
- **Energy tools:** 1,504 of 1,513 cases match the original engine; the other 9 are deliberate corrections, each checked by the test: the rotor frequency is |s|·f, an optional input without its partner is reported instead of ignored, and negative R or X are rejected.
- **Induction machine:** 2,002 of 2,002 cases match an independent mpmath implementation (worst difference 4,9·10⁻⁶⁰); Chapman's worked examples agree to 0,2 %.
- **Power flow:** 1,956 of 1,956 values match PYPOWER/MATPOWER, on the 9-, 14- and 30-bus cases, a phase shifter and Q limits, using all four methods.
- **Short circuit:** 792 of 792 values match an independent NumPy implementation, which applies the Δ-Y phase shift the same way.
- **N-1:** all 24 IEEE 14 outages match PYPOWER. The list keeps a summary of each outage; its full results are solved again when you open it.
- **Interface:** two end-to-end suites of 29 checks each pass on emulated iPhone 13 and iPad screens.

To re-run the tests, you need Node.js 20 or newer. The Python reference scripts additionally need PYPOWER.

    npm install
    npm test                        # every suite below; stops at the first failure
    node tests/compare.mjs          # calculator vs Python reference
    node tests/compare_energy.mjs   # energy tools
    node tests/test_network.mjs     # power flow vs PYPOWER
    node tests/test_sc.mjs          # short circuit vs NumPy reference
    node tests/test_n1.mjs          # N-1 vs PYPOWER
    node build.mjs                  # rebuild dist/

## Publishing and updating

Every push to `main` runs all the tests, builds `dist/` and publishes it to GitHub Pages (Settings → Pages → Source: **GitHub Actions**). If any test fails, nothing is published. Pull requests are tested and built but not published.

Every build has its own cache version, so the installed app switches to the new files after one or two launches while online.
