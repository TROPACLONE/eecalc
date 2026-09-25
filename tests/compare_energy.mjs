import fs from 'fs';
import * as E from '../src/engine.js';
import * as N from '../src/energy.js';
const cases = JSON.parse(fs.readFileSync(new URL('./golden_energy.json', import.meta.url)));
let same = 0, diff = 0, msg = 0; const bad = [];
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
  if (ok) same++; else { diff++; bad.push({ tool: c.tool, texts: c.texts, py, js }); }
}
console.log(`${same} identical, ${diff} different, ${msg} error-message wording differences — ${((performance.now() - t0) / cases.length).toFixed(1)} ms per tool run`);
for (const b of bad.slice(0, Number(process.argv[2] || 5))) console.log(JSON.stringify(b).slice(0, 1500));
process.exitCode = diff ? 1 : 0;
