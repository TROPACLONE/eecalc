// Fuzz the induction-machine tools: random / hostile field values. Only CalcError or Incomplete may escape.
import * as E from '../src/engine.js';
import * as N from '../src/energy.js';
const tools = [N.TOOL_BY_ID.imop, N.TOOL_BY_ID.imtest];
for (const t of tools) await N.ready(t);
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const V = ['', '', '0', '-1', '1e-60', '1e300', '-1e300', '1e-300', '400', '0,5', '1', '2', '4', '50', '1k', 'j3', '1∠30', '[1|2]', 'x', '(',
  '1/0', '0,022', '1500', '26,3', 'Z', '3+j4', '1e15', '0,9999999999999999', '1,0000000000000001', ';', '0,1;0,2', '1;;2', '1;2;3;4;5;6;7;8;9;10;11;12;13',
  '0;1;-1;2', 'abc;1', '30°', 'pi', '1e-15', '100M', '-0', '1e-45'];
let runs = 0, crashes = 0, maxMs = 0, errs = 0; const t0 = performance.now();
for (let i = 0; i < 20000; i++) {
  const tool = pick(tools), texts = {};
  for (const f of tool.fields) texts[f.key] = f.choice ? pick([...f.options.map(o => o[0]), 'bogus', '']) : pick(V);
  const eng = new E.Engine(); eng.evaluate('Z = 3+j4');
  const a = performance.now();
  try { N.compute(eng, tool, texts); } catch (ex) {
    if (ex instanceof E.CalcError || ex instanceof N.Incomplete) errs++;
    else { crashes++; if (crashes < 4) console.log('CRASH', JSON.stringify(texts), ex.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  maxMs = Math.max(maxMs, performance.now() - a); runs++;
}
// structured fuzz: plausible machines with random operating requests (exercises the Newton solve)
for (let i = 0; i < 5000; i++) {
  const r = x => String(+(x * (0.2 + 1.6 * rnd())).toPrecision(5)).replace('.', ',');
  const texts = { conn: pick(['Y', 'D']), model: pick(['exact', 'approx']), V: r(400), f: pick(['50', '60']), poles: pick(['2', '4', '6', '8']),
    R1: r(0.5), X1: r(1), R2: r(0.4), X2: r(1), Xm: r(30), Rfe: pick(['', r(500)]), Pfw: pick(['', r(300), '0']),
    s: '', n: '', Pout: '', Tl: '', tbl: pick(['', '0,01;0,1;1', '-0,1;0;2']) };
  texts[pick(['s', 'n', 'Pout', 'Tl'])] = pick([r(0.03), r(1500), r(5000), r(40), '0', r(1e6), r(1e-6)]);
  const a = performance.now();
  try { N.compute(new E.Engine(), N.TOOL_BY_ID.imop, texts); } catch (ex) {
    if (ex instanceof E.CalcError || ex instanceof N.Incomplete) errs++;
    else { crashes++; if (crashes < 4) console.log('CRASH', JSON.stringify(texts), ex.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  maxMs = Math.max(maxMs, performance.now() - a); runs++;
}
console.log(`${runs} fuzz runs, ${crashes} crashes, ${errs} clean error messages; slowest ${maxMs.toFixed(0)} ms; ` +
  `${((performance.now() - t0) / runs).toFixed(2)} ms average`);
process.exitCode = crashes ? 1 : 0;
