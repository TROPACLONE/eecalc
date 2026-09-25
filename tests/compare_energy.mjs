import fs from 'fs';
import * as E from '../src/engine.js';
import * as N from '../src/energy.js';
const cases = JSON.parse(fs.readFileSync(new URL('./golden_energy.json', import.meta.url)));
let same = 0, diff = 0, msg = 0; const bad = [], changed = {};
// Deliberate changes from the reference engine (found in the 2026-09 review); each is checked, not just skipped.
const num = t => Number(String(t).replace(/[^\d,eE+-]/g, '').replace(',', '.'));
const has = (c, k) => !!(c.texts[k] || '').trim();
const neg = (c, k) => has(c, k) && /^\s*-/.test(c.texts[k]);
function intended(c, py, js) {
  // rotor frequency is |s|·f (was s·f, negative above synchronous speed); everything else unchanged
  if (c.tool === 'im' && py.ok && js.ok) {
    const strip = o => JSON.stringify(o.filter(x => x[0] !== 'fr'));
    const fp = py.e12.find(x => x[0] === 'fr'), fj = js.e12.find(x => x[0] === 'fr');
    if (fp && fj && strip(py.e12) === strip(js.e12) && Math.abs(num(fp[1][0])) === num(fj[1][0]) && num(fp[1][0]) < 0 && fj[2].includes('generating'))
      return 'rotor frequency |s|·f';
  }
  // an optional input without its partner is now an error, not silently ignored
  if (c.tool === 'line' && !js.ok && has(c, 'SR') && !has(c, 'VR') && /also needs/.test(js.msg)) return 'S_R without V_R';
  if (c.tool === 'trafo' && !js.ok && has(c, 'i0') !== has(c, 'P0') && /also needs/.test(js.msg)) return 'i0 / P0 without the other';
  // negative R or X in the voltage-drop tool are rejected
  if (c.tool === 'vdrop' && !js.ok && (neg(c, 'R') || neg(c, 'X'))) return 'negative R or X';
  return null;
}
const t0 = performance.now();
for (const c of cases) {
  const eng = new E.Engine(); eng.evaluate('Z = 3+j4');
  let js;
  try {
    const { outs, reliable } = N.compute(eng, N.TOOL_BY_ID[c.tool], c.texts);
    js = { ok: true, reliable, e12: outs.map(o => [o.key, N.formatOut(o, 'deg', 12, 'auto'), o.note]), s30: outs.map(o => N.formatOut(o, 'rad', 30, 'sci')) };
  } catch (ex) {
    if (ex instanceof N.Incomplete) js = { ok: false, incomplete: ex.labels };
    else if (ex instanceof E.CalcError) js = { ok: false, msg: ex.msg };
    else { js = { ok: false, crash: String(ex.stack).split('\n').slice(0, 2).join(' | ') }; }
  }
  const py = c.py;
  let ok;
  if (py.ok !== js.ok || js.crash) ok = false;
  else if (!py.ok) { ok = JSON.stringify(py.incomplete) === JSON.stringify(js.incomplete); if (ok && py.msg !== js.msg) msg++; }
  else ok = JSON.stringify(py.e12) === JSON.stringify(js.e12) && JSON.stringify(py.s30) === JSON.stringify(js.s30) && (py.reliable ?? null) === (js.reliable ?? null);
  if (!ok && intended(c, py, js)) { changed[intended(c, py, js)] = (changed[intended(c, py, js)] || 0) + 1; continue; }
  if (ok) same++; else { diff++; bad.push({ tool: c.tool, texts: c.texts, py, js }); }
}
console.log(`${same} identical, ${diff} different, ${Object.values(changed).reduce((a, b) => a + b, 0)} deliberate changes (${Object.entries(changed).map(([k, v]) => `${k}: ${v}`).join('; ')}), ${msg} error-message wording differences — ${((performance.now() - t0) / cases.length).toFixed(1)} ms per tool run`);
for (const b of bad.slice(0, Number(process.argv[2] || 5))) console.log(JSON.stringify(b).slice(0, 1500));
process.exitCode = diff ? 1 : 0;
