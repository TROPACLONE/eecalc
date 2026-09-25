// Induction machine vs published worked examples (Chapman, Electric Machinery Fundamentals, 4th ed.).
// The book rounds intermediate results to 3–4 digits, so agreement is checked to 0,2 %.
import * as E from '../src/engine.js';
import * as N from '../src/energy.js';
await N.ready(N.TOOL_BY_ID.imop); await N.ready(N.TOOL_BY_ID.imtest);
const eng = new E.Engine();
const val = (outs, k) => { const v = outs.find(o => o.key === k).value; return E.isC(v) ? Math.hypot(+v.re, +v.im) : E.isA(v) ? +v.ht * 180 : +v; };
let n = 0, bad = 0;
const check = (outs, k, book, tol = 2e-3) => { n++; const x = val(outs, k), r = Math.abs(x - book) / Math.abs(book);
  if (r > tol) { bad++; console.log(`✗ ${k}: ${x} vs book ${book} (${(100 * r).toFixed(2)} %)`); } };
// Ex. 6-3: 460 V, 25 hp, 60 Hz, 4 poles, Y; rotational losses 1100 W (core lumped in); s = 2,2 %
const ex63 = N.compute(eng, N.TOOL_BY_ID.imop, { conn: 'Y', model: 'exact', V: '460', f: '60', poles: '4', R1: '0,641', X1: '1,106',
  R2: '0,332', X2: '0,464', Xm: '26,3', Pfw: '1100', s: '0,022' }).outs;
for (const [k, b] of [['n', 1760], ['I1', 18.88], ['PF', 0.833], ['Pin', 12530], ['Pcu1', 685], ['Pag', 11845], ['Pmec', 11585],
  ['Pout', 10485], ['Tem', 62.8], ['Tsh', 56.9], ['eta', 83.7]]) check(ex63, k, b);
check(ex63, 'phi', 33.6, 3e-3);
// Ex. 6-8 test data (7,5 hp, 208 V, Y): R1 = 13,6 V / (2·28 A); no-load rotational losses 420 − 3·8,17²·R1 = 371,3 W
const ex68 = N.compute(eng, N.TOOL_BY_ID.imtest, { conn: 'Y', model: 'exact', cls: 'AD', f: '60', R1: '13,6/(2*28)', V0: '208', I0: '8,17',
  P0: '420', Vlr: '25', Ilr: '27,9', Plr: '920', flr: '15' }).outs;
check(ex68, 'R1', 0.243); check(ex68, 'Pfe', 371.3);
console.log(`${n - bad}/${n} textbook values within 0,2 % (Chapman Ex. 6-3 operating point, Ex. 6-8 test reduction)`);
console.log(`note: Ex. 6-5 approximates X_th ≈ X₁ (book s_Tmax = 0,198, T_max = 229 N·m); the exact Thévenin gives ` +
  `s_Tmax = ${val(ex63, 'sTmax').toFixed(4)}, T_max = ${val(ex63, 'Tmax').toFixed(1)} N·m`);
process.exitCode = bad ? 1 : 0;
