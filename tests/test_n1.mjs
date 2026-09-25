import fs from 'fs';
import * as E from '../src/engine.js';
import * as NW from '../src/network.js';
const ref = JSON.parse(fs.readFileSync(new URL('./n1_ref.json', import.meta.url)));
const c = NW.fromMatpower(fs.readFileSync(new URL('./cases/case14.m', import.meta.url), 'utf8'), 'case14');
const eng = new E.Engine(), model = NW.compile(c, eng), list = NW.outages(model);
let n = 0, bad = 0;
const t0 = performance.now();
const all = list.map(o => NW.runOutage(c, eng, o, {}));
const ms = performance.now() - t0;
for (const [key, R] of Object.entries(ref)) {
  const kind = key.startsWith('gen') ? 'gen' : 'branch', row = Number(key.replace(/\D/g, ''));
  const res = all.find(x => x.outage.kind === kind && x.outage.row === row);
  // the list keeps summaries; the full result is re-solved on demand, as when a row is tapped
  const full = NW.solveOutage(c, eng, res.outage, {}).result;
  full.bus.forEach((b, k) => { n += 2; if (Math.abs(b.vm.toNumber() - R.vm[k]) > 1e-9 || Math.abs(b.va.toNumber() - R.va[k]) > 1e-8) bad++; });
  const vmin = full.bus.reduce((a, b) => (b.vm.lt(a.vm) ? b : a));
  n++; if (!res.vmin || !res.vmin.vm.eq(vmin.vm)) { bad++; console.log('summary differs from the re-solved result', key); }
}
const island = all.find(x => x.status === 'islanding');
console.log(`${n - bad}/${n} contingency voltages match PYPOWER; ${list.length} outages analysed and verified in ${(ms / 1000).toFixed(1)} s`);
console.log('islanding detected:', island ? `${island.outage.label} → ${island.note}` : 'none');
console.log('worst 3:', all.sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, 3).map(x => `${x.outage.label}: ${x.status}${x.worst ? `, max loading ${x.worst.loading.toFixed(1)} %` : ''}`).join(' | '));
process.exitCode = bad ? 1 : 0;
