// Induction-machine tools vs the independent mpmath reference (make_im_ref.py → im_ref.json).
// A case passes when both sides fail (inconsistent data / no operating point), or both succeed with
// the same set of outputs and every value within 1e-35 relative (values ≈ 0 against the case's scale).
import fs from 'fs';
import DecimalBase from '../src/decimal.js';
import * as E from '../src/engine.js';
import * as N from '../src/energy.js';

const cases = JSON.parse(fs.readFileSync(new URL('./im_ref.json', import.meta.url)));
await N.ready(N.TOOL_BY_ID.imop); await N.ready(N.TOOL_BY_ID.imtest);
const Decimal = DecimalBase.clone({ precision: 60 });
const TOL = new Decimal('1e-35'), ZERO = new Decimal('1e-40');
const dec = x => new Decimal(x.toString());
const num = v => (E.isA(v) ? [dec(v.ht).times(180), new Decimal(0)] : E.isC(v) ? [dec(v.re), dec(v.im)] : [dec(v), new Decimal(0)]);
const mag = ([a, b]) => a.times(a).plus(b.times(b)).sqrt();

let pass = 0, fail = 0, both = 0, worst = new Decimal(0), worstAt = '', nvals = 0, ms = 0;
const bad = [];
for (const c of cases) {
  const eng = new E.Engine();
  let js = null, err = null;
  const t0 = performance.now();
  try { js = N.compute(eng, N.TOOL_BY_ID[c.tool], c.texts).outs; } catch (ex) { err = ex; }
  ms += performance.now() - t0;
  if (err && !(err instanceof E.CalcError || err instanceof N.Incomplete)) { fail++; bad.push({ c, why: 'crash ' + err.stack }); continue; }
  if (!c.ref) { if (!js) { pass++; both++; } else { fail++; bad.push({ c, why: 'reference has no result, JS does' }); } continue; }
  if (!js) { fail++; bad.push({ c, why: 'JS error: ' + (err.msg || err.message) }); continue; }
  const jk = js.map(o => o.key).sort().join(' '), rk = Object.keys(c.ref).sort().join(' ');
  if (jk !== rk) { fail++; bad.push({ c, why: `outputs differ\n JS : ${jk}\n ref: ${rk}` }); continue; }
  const ref = Object.fromEntries(Object.entries(c.ref).map(([k, v]) => [k, Array.isArray(v) ? v.map(x => new Decimal(x)) : [new Decimal(v), new Decimal(0)]]));
  const scale = Decimal.max(...Object.values(ref).map(mag));
  let ok = true;
  for (const o of js) {
    const a = num(o.value), b = ref[o.key];
    const d = mag([a[0].minus(b[0]), a[1].minus(b[1])]), m = Decimal.max(mag(a), mag(b));
    nvals++;
    if (m.lte(ZERO.times(scale))) continue;
    const rel = d.div(m);
    if (rel.gt(worst)) { worst = rel; worstAt = `${c.tool}/${o.key}`; }
    if (rel.gt(TOL)) { ok = false; bad.push({ c, why: `${o.key}: JS ${a[0]} ${a[1]} ref ${b[0]} ${b[1]} rel ${rel.toSD(3)}` }); break; }
  }
  if (ok) pass++; else fail++;
}
console.log(`${pass}/${cases.length} induction-machine cases match the mpmath reference (${both} rejected by both); ` +
  `${nvals} values, worst relative difference ${worst.toSD(2)} at ${worstAt}; ${(ms / cases.length).toFixed(1)} ms per verified run`);
for (const b of bad.slice(0, Number(process.argv[2] || 6))) console.log('✗', b.why, '\n ', JSON.stringify(b.c.texts));
process.exitCode = fail ? 1 : 0;
