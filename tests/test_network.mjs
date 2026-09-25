import fs from 'fs';
import * as E from '../src/engine.js';
import * as NW from '../src/network.js';
const ref = JSON.parse(fs.readFileSync(new URL('./pf_ref.json', import.meta.url)));
const load = name => NW.fromMatpower(fs.readFileSync(new URL(`./cases/${name}.m`, import.meta.url), 'utf8'), name);
const variants = {
  case9: () => load('case9'), case14: () => load('case14'), case30: () => load('case30'),
  case9_shift: () => { const c = load('case9'); c.branches[0].shift = '3'; c.buses[0].va = '10'; return c; },
  case14_qlim: () => { const c = load('case14'); c.gens[1].qmax = '20'; c.gens[0].qmax = '999'; c.gens[0].qmin = '-999'; return c; },
};
let fails = 0, checks = 0;
const eng = new E.Engine();
const worst = { v: 0, what: '' };
function cmp(label, got, exp, tol = 1e-8) {
  checks++;
  const g = Number(got), err = Math.abs(g - exp) / Math.max(1, Math.abs(exp));
  if (err > worst.v) { worst.v = err; worst.what = label; }
  if (!(err <= tol)) { fails++; if (fails < 15) console.log('FAIL', label, g, exp); }
}
for (const [key, mk] of Object.entries(variants)) {
  const R = ref[key], c = mk(), model = NW.compile(c, eng);
  for (const method of ['nr', 'fd', 'gs']) {
    const t0 = performance.now();
    const r = NW.powerFlow(model, { method, qlim: !!R.qlim, maxIt: method === 'gs' ? 5000 : undefined });
    const ms = performance.now() - t0;
    r.bus.forEach((b, k) => { cmp(`${key}/${method} Vm${b.n}`, b.vm, R.vm[k]); cmp(`${key}/${method} Va${b.n}`, b.va, R.va[k]); });
    r.gens.forEach((g, k) => { cmp(`${key}/${method} Pg${k}`, g.p, R.pg[k]); cmp(`${key}/${method} Qg${k}`, g.q, R.qg[k]); });
    r.branches.forEach((b, k) => { cmp(`${key}/${method} Pf${k}`, b.pf, R.pf[k]); cmp(`${key}/${method} Qf${k}`, b.qf, R.qf[k]);
      cmp(`${key}/${method} Pt${k}`, b.pt, R.pt[k]); cmp(`${key}/${method} Qt${k}`, b.qt, R.qt[k]); });
    console.log(`${key.padEnd(12)} ${method}: ${String(r.iterations).padStart(3)} iterations, verified=${r.reliable === null}, switched=${r.switched.map(s => s.bus).join(',') || '-'}, ${ms.toFixed(0)} ms`);
  }
  const dc = NW.dcPowerFlow(model);
  dc.bus.forEach((b, k) => cmp(`${key}/dc Va${b.n}`, b.va, R.dc_va[k]));
  dc.branches.forEach((b, k) => cmp(`${key}/dc Pf${k}`, b.pf, R.dc_pf[k]));
  cmp(`${key}/dc Pslack`, dc.bus[model.slack].pg, R.dc_pg[0]);
}
console.log(`\n${checks - fails}/${checks} values match PYPOWER (worst relative difference ${worst.v.toExponential(1)} at ${worst.what})`);
process.exitCode = fails ? 1 : 0;
