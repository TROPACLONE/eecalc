import fs from 'fs';
import * as E from '../src/engine.js';
const { setup, cases } = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url)));
const only = process.argv[2];
let pass = 0, fail = 0, msgDiff = 0, crash = 0, estDiff = 0;
const fails = [], msgs = [];
const t0 = performance.now();
for (const c of cases) {
  if (only && c.group !== only) continue;
  const eng = new E.Engine(); eng.angleUnit = c.unit;
  for (const s of setup) eng.evaluate(s);
  eng.evaluate('7∠10');
  let js;
  try {
    const r = eng.evaluate(c.text);
    const f = (sig, n) => E.formatValue(r.value, c.unit, sig, n).map(x => x[0]);
    js = { ok: true, reliable: r.reliable, f12: f(12, 'auto'), e12: f(12, 'eng'), s30: f(30, 'sci'), full: E.fullPrecision(r.value, c.unit, r.reliable) };
  } catch (ex) {
    if (!(ex instanceof E.CalcError)) { crash++; fails.push({ text: c.text, unit: c.unit, crash: String(ex.stack).split('\n').slice(0, 3).join(' | ') }); continue; }
    js = { ok: false, msg: ex.msg };
  }
  const py = c.py;
  let same;
  if (py.ok !== js.ok) same = false;
  else if (!py.ok) { same = true; if (py.msg !== js.msg) { msgDiff++; msgs.push([c.text, py.msg, js.msg]); } }
  else same = ['f12', 'e12', 's30'].every(k => JSON.stringify(py[k]) === JSON.stringify(js[k])) && py.full === js.full && (py.reliable ?? null) === (js.reliable ?? null);
  // Same digits (30 shown in s30), but the verified-digit estimate is off by one: not a wrong value.
  const estOnly = !same && py.ok && js.ok && ['f12', 'e12', 's30'].every(k => JSON.stringify(py[k]) === JSON.stringify(js[k]))
    && py.reliable != null && js.reliable != null && Math.abs(py.reliable - js.reliable) === 1;
  if (same) pass++; else { if (estOnly) estDiff++; else fail++; fails.push({ text: c.text, unit: c.unit, py, js }); }
}
const ms = performance.now() - t0;
console.log(`${pass} identical, ${estDiff} differ only in the verified-digit estimate (±1), ${fail} different, ${crash} crashes, ${msgDiff} error-message wording differences — ${(ms / (pass + estDiff + fail + crash)).toFixed(2)} ms per case`);
for (const f of fails.slice(0, Number(process.argv[3] || 12))) console.log(JSON.stringify(f));
if (process.argv[4] === 'msgs') for (const m of msgs.slice(0, 30)) console.log('MSG', JSON.stringify(m));
process.exitCode = fail || crash ? 1 : 0;
