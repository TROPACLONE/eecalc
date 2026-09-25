import Decimal from '../src/decimal.js';
import fs from 'fs';
import * as E from '../src/engine.js';
import * as NW from '../src/network.js';
const ref = JSON.parse(fs.readFileSync(new URL('./sc_ref.json', import.meta.url)));
const c = NW.fromMatpower(fs.readFileSync(new URL('./cases/case9.m', import.meta.url), 'utf8'), 'case9');
for (const g of c.gens) { const s = ref.gen[g.bus]; Object.assign(g, { x1: String(s.x1), x2: String(s.x2), x0: String(s.x0), xn: String(s.xn), gnd: s.gnd ? 'grounded' : 'ungrounded' }); }
for (const br of c.branches) {
  const cn = ref.conn.find(([f, t]) => String(f) === br.from && String(t) === br.to);
  br.conn = cn ? cn[2] : 'line';
  const r = Number(br.r), x = Number(br.x), b = Number(br.b);
  br.r0 = String(+(3 * r).toFixed(10)); br.x0 = String(+(3 * x).toFixed(10)); br.b0 = String(+(0.6 * b).toFixed(10));
}
const eng = new E.Engine(), model = NW.compile(c, eng);
let n = 0, bad = 0, worst = 0;
const cmp = (a, b, what) => { n++; const e = Math.abs(Number(a) - b) / Math.max(1, Math.abs(b)); worst = Math.max(worst, e); if (!(e < 1e-9)) { bad++; if (bad < 8) console.log('FAIL', what, Number(a), b); } };
const t0 = performance.now();
for (const f of ref.faults) {
  const zf = new E.Cx(new Decimal(f.zf[0]), new Decimal(f.zf[1]));
  const r = NW.shortCircuit(model, { bus: f.bus, type: f.kind, zf, prefault: f.pre });
  const tag = `${f.pre} ${f.kind} bus ${f.bus}`;
  r.abc.forEach((x, i) => cmp(E.internals.cabs(x), f.Iabc[i], `${tag} I${'abc'[i]}`));
  r.seq.forEach((x, i) => cmp(E.internals.cabs(x), f.seq[i], `${tag} I${i}`));
  r.bus.forEach((b, i) => { cmp(b.vam, f.V[i][0], `${tag} Va${b.n}`); cmp(b.vbm, f.V[i][1], `${tag} Vb${b.n}`); cmp(b.vcm, f.V[i][2], `${tag} Vc${b.n}`); });
  if (r.reliable !== null) { bad++; console.log('not fully verified', tag); }
}
console.log(`${n - bad}/${n} short-circuit values match the independent reference (worst relative difference ${worst.toExponential(1)}); ${((performance.now() - t0) / ref.faults.length).toFixed(0)} ms per verified fault study`);
process.exitCode = bad ? 1 : 0;
