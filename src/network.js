/*
 EE Calc — power-network analysis (no user-interface code).

 Case data are kept as the text you typed; every number is parsed exactly (0,05 is exactly 0,05) and a
 cell may also hold an expression or a calculator variable.

 Solvers follow MATPOWER's formulation (Newton-Raphson polar, fast-decoupled XB, Gauss-Seidel, DC), so
 iteration logs match textbook / MATPOWER hand checks. Each converges in double precision first; the
 solution is then refined with mismatches computed exactly at 50 and 80 digits (Newton corrections from
 the double-precision Jacobian, ~11 digits gained per step) and the two precisions must agree —
 the same verification the calculator uses.
*/
import * as E from './engine.js';

const I = E.internals;
const { Cx, CalcError } = E;
const { add, sub, mul, div, conj, cabs } = I;
const Dn = () => I.D;
const d = x => new (I.D)(x);
export const MAX_BUSES = 50;

// ═════════════════════════════════════════════════════════ columns (data model shared with the UI)
export const COLUMNS = {
  buses: [
    { key: 'num', label: 'Bus', type: 'int', w: 3 },
    { key: 'name', label: 'Name', type: 'text', w: 6 },
    { key: 'type', label: 'Type', type: 'enum', opts: ['PQ', 'PV', 'Slack', 'Off'], w: 4 },
    { key: 'kv', label: 'Base kV', type: 'num', w: 5 },
    { key: 'pd', label: 'Pd MW', type: 'num', w: 5 },
    { key: 'qd', label: 'Qd Mvar', type: 'num', w: 5 },
    { key: 'gs', label: 'Gs MW', type: 'num', w: 4, opt: true },
    { key: 'bs', label: 'Bs Mvar', type: 'num', w: 4, opt: true },
    { key: 'vmin', label: 'Vmin pu', type: 'num', w: 4, opt: true },
    { key: 'vmax', label: 'Vmax pu', type: 'num', w: 4, opt: true },
    { key: 'vm', label: 'V start pu', type: 'num', w: 4, opt: true },
    { key: 'va', label: 'θ start °', type: 'num', w: 4, opt: true },
  ],
  gens: [
    { key: 'bus', label: 'Bus', type: 'int', w: 3 },
    { key: 'on', label: 'On', type: 'bool', w: 2 },
    { key: 'pg', label: 'P MW', type: 'num', w: 5 },
    { key: 'qg', label: 'Q Mvar', type: 'num', w: 5, opt: true },
    { key: 'qmax', label: 'Qmax Mvar', type: 'num', w: 5, opt: true },
    { key: 'qmin', label: 'Qmin Mvar', type: 'num', w: 5, opt: true },
    { key: 'vg', label: 'V set pu', type: 'num', w: 4 },
    { key: 'x1', label: 'X″d pu', type: 'num', w: 4, opt: true },
    { key: 'x2', label: 'X2 pu', type: 'num', w: 4, opt: true },
    { key: 'x0', label: 'X0 pu', type: 'num', w: 4, opt: true },
    { key: 'gnd', label: 'Neutral', type: 'enum', opts: ['grounded', 'ungrounded'], w: 5 },
    { key: 'xn', label: 'Xn pu', type: 'num', w: 4, opt: true },
  ],
  branches: [
    { key: 'from', label: 'From', type: 'int', w: 3 },
    { key: 'to', label: 'To', type: 'int', w: 3 },
    { key: 'on', label: 'On', type: 'bool', w: 2 },
    { key: 'r', label: 'R pu', type: 'num', w: 5 },
    { key: 'x', label: 'X pu', type: 'num', w: 5 },
    { key: 'b', label: 'B pu', type: 'num', w: 5, opt: true },
    { key: 'rate', label: 'Rating MVA', type: 'num', w: 4, opt: true },
    { key: 'tap', label: 'Tap', type: 'num', w: 4, opt: true },
    { key: 'shift', label: 'Shift °', type: 'num', w: 4, opt: true },
    { key: 'r0', label: 'R0 pu', type: 'num', w: 4, opt: true },
    { key: 'x0', label: 'X0 pu', type: 'num', w: 4, opt: true },
    { key: 'b0', label: 'B0 pu', type: 'num', w: 4, opt: true },
    { key: 'conn', label: 'Zero-seq', type: 'enum', opts: ['line', 'YNyn', 'YNd', 'Dyn', 'Yd', 'Dy', 'Dd', 'Yy'], w: 5 },
  ],
};
export const TABLE_TITLES = { buses: 'Buses', gens: 'Generators', branches: 'Branches' };
export function blankRow(table, c) {
  const row = Object.fromEntries(COLUMNS[table].map(col => [col.key, '']));
  if (table === 'buses') {
    const nums = c.buses.map(b => parseInt(b.num, 10)).filter(Number.isFinite);
    Object.assign(row, { num: String((nums.length ? Math.max(...nums) : 0) + 1), type: 'PQ', kv: '', pd: '0', qd: '0', vmin: '0.95', vmax: '1.05' });
  }
  if (table === 'gens') Object.assign(row, { on: '1', pg: '0', vg: '1', gnd: 'grounded' });
  if (table === 'branches') Object.assign(row, { on: '1', r: '0', x: '0.1', b: '0', conn: 'line' });
  return row;
}
export function newCase(name = 'Untitled case') { return { name, base: '100', buses: [], gens: [], branches: [] }; }

// ═════════════════════════════════════════════════════════ MATPOWER import, JSON save format
export function fromMatpower(text, name = 'Imported case') {
  const clean = text.replace(/%.*$/gm, '');
  const base = /mpc\.baseMVA\s*=\s*([-+0-9.eE]+)/.exec(clean);
  const block = key => {
    const m = new RegExp(`mpc\\.${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`).exec(clean);
    if (!m) return [];
    return m[1].split(/;|\n/).map(r => r.trim()).filter(Boolean).map(r => r.split(/[\s,]+/).filter(Boolean));
  };
  const bus = block('bus'), gen = block('gen'), br = block('branch');
  if (!base || !bus.length) throw new CalcError('This does not look like a MATPOWER case (mpc.baseMVA / mpc.bus missing)');
  const c = newCase(name);
  c.base = base[1];
  const TYPES = { 1: 'PQ', 2: 'PV', 3: 'Slack', 4: 'Off' };
  for (const r of bus) c.buses.push({ num: r[0], name: '', type: TYPES[r[1]] || 'PQ', kv: r[9] || '', pd: r[2], qd: r[3], gs: r[4], bs: r[5],
    vmin: r[12] || '', vmax: r[11] || '', vm: r[7] || '', va: r[8] || '' });
  for (const r of gen) c.gens.push({ bus: r[0], on: Number(r[7]) > 0 ? '1' : '0', pg: r[1], qg: r[2], qmax: r[3], qmin: r[4], vg: r[5],
    x1: '', x2: '', x0: '', gnd: 'grounded', xn: '' });
  for (const r of br) c.branches.push({ from: r[0], to: r[1], on: Number(r[10]) > 0 ? '1' : '0', r: r[2], x: r[3], b: r[4],
    rate: r[5] && Number(r[5]) ? r[5] : '', tap: r[8] && Number(r[8]) ? r[8] : '', shift: r[9] && Number(r[9]) ? r[9] : '',
    r0: '', x0: '', b0: '', conn: r[8] && Number(r[8]) ? '' : 'line' });
  const nm = /function\s+mpc\s*=\s*(\w+)/.exec(text);
  if (nm && name === 'Imported case') c.name = nm[1];
  return c;
}
export function toFile(c) { return JSON.stringify({ format: 'eecalc-case', version: 1, case: c }, null, 1); }
export function fromFile(text, name) {
  const t = text.trim();
  if (t.startsWith('{')) {
    const o = JSON.parse(t);
    if (o.format !== 'eecalc-case' || !o.case) throw new CalcError('Not an EE Calc case file');
    const c = Object.assign(newCase(), o.case);
    for (const k of ['buses', 'gens', 'branches']) c[k] = (c[k] || []).map(r => Object.assign(blankRowShape(k), r));
    return c;
  }
  return fromMatpower(t, name);
}
const blankRowShape = table => Object.fromEntries(COLUMNS[table].map(col => [col.key, '']));

// ═════════════════════════════════════════════════════════ compile: validate and parse numbers exactly
export class CaseError extends CalcError { constructor(issues) { super(issues.join('\n')); this.issues = issues; } }

function parseNumberText(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const toks = E.tokenize(t);
  if (toks.length === 2 && toks[0].kind === 'num' && E.isR(toks[0].val)) return { lit: toks[0].val };
  if (toks.length === 3 && toks[0].kind === 'op' && toks[0].val === '-' && toks[1].kind === 'num' && E.isR(toks[1].val)) return { lit: toks[1].val.neg() };
  return { node: E.parse(t) };
}

/** Validate a case and prepare it for the solvers. Throws CaseError with every problem found. */
export function compile(c, engine) {
  const issues = [];
  const cells = [];                       // every numeric cell: {tab, row, key, p}
  const num = (tab, i, key, required, label) => {
    const text = c[tab][i][key];
    let p = null;
    try { p = parseNumberText(text); } catch (ex) { issues.push(`${label}: ${ex.msg || 'invalid number'}`); return null; }
    if (!p && required) issues.push(`${label}: value required`);
    if (!p) return null;
    const cell = { p };
    cells.push(cell);
    return cell;
  };
  let baseP = null;
  try { baseP = parseNumberText(c.base); } catch { /* reported below */ }
  if (!baseP) issues.push('System base MVA: value required');
  const base = baseP ? { p: baseP } : null;
  if (base) cells.push(base);

  const buses = [], byNum = new Map();
  c.buses.forEach((b, i) => {
    const lbl = `Bus row ${i + 1}`;
    const n = parseInt(String(b.num).trim(), 10);
    if (!Number.isInteger(n) || String(n) !== String(b.num).trim()) { issues.push(`${lbl}: bus number must be an integer`); return; }
    if (byNum.has(n)) { issues.push(`Bus ${n}: number used twice`); return; }
    if (!['PQ', 'PV', 'Slack', 'Off'].includes(b.type)) issues.push(`Bus ${n}: type must be PQ, PV, Slack or Off`);
    const L = `Bus ${n}`;
    const bus = { n, row: i, name: b.name || '', type: b.type, kv: num('buses', i, 'kv', false, `${L} base kV`),
      pd: num('buses', i, 'pd', false, `${L} Pd`), qd: num('buses', i, 'qd', false, `${L} Qd`),
      gs: num('buses', i, 'gs', false, `${L} Gs`), bs: num('buses', i, 'bs', false, `${L} Bs`),
      vmin: num('buses', i, 'vmin', false, `${L} Vmin`), vmax: num('buses', i, 'vmax', false, `${L} Vmax`),
      vm: num('buses', i, 'vm', false, `${L} V start`), va: num('buses', i, 'va', false, `${L} θ start`) };
    byNum.set(n, bus);
    buses.push(bus);
  });
  const active = buses.filter(b => b.type !== 'Off');
  if (!active.length) issues.push('The case has no buses');
  if (active.length > MAX_BUSES) issues.push(`At most ${MAX_BUSES} buses are supported (this case has ${active.length})`);
  const idx = new Map(active.map((b, k) => [b.n, k]));

  const gens = [];
  c.gens.forEach((g, i) => {
    const n = parseInt(String(g.bus).trim(), 10), L = `Generator row ${i + 1} (bus ${g.bus})`;
    if (!byNum.has(n)) { issues.push(`${L}: bus ${g.bus} does not exist`); return; }
    gens.push({ row: i, bus: n, on: g.on === '1' || g.on === true, gnd: g.gnd || 'grounded',
      pg: num('gens', i, 'pg', true, `${L} P`), qg: num('gens', i, 'qg', false, `${L} Q`),
      qmax: num('gens', i, 'qmax', false, `${L} Qmax`), qmin: num('gens', i, 'qmin', false, `${L} Qmin`),
      vg: num('gens', i, 'vg', true, `${L} V set`), x1: num('gens', i, 'x1', false, `${L} X″d`),
      x2: num('gens', i, 'x2', false, `${L} X2`), x0: num('gens', i, 'x0', false, `${L} X0`), xn: num('gens', i, 'xn', false, `${L} Xn`) });
  });
  const branches = [];
  c.branches.forEach((br, i) => {
    const f = parseInt(String(br.from).trim(), 10), t = parseInt(String(br.to).trim(), 10);
    const L = `Branch row ${i + 1} (${br.from}–${br.to})`;
    if (!byNum.has(f) || !byNum.has(t)) { issues.push(`${L}: bus does not exist`); return; }
    if (f === t) { issues.push(`${L}: both ends on the same bus`); return; }
    const on = (br.on === '1' || br.on === true) && byNum.get(f).type !== 'Off' && byNum.get(t).type !== 'Off';
    branches.push({ row: i, f, t, on, conn: br.conn || '',
      r: num('branches', i, 'r', true, `${L} R`), x: num('branches', i, 'x', true, `${L} X`), b: num('branches', i, 'b', false, `${L} B`),
      rate: num('branches', i, 'rate', false, `${L} rating`), tap: num('branches', i, 'tap', false, `${L} tap`),
      shift: num('branches', i, 'shift', false, `${L} shift`), r0: num('branches', i, 'r0', false, `${L} R0`),
      x0: num('branches', i, 'x0', false, `${L} X0`), b0: num('branches', i, 'b0', false, `${L} B0`) });
  });
  if (issues.length) throw new CaseError(issues);

  // evaluate every number once at 50 digits (checks expressions; gives the double-precision values)
  const model = { name: c.name, buses: active, allBuses: buses, byNum, idx, gens, branches, base, cells, engine, decCache: new Map() };
  const vals = decValues(model, 50);
  const bad = [];
  for (const br of branches) if (br.on && vals.get(br.r).isZero() && vals.get(br.x).isZero()) bad.push(`Branch ${br.f}–${br.t}: R and X are both zero`);
  for (const br of branches) if (br.tap && vals.get(br.tap).isNeg()) bad.push(`Branch ${br.f}–${br.t}: tap must be positive`);
  if (!vals.get(base).gt(0)) bad.push('System base MVA must be positive');
  if (bad.length) throw new CaseError(bad);
  model.f = x => (x ? vals.get(x).toNumber() : 0);
  model.fOr = (x, dflt) => (x ? vals.get(x).toNumber() : dflt);
  typesAndIslands(model);
  return model;
}
function decValues(model, dps) {
  let m = model.decCache.get(dps);
  if (m) return m;
  m = new Map();
  I.withDps(dps, () => {
    for (const cell of model.cells) {
      if (cell.p.lit) { m.set(cell, cell.p.lit); continue; }
      let v;
      try { v = E.norm(model.engine.ev(cell.p.node)); } catch (ex) { throw new CaseError([ex.msg || 'invalid expression']); }
      if (!E.isR(v)) throw new CaseError(['A case value must be a real number']);
      m.set(cell, v);
    }
  });
  model.decCache.set(dps, m);
  return m;
}

/** Bus types as MATPOWER applies them; checks that everything is connected to the slack bus. */
function typesAndIslands(model) {
  const n = model.buses.length, warnings = [];
  const genAt = Array.from({ length: n }, () => []);
  model.gens.forEach(g => { if (g.on && model.idx.has(g.bus)) genAt[model.idx.get(g.bus)].push(g); });
  const type = model.buses.map((b, k) => {
    if ((b.type === 'PV' || b.type === 'Slack') && !genAt[k].length) { warnings.push(`Bus ${b.n} is ${b.type} but has no generator in service: treated as PQ`); return 'PQ'; }
    return b.type;
  });
  let slack = type.indexOf('Slack');
  if (type.filter(t => t === 'Slack').length > 1) throw new CaseError(['More than one slack bus: keep exactly one']);
  if (slack < 0) {
    slack = type.indexOf('PV');
    if (slack < 0) throw new CaseError(['The case needs a slack bus with a generator in service']);
    warnings.push(`No slack bus: bus ${model.buses[slack].n} is used as the slack`);
    type[slack] = 'Slack';
  }
  const adj = Array.from({ length: n }, () => []);
  for (const br of model.branches) if (br.on) { const a = model.idx.get(br.f), b = model.idx.get(br.t); adj[a].push(b); adj[b].push(a); }
  const seen = new Array(n).fill(false), stack = [slack];
  seen[slack] = true;
  while (stack.length) for (const j of adj[stack.pop()]) if (!seen[j]) { seen[j] = true; stack.push(j); }
  const island = model.buses.filter((b, k) => !seen[k]).map(b => b.n);
  Object.assign(model, { type, slack, genAt, warnings, island });
}

// ═════════════════════════════════════════════════════════ admittance matrices (double and exact)
/** Branch admittance blocks, MATPOWER convention (tap and shift on the "from" side). */
function branchBlocksFloat(model, br, mods = {}) {
  const f = model.f;
  const r = mods.noR ? 0 : f(br.r), x = f(br.x);
  const den = r * r + x * x, ysr = r / den, ysi = -x / den;
  const bc = mods.noB ? 0 : f(br.b);
  let tap = mods.noTap ? 1 : f(br.tap) || 1;
  const sh = mods.noShift ? 0 : f(br.shift) * Math.PI / 180;
  const ttr = tap * Math.cos(sh), tti = tap * Math.sin(sh);
  const ytr = ysr, yti = ysi + bc / 2;
  const t2 = tap * tap;
  // Yft = -ys / conj(tt),  Ytf = -ys / tt
  const cden = ttr * ttr + tti * tti;
  const yft = [(-ysr * ttr + ysi * tti) / cden, (-ysi * ttr - ysr * tti) / cden];      // -ys·tt / |tt|²
  const ytf = [(-ysr * ttr - ysi * tti) / cden, (-ysi * ttr + ysr * tti) / cden];      // -ys·conj(tt) / |tt|²
  return { yff: [ytr / t2, yti / t2], yft, ytf, ytt: [ytr, yti] };
}
function ybusFloat(model, mods = {}) {
  const n = model.buses.length, G = new Float64Array(n * n), B = new Float64Array(n * n), base = model.f(model.base);
  for (const br of model.branches) {
    if (!br.on) continue;
    const a = model.idx.get(br.f), b = model.idx.get(br.t), y = branchBlocksFloat(model, br, mods);
    G[a * n + a] += y.yff[0]; B[a * n + a] += y.yff[1]; G[a * n + b] += y.yft[0]; B[a * n + b] += y.yft[1];
    G[b * n + a] += y.ytf[0]; B[b * n + a] += y.ytf[1]; G[b * n + b] += y.ytt[0]; B[b * n + b] += y.ytt[1];
  }
  if (!mods.noShunt) model.buses.forEach((bus, k) => { G[k * n + k] += model.f(bus.gs) / base; B[k * n + k] += model.f(bus.bs) / base; });
  return { G, B, n };
}
/** Exact branch blocks at the current precision. */
function branchBlocksDec(model, br, vals) {
  const D = Dn(), v = x => (x ? vals.get(x) : d(0));
  const ys = div(new D(1), E.norm(new Cx(v(br.r), v(br.x))));
  const bc = v(br.b), tap = br.tap && !vals.get(br.tap).isZero() ? vals.get(br.tap) : d(1);
  const sh = br.shift ? vals.get(br.shift) : d(0);
  const tt = sh.isZero() ? tap : mul(tap, I.cisHt(D.div(sh, 180)));
  const ytt = add(ys, new Cx(d(0), D.div(bc, 2)));
  return { yff: div(ytt, D.mul(tap, tap)), yft: div(mul(ys, d(-1)), conj(tt)), ytf: div(mul(ys, d(-1)), tt), ytt };
}
function ybusDec(model, vals) {
  const n = model.buses.length, rows = Array.from({ length: n }, () => new Map()), D = Dn();
  const put = (i, j, y) => rows[i].set(j, rows[i].has(j) ? add(rows[i].get(j), y) : y);
  const blocks = [];
  for (const br of model.branches) {
    if (!br.on) { blocks.push(null); continue; }
    const a = model.idx.get(br.f), b = model.idx.get(br.t), y = branchBlocksDec(model, br, vals);
    blocks.push(y);
    put(a, a, y.yff); put(a, b, y.yft); put(b, a, y.ytf); put(b, b, y.ytt);
  }
  const base = vals.get(model.base);
  model.buses.forEach((bus, k) => {
    const gs = bus.gs ? vals.get(bus.gs) : d(0), bs = bus.bs ? vals.get(bus.bs) : d(0);
    if (!gs.isZero() || !bs.isZero()) put(k, k, new Cx(D.div(gs, base), D.div(bs, base)));
  });
  return { rows: rows.map(r => [...r.entries()]), blocks };
}

// ═════════════════════════════════════════════════════════ dense double-precision linear algebra
function luFloat(A, n) {                     // real, partial pivoting, in place on a copy
  const a = Float64Array.from(A), p = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let m = k, best = Math.abs(a[k * n + k]);
    for (let r = k + 1; r < n; r++) { const v = Math.abs(a[r * n + k]); if (v > best) { best = v; m = r; } }
    if (best === 0 || !Number.isFinite(best)) return null;
    p[k] = m;
    if (m !== k) for (let c = 0; c < n; c++) { const t = a[k * n + c]; a[k * n + c] = a[m * n + c]; a[m * n + c] = t; }
    const piv = a[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = (a[r * n + k] /= piv);
      if (f !== 0) for (let c = k + 1; c < n; c++) a[r * n + c] -= f * a[k * n + c];
    }
  }
  return { a, p, n };
}
function solveFloat(L, b) {
  const { a, p, n } = L, x = Float64Array.from(b);
  for (let k = 0; k < n; k++) { const m = p[k]; if (m !== k) { const t = x[k]; x[k] = x[m]; x[m] = t; } }
  for (let r = 0; r < n; r++) { let s = x[r]; for (let c = 0; c < r; c++) s -= a[r * n + c] * x[c]; x[r] = s; }
  for (let r = n - 1; r >= 0; r--) { let s = x[r]; for (let c = r + 1; c < n; c++) s -= a[r * n + c] * x[c]; x[r] = s / a[r * n + r]; }
  return x;
}
/** Complex system as the equivalent real 2n×2n system [[G,-B],[B,G]]. */
function luComplexFloat(G, B, n) {
  const A = new Float64Array(4 * n * n), m = 2 * n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const g = G[i * n + j], b = B[i * n + j];
    A[i * m + j] = g; A[i * m + n + j] = -b; A[(n + i) * m + j] = b; A[(n + i) * m + n + j] = g;
  }
  return luFloat(A, m);
}

// ═════════════════════════════════════════════════════════ power flow in double precision
function specInjections(model, qfix) {
  const n = model.buses.length, base = model.f(model.base);
  const P = new Float64Array(n), Q = new Float64Array(n);
  model.buses.forEach((b, k) => { P[k] -= model.f(b.pd) / base; Q[k] -= model.f(b.qd) / base; });
  for (const g of model.gens) {
    if (!g.on || !model.idx.has(g.bus)) continue;
    const k = model.idx.get(g.bus);
    P[k] += model.f(g.pg) / base;
    Q[k] += model.f(g.qg) / base;
  }
  if (qfix) for (const [k, q] of qfix) Q[k] = q;         // buses switched to PQ at a Q limit
  return { P, Q };
}
function initialV(model, type, opts) {
  const n = model.buses.length, Vm = new Float64Array(n), Va = new Float64Array(n);
  model.buses.forEach((b, k) => {
    Vm[k] = opts.start === 'case' ? model.fOr(b.vm, 1) : 1;
    Va[k] = opts.start === 'case' ? model.fOr(b.va, 0) * Math.PI / 180 : 0;
    if (type[k] !== 'PQ') { const g = model.genAt[k][0]; if (g) Vm[k] = model.f(g.vg); }
  });
  if (opts.start !== 'case') Va[model.slack] = model.fOr(model.buses[model.slack].va, 0) * Math.PI / 180;
  return { Vm, Va };
}
function mismatchFloat(Y, Vm, Va, P, Q) {
  const { G, B, n } = Y, Vr = new Float64Array(n), Vi = new Float64Array(n), Ir = new Float64Array(n), Ii = new Float64Array(n);
  for (let k = 0; k < n; k++) { Vr[k] = Vm[k] * Math.cos(Va[k]); Vi[k] = Vm[k] * Math.sin(Va[k]); }
  for (let i = 0; i < n; i++) {
    let sr = 0, si = 0;
    for (let j = 0; j < n; j++) { const g = G[i * n + j], b = B[i * n + j]; if (g || b) { sr += g * Vr[j] - b * Vi[j]; si += g * Vi[j] + b * Vr[j]; } }
    Ir[i] = sr; Ii[i] = si;
  }
  const mr = new Float64Array(n), mi = new Float64Array(n);          // V·conj(I) − S
  for (let k = 0; k < n; k++) { mr[k] = Vr[k] * Ir[k] + Vi[k] * Ii[k] - P[k]; mi[k] = Vi[k] * Ir[k] - Vr[k] * Ii[k] - Q[k]; }
  return { Vr, Vi, Ir, Ii, mr, mi };
}
function jacobianFloat(Y, s, Vm, pvpq, pq) {
  const { G, B, n } = Y, np = pvpq.length, nq = pq.length, m = np + nq, J = new Float64Array(m * m);
  const col = new Int32Array(n).fill(-1), colq = new Int32Array(n).fill(-1);
  pvpq.forEach((k, c) => { col[k] = c; }); pq.forEach((k, c) => { colq[k] = c; });
  const rowP = pvpq, rowQ = pq;
  const put = (rowIdx, i, isQ) => {
    const r = isQ ? np + rowIdx : rowIdx;
    const Vr = s.Vr[i], Vi = s.Vi[i];
    for (let k = 0; k < n; k++) {
      const g = G[i * n + k], b = B[i * n + k];
      if (!(g || b) && k !== i) continue;
      // dS/dVa (i,k) = j·V_i·(conj(I_i)·δik − conj(Y_ik·V_k))
      const yvr = g * s.Vr[k] - b * s.Vi[k], yvi = g * s.Vi[k] + b * s.Vr[k];
      let ar = k === i ? s.Ir[i] - yvr : -yvr, ai = k === i ? -s.Ii[i] + yvi : yvi;          // conj(I)δ − conj(YV)
      const dvar = -(Vr * ai + Vi * ar), dvai = Vr * ar - Vi * ai;                            // j·V·(ar + j ai)
      // dS/dVm (i,k) = V_i·conj(Y_ik·Vn_k) + δik·conj(I_i)·Vn_i
      const vnr = s.Vr[k] / Vm[k], vni = s.Vi[k] / Vm[k];
      const ynr = g * vnr - b * vni, yni = g * vni + b * vnr;
      let dvmr = Vr * ynr + Vi * yni, dvmi = Vi * ynr - Vr * yni;
      if (k === i) { dvmr += s.Ir[i] * vnr + s.Ii[i] * vni; dvmi += s.Ir[i] * vni - s.Ii[i] * vnr; }
      if (col[k] >= 0) J[r * m + col[k]] = isQ ? dvai : dvar;
      if (colq[k] >= 0) J[r * m + np + colq[k]] = isQ ? dvmi : dvmr;
    }
  };
  rowP.forEach((i, c) => put(c, i, false));
  rowQ.forEach((i, c) => put(c, i, true));
  return { J, m };
}
const maxAbs = (a, idx) => idx.reduce((s, k) => Math.max(s, Math.abs(a[k])), 0);

function solveFloatPF(model, type, qfix, opts) {
  const n = model.buses.length, Y = ybusFloat(model);
  const { P, Q } = specInjections(model, qfix);
  let { Vm, Va } = initialV(model, type, opts);
  const pv = [], pq = [];
  type.forEach((t, k) => { if (t === 'PV') pv.push(k); else if (t === 'PQ') pq.push(k); });
  const pvpq = [...pv, ...pq].sort((a, b) => a - b);
  const pvpqOrd = [...pvpq], pqOrd = pq.slice().sort((a, b) => a - b);
  // 1e-10 pu, but not below the double-precision noise floor of the mismatch (≈ eps·max|Y_kk|), which a very
  // low-impedance branch (a bus tie) raises; the high-precision refinement closes the rest of the gap anyway
  let yMax = 0;
  for (let k = 0; k < n; k++) yMax = Math.max(yMax, Math.hypot(Y.G[k * n + k], Y.B[k * n + k]));
  const tol = opts.tol ?? Math.max(1e-10, 1e3 * Number.EPSILON * yMax), log = [];
  const snap = (it, s) => {
    const e = { it, dP: maxAbs(s.mr, pvpqOrd), dQ: maxAbs(s.mi, pqOrd) };
    if (n <= 20) e.V = Array.from(Vm), e.Va = Array.from(Va, a => a * 180 / Math.PI);
    log.push(e);
    return Math.max(e.dP, e.dQ);
  };
  let s = mismatchFloat(Y, Vm, Va, P, Q), it = 0, err = snap(0, s);
  const method = opts.method || 'nr';
  if (method === 'nr') {
    const maxIt = opts.maxIt ?? 30;
    while (err > tol && it < maxIt) {
      const { J, m } = jacobianFloat(Y, s, Vm, pvpqOrd, pqOrd);
      if (it === 0 && m <= 30) log[0].J = Array.from(J), log[0].Jn = m;
      const L = luFloat(J, m);
      if (!L) throw new CalcError('The Jacobian is singular: the case cannot be solved as entered', null, false);
      const F = new Float64Array(m);
      pvpqOrd.forEach((k, c) => { F[c] = s.mr[k]; }); pqOrd.forEach((k, c) => { F[pvpqOrd.length + c] = s.mi[k]; });
      const dx = solveFloat(L, F);
      pvpqOrd.forEach((k, c) => { Va[k] -= dx[c]; }); pqOrd.forEach((k, c) => { Vm[k] -= dx[pvpqOrd.length + c]; });
      s = mismatchFloat(Y, Vm, Va, P, Q); it++;
      err = snap(it, s);
      if (!Number.isFinite(err)) break;
    }
  } else if (method === 'fd') {
    const maxIt = opts.maxIt ?? 60;
    const Yp = ybusFloat(model, { noShunt: true, noB: true, noTap: true, noR: true });
    const Ypp = ybusFloat(model, { noShift: true });
    const sub_ = (M, rows) => { const k = rows.length, A = new Float64Array(k * k); rows.forEach((i, r) => rows.forEach((j, c) => { A[r * k + c] = -M.B[i * n + j]; })); return luFloat(A, k); };
    const Lp = sub_(Yp, pvpqOrd), Lpp = pqOrd.length ? sub_(Ypp, pqOrd) : null;
    if (!Lp || (pqOrd.length && !Lpp)) throw new CalcError('The fast-decoupled matrices are singular for this case');
    while (err > tol && it < maxIt) {
      let dP = Float64Array.from(pvpqOrd, k => s.mr[k] / Vm[k]);
      const dVa = solveFloat(Lp, dP);
      pvpqOrd.forEach((k, c) => { Va[k] -= dVa[c]; });
      s = mismatchFloat(Y, Vm, Va, P, Q);
      if (Lpp) {
        const dQ = Float64Array.from(pqOrd, k => s.mi[k] / Vm[k]);
        const dVm = solveFloat(Lpp, dQ);
        pqOrd.forEach((k, c) => { Vm[k] -= dVm[c]; });
        s = mismatchFloat(Y, Vm, Va, P, Q);
      }
      it++;
      err = snap(it, s);
      if (!Number.isFinite(err)) break;
    }
  } else if (method === 'gs') {
    const maxIt = opts.maxIt ?? 1000, alpha = opts.alpha ?? 1;
    const Vr = s.Vr, Vi = s.Vi, Vset = Float64Array.from(Vm), Qs = Float64Array.from(Q);
    const { G, B } = Y;
    const rowDot = k => { let r = 0, i = 0; for (let j = 0; j < n; j++) { const g = G[k * n + j], b = B[k * n + j]; if (g || b) { r += g * Vr[j] - b * Vi[j]; i += g * Vi[j] + b * Vr[j]; } } return [r, i]; };
    const update = (k, p, q) => {
      const [yr, yi] = rowDot(k);
      const den = Vr[k] * Vr[k] + Vi[k] * Vi[k];
      const sr = (p * Vr[k] + q * Vi[k]) / den, si = (p * Vi[k] - q * Vr[k]) / den;     // conj(S/V) = (P − jQ)·V/|V|²
      const g = G[k * n + k], b = B[k * n + k], dd = g * g + b * b;
      const nr = sr - yr, ni = si - yi;
      const dr = (nr * g + ni * b) / dd, di = (ni * g - nr * b) / dd;
      Vr[k] += alpha * dr; Vi[k] += alpha * di;
    };
    while (err > tol && it < maxIt) {
      for (const k of pqOrd) update(k, P[k], Q[k]);
      for (const k of pv) {
        const [yr, yi] = rowDot(k);
        Qs[k] = Vi[k] * yr - Vr[k] * yi;                          // imag(V·conj(Y·V))
        update(k, P[k], Qs[k]);
        const m = Math.hypot(Vr[k], Vi[k]); Vr[k] *= Vset[k] / m; Vi[k] *= Vset[k] / m;
      }
      for (let k = 0; k < n; k++) { Vm[k] = Math.hypot(Vr[k], Vi[k]); Va[k] = Math.atan2(Vi[k], Vr[k]); }
      s = mismatchFloat(Y, Vm, Va, P, Q);
      s.Vr.set(Vr); s.Vi.set(Vi);
      it++;
      err = snap(it, s);
      if (!Number.isFinite(err)) break;
    }
    s = mismatchFloat(Y, Vm, Va, P, Q);
  }
  return { Vm, Va, converged: err <= tol, iterations: it, log, pvpq: pvpqOrd, pq: pqOrd, pv, s, Y, P, Q };
}

/** Double-precision power flow with MATPOWER-style Q-limit enforcement. */
export function floatPowerFlow(model, opts = {}) {
  if (model.island.length) throw new CalcError(`Buses ${model.island.join(', ')} are not connected to the slack bus`);
  const type = model.type.slice(), qfix = new Map(), switched = [], base = model.f(model.base);
  const qlim = g => ({ min: g.qmin ? model.f(g.qmin) : -Infinity, max: g.qmax ? model.f(g.qmax) : Infinity });
  let sol, rounds = 0;
  for (;;) {
    sol = solveFloatPF(model, type, qfix, opts);
    if (!sol.converged || !opts.qlim || opts.method === 'dc') break;
    const viol = [];
    sol.pv.forEach(k => {
      const gens = model.genAt[k], Qtot = (sol.s.Vi[k] * sol.s.Ir[k] - sol.s.Vr[k] * sol.s.Ii[k]) * base + model.f(model.buses[k].qd);
      // the bus total against the sum of its generators' limits: with Q shared in proportion to the ranges this is
      // the per-generator check, and a bus with an unlimited generator (blank Qmax / Qmin) never switches
      const smax = gens.reduce((a, g) => a + qlim(g).max, 0), smin = gens.reduce((a, g) => a + qlim(g).min, 0);
      const hi = Qtot > smax + 1e-6, lo = Qtot < smin - 1e-6;
      if (hi || lo) viol.push([k, hi ? 'max' : 'min', hi ? smax : smin]);
    });
    if (!viol.length || ++rounds > 10) break;
    for (const [k, dir, qg] of viol) {
      type[k] = 'PQ';
      qfix.set(k, (qg - model.f(model.buses[k].qd)) / base);
      switched.push({ bus: model.buses[k].n, k, dir, at: qg });
    }
  }
  return { ...sol, type, qfix, switched };
}

// ═════════════════════════════════════════════════════════ verified refinement at the current precision
function smallExpJ(th) {                       // e^{jθ} for a small decimal angle, by series (exact to precision)
  const D = Dn();
  if (th.isZero()) return d(1);
  if (D.abs(th).gt('1e-3')) return new Cx(D.cos(th), D.sin(th));
  let re = d(1), im = d(0), term = d(1);
  const eps = new D(`1e-${D.dps + 5}`);
  for (let k = 1; k < 60; k++) {
    term = D.div(D.mul(term, th), k);
    if (D.abs(term).lt(eps)) break;
    const r = k % 4;
    if (r === 0) re = D.add(re, term); else if (r === 1) im = D.add(im, term); else if (r === 2) re = D.sub(re, term); else im = D.sub(im, term);
  }
  return new Cx(re, im);
}
function injectionsDec(model, vals) {
  const D = Dn(), n = model.buses.length, base = vals.get(model.base);
  const P = new Array(n).fill(d(0)), Q = new Array(n).fill(d(0));
  model.buses.forEach((b, k) => { if (b.pd) P[k] = D.sub(P[k], D.div(vals.get(b.pd), base)); if (b.qd) Q[k] = D.sub(Q[k], D.div(vals.get(b.qd), base)); });
  for (const g of model.gens) {
    if (!g.on || !model.idx.has(g.bus)) continue;
    const k = model.idx.get(g.bus);
    P[k] = D.add(P[k], D.div(vals.get(g.pg), base));
    if (g.qg) Q[k] = D.add(Q[k], D.div(vals.get(g.qg), base));
  }
  return { P, Q, base };
}
const l1 = z => (E.isC(z) ? Dn().add(Dn().abs(z.re), Dn().abs(z.im)) : Dn().abs(z));
/** Σ y·V, with a result below the working precision of its terms treated as 0 (cancellation noise). */
function sumTerms(terms) {
  let s = d(0), ref = d(0);
  for (const [y, v] of terms) { const t = mul(y, v); s = add(s, t); ref = Dn().add(ref, l1(t)); }
  return I.chopRef(s, ref);
}
function currentsDec(Yd, V) { return Yd.rows.map(row => sumTerms(row.map(([j, y]) => [y, V[j]]))); }

/**
 Newton refinement: exact mismatch at the current precision, correction from the double-precision
 Jacobian (factorised once). Returns the exact state and derived quantities.
*/
function refineDec(model, fsol, qfixExact) {
  const D = Dn(), vals = decValues(model, Math.max(50, D.dps));
  const n = model.buses.length, type = fsol.type;
  const Yd = ybusDec(model, vals);
  const { P, Q, base } = injectionsDec(model, vals, type, null);
  for (const [k] of fsol.qfix) Q[k] = qfixExact.get(k);
  // state: V = vr + j·vi, and for PQ buses the magnitude vm tracked exactly (no square roots in the loop)
  const vr = new Array(n), vi = new Array(n), vm = new Array(n);
  model.buses.forEach((b, k) => {
    let mag, c, s_;
    if (k === model.slack) {                                   // slack: magnitude and angle exactly as entered
      const va = b.va ? vals.get(b.va) : d(0);
      mag = vals.get(model.genAt[k][0].vg);
      const u = va.isZero() ? null : I.cisHt(D.div(va, 180));
      c = u ? I.re(u) : d(1); s_ = u ? I.im(u) : d(0);
    } else {
      mag = type[k] !== 'PQ' ? vals.get(model.genAt[k][0].vg) : d(fsol.Vm[k]);
      c = D.cos(d(fsol.Va[k])); s_ = D.sin(d(fsol.Va[k]));
    }
    vm[k] = mag; vr[k] = D.mul(mag, c); vi[k] = D.mul(mag, s_);
  });
  const rows = Yd.rows.map(row => row.map(([j, y]) => [j, I.re(y), I.im(y)]));
  const pvpq = fsol.pvpq, pq = fsol.pq, np = pvpq.length, m = np + pq.length;
  const Jf = jacobianFloat(fsol.Y, fsol.s, fsol.Vm, pvpq, pq), L = luFloat(Jf.J, Jf.m);
  const tol = new D(`1e-${D.dps - 3}`);
  let last = Infinity, stall = 0;
  const F = new Float64Array(m);
  for (let it = 0; ; it++) {
    if (it === 60) throw new CalcError('The refinement did not converge', null, true);
    let big = d(0);
    const cur = new Map();                                       // I_k = Σ y_kj·v_j, once per bus per step (P and Q share it)
    const mis = (k, wantQ) => {                                  // exact P or Q mismatch at bus k
      let c = cur.get(k);
      if (!c) {
        let ir = d(0), ii = d(0);
        for (const [j, yr, yi] of rows[k]) {
          ir = D.add(ir, D.sub(D.mul(yr, vr[j]), D.mul(yi, vi[j])));
          ii = D.add(ii, D.add(D.mul(yr, vi[j]), D.mul(yi, vr[j])));
        }
        cur.set(k, c = [ir, ii]);
      }
      const [ir, ii] = c;
      return wantQ ? D.sub(D.sub(D.mul(vi[k], ir), D.mul(vr[k], ii)), Q[k]) : D.sub(D.add(D.mul(vr[k], ir), D.mul(vi[k], ii)), P[k]);
    };
    pvpq.forEach((k, c) => { const x = mis(k, false); F[c] = x.toNumber(); big = D.max(big, D.abs(x)); });
    pq.forEach((k, c) => { const x = mis(k, true); F[np + c] = x.toNumber(); big = D.max(big, D.abs(x)); });
    if (big.lte(tol)) break;
    const bn = big.toNumber();
    if (bn >= last) { if (++stall >= 2) break; } else stall = 0;   // reached the precision floor
    last = bn;
    const dx = solveFloat(L, F);
    pvpq.forEach((k, c) => {                                     // rotate by −Δθ
      const e = smallExpJ(d(-dx[c])), er = I.re(e), ei = I.im(e);
      const r = D.sub(D.mul(vr[k], er), D.mul(vi[k], ei)); vi[k] = D.add(D.mul(vr[k], ei), D.mul(vi[k], er)); vr[k] = r;
    });
    pq.forEach((k, c) => {                                       // scale the magnitude: vm → vm − ΔVm
      const nv = D.sub(vm[k], d(dx[np + c])), f = D.div(nv, vm[k]);
      vr[k] = D.mul(vr[k], f); vi[k] = D.mul(vi[k], f); vm[k] = nv;
    });
  }
  const V = vr.map((r, k) => E.norm(new Cx(r, vi[k])));
  return { V, I: currentsDec(Yd, V), Yd, vals, base, P, Q };
}

/** Exact fixed Q injection (pu) of each bus switched to PQ at its generators' Q limit. */
function qfixExactOf(model, fsol) {
  const D = Dn(), vals = decValues(model, Math.max(50, D.dps)), base = vals.get(model.base), out = new Map();
  for (const sw of fsol.switched) {
    const lim = model.genAt[sw.k].reduce((s, g) => D.add(s, vals.get(sw.dir === 'max' ? g.qmax : g.qmin)), d(0));
    const qd = model.buses[sw.k].qd ? vals.get(model.buses[sw.k].qd) : d(0);
    out.set(sw.k, D.div(D.sub(lim, qd), base));
  }
  return out;
}
/** Q of each generator from its bus total, exactly: proportional to the Q ranges (as MATPOWER). */
function distributeQDec(gens, Qtot, vals) {
  const D = Dn();
  if (gens.length === 1) return [Qtot];
  const fin = gens.every(g => g.qmin && g.qmax);
  if (fin) {
    const qmin = gens.map(g => vals.get(g.qmin)), qmax = gens.map(g => vals.get(g.qmax));
    const smin = qmin.reduce((a, b) => D.add(a, b), d(0)), smax = qmax.reduce((a, b) => D.add(a, b), d(0));
    if (!smax.eq(smin)) return gens.map((g, i) => D.add(qmin[i], D.mul(D.div(D.sub(Qtot, smin), D.sub(smax, smin)), D.sub(qmax[i], qmin[i]))));
    return gens.map(() => D.div(Qtot, gens.length));
  }
  // some limit is blank: equal shares, but a generator whose share would break its own limit is held at that limit
  // and the rest is shared by the others (the unlimited ones always stay free)
  const q = new Array(gens.length).fill(null);
  let rest = Qtot;
  for (;;) {
    const free = gens.map((g, i) => i).filter(i => q[i] === null), share = D.div(rest, free.length);
    const held = free.filter(i => (gens[i].qmax && share.gt(vals.get(gens[i].qmax))) || (gens[i].qmin && share.lt(vals.get(gens[i].qmin))));
    if (!held.length || held.length === free.length) { for (const i of free) q[i] = share; return q; }
    for (const i of held) { q[i] = gens[i].qmax && share.gt(vals.get(gens[i].qmax)) ? vals.get(gens[i].qmax) : vals.get(gens[i].qmin); rest = D.sub(rest, q[i]); }
  }
}
/** Everything reported for a solved case, from the exact state. */
function results(model, fsol, ref) {
  const D = Dn(), { V, I: Ic, Yd, vals, base } = ref;
  const Sinj = V.map((v, k) => E.norm(mul(mul(v, conj(Ic[k])), base)));   // MVA; a component at the noise floor of |S| is 0
  const toDeg = a => D.div(D.mul(a, 180), I.PI());
  const pd = k => (model.buses[k].pd ? vals.get(model.buses[k].pd) : d(0));
  const qd = k => (model.buses[k].qd ? vals.get(model.buses[k].qd) : d(0));
  // Generation: only the unknowns are computed (slack P; Q at PV and slack buses), with cancellation-aware
  // subtraction; everything else is taken exactly from the data (as MATPOWER's pfsoln does).
  const given = (k, key) => model.genAt[k].reduce((acc, g) => (g[key] ? D.add(acc, vals.get(g[key])) : acc), d(0));
  const bus = model.buses.map((b, k) => {
    const vm = cabs(V[k]), va = toDeg(I.carg(V[k]));
    const kv = b.kv ? D.mul(vm, vals.get(b.kv)) : null;
    const lo = b.vmin && vm.lt(vals.get(b.vmin)), hi = b.vmax && vm.gt(vals.get(b.vmax));
    const t = fsol.type[k], sw = fsol.switched.find(x => x.k === k);
    const pg = t === 'Slack' ? E.diff(I.re(Sinj[k]), pd(k).neg()) : given(k, 'pg');
    const qg = (t === 'Slack' || t === 'PV') ? E.diff(I.im(Sinj[k]), qd(k).neg())
      : sw ? model.genAt[k].reduce((acc, g) => D.add(acc, vals.get(sw.dir === 'max' ? g.qmax : g.qmin)), d(0)) : given(k, 'qg');
    return { n: b.n, name: b.name, type: t, vm, va, kv, pg, qg, pd: pd(k), qd: qd(k), vio: lo ? 'low' : hi ? 'high' : null,
      hasGen: model.genAt[k].length > 0 };
  });
  const genQ = new Map(), genP = new Map();
  model.genAt.forEach((gens, k) => {
    if (!gens.length) return;
    const sw = fsol.switched.find(x => x.k === k);
    const qs = sw ? gens.map(g => vals.get(sw.dir === 'max' ? g.qmax : g.qmin))
      : fsol.type[k] === 'PQ' ? gens.map(g => (g.qg ? vals.get(g.qg) : d(0))) : distributeQDec(gens, bus[k].qg, vals);
    gens.forEach((g, i) => genQ.set(g, qs[i]));
    if (fsol.type[k] === 'Slack') {
      const others = gens.slice(1).reduce((s, g) => D.add(s, vals.get(g.pg)), d(0));
      gens.forEach((g, i) => genP.set(g, i === 0 ? D.sub(bus[k].pg, others) : vals.get(g.pg)));
    } else gens.forEach(g => genP.set(g, vals.get(g.pg)));
  });
  const gens = model.gens.filter(g => g.on && model.idx.has(g.bus)).map(g => {
    const q = genQ.get(g), lo = g.qmin ? vals.get(g.qmin) : null, hi = g.qmax ? vals.get(g.qmax) : null;
    const atLimit = fsol.qfix.has(model.idx.get(g.bus)) ? 'limit' : (hi && q.gt(hi.add('1e-6')) ? 'above' : lo && q.lt(lo.sub('1e-6')) ? 'below' : null);
    return { bus: g.bus, row: g.row, p: genP.get(g), q, qmin: lo, qmax: hi, atLimit };
  });
  const branches = [];
  model.branches.forEach((br, i) => {
    if (!br.on) return;
    const y = Yd.blocks[i], a = model.idx.get(br.f), b = model.idx.get(br.t);
    const If = sumTerms([[y.yff, V[a]], [y.yft, V[b]]]), It = sumTerms([[y.ytf, V[a]], [y.ytt, V[b]]]);
    const Sf = E.norm(mul(mul(V[a], conj(If)), base)), St = E.norm(mul(mul(V[b], conj(It)), base));
    const loss = E.diff(Sf, mul(St, d(-1)));
    const sf = cabs(Sf), st = cabs(St), rate = br.rate && !vals.get(br.rate).isZero() ? vals.get(br.rate) : null;
    const loading = rate ? D.div(D.mul(D.max(sf, st), 100), rate) : null;
    branches.push({ f: br.f, t: br.t, row: br.row, pf: I.re(Sf), qf: I.im(Sf), pt: I.re(St), qt: I.im(St),
      pl: I.re(loss), ql: I.im(loss), sf, st, rate, loading, over: loading && loading.gt(100) });
  });
  const sum = (arr, f) => arr.reduce((s, x) => D.add(s, f(x)), d(0));
  const totals = { pg: sum(bus, b => b.pg), qg: sum(bus, b => b.qg), pd: sum(bus, b => b.pd), qd: sum(bus, b => b.qd),
    pl: sum(branches, b => b.pl), ql: sum(branches, b => b.ql) };
  return { bus, gens, branches, totals, V };
}
function flatValues(r) {
  const out = [];
  for (const b of r.bus) out.push(b.vm, b.va, b.pg, b.qg);
  for (const g of r.gens) out.push(g.p, g.q);
  for (const b of r.branches) out.push(b.pf, b.qf, b.pt, b.qt, b.pl, b.ql);
  out.push(r.totals.pl, r.totals.ql);
  return out;
}

/** Full AC power flow: double-precision iterations (with log) + verified exact refinement. */
export function powerFlow(model, opts = {}) {
  if (opts.method === 'dc') return dcPowerFlow(model);
  const fsol = floatPowerFlow(model, opts);
  if (!fsol.converged) {
    const e = new CalcError(`${methodName(opts.method)} did not converge in ${fsol.iterations} iterations (largest mismatch ${fsol.log.at(-1) ? Math.max(fsol.log.at(-1).dP, fsol.log.at(-1).dQ).toExponential(2) : '?'} pu)`);
    e.log = fsol.log;
    throw e;
  }
  const [res, reliable, dps] = E.runVerified(() => results(model, fsol, refineDec(model, fsol, qfixExactOf(model, fsol))), flatValues);
  return { ...res, method: opts.method || 'nr', iterations: fsol.iterations, log: fsol.log, switched: fsol.switched,
    warnings: model.warnings, reliable, dps, type: fsol.type };
}
export const methodName = m => ({ nr: 'Newton-Raphson', fd: 'Fast decoupled', gs: 'Gauss-Seidel', dc: 'DC power flow' }[m || 'nr']);

// ═════════════════════════════════════════════════════════ exact linear solves by iterative refinement
/** Solve the complex system Y·x = b exactly at the current precision (double LU + exact residuals). */
function refinedSolve(rows, Lc, n, b) {
  const D = Dn(), x = new Array(n).fill(d(0));
  const tol = new D(`1e-${D.dps - 3}`);
  let last = Infinity, stall = 0;
  const bScale = b.reduce((s, v) => D.max(s, cabs(v)), d(0));
  for (let it = 0; it < 60; it++) {
    const r = rows.map((row, i) => sub(b[i], row.reduce((s, [j, y]) => add(s, mul(y, x[j])), d(0))));
    const big = r.reduce((s, v) => D.max(s, cabs(v)), d(0));
    if (big.lte(D.mul(tol, D.max(bScale, 1)))) break;
    const bn = big.toNumber();
    if (bn >= last) { if (++stall >= 2) break; } else stall = 0;
    last = bn;
    const rhs = new Float64Array(2 * n);
    r.forEach((v, i) => { rhs[i] = I.re(v).toNumber(); rhs[n + i] = I.im(v).toNumber(); });
    const dx = solveFloat(Lc, rhs);
    for (let i = 0; i < n; i++) x[i] = E.norm(add(x[i], new Cx(d(dx[i]), d(dx[n + i]))));
  }
  return x;
}
const rowsToFloat = (rows, n) => {
  const G = new Float64Array(n * n), B = new Float64Array(n * n);
  rows.forEach((row, i) => row.forEach(([j, y]) => { G[i * n + j] = I.re(y).toNumber(); B[i * n + j] = I.im(y).toNumber(); }));
  return { G, B };
};

// ═════════════════════════════════════════════════════════ DC power flow (MATPOWER makeBdc)
export function dcPowerFlow(model) {
  if (model.island.length) throw new CalcError(`Buses ${model.island.join(', ')} are not connected to the slack bus`);
  const n = model.buses.length, s = model.slack, others = [...Array(n).keys()].filter(k => k !== s), m = others.length;
  const pos = new Map(others.map((k, c) => [k, c]));
  const [res, reliable, dps] = E.runVerified(() => {
    const D = Dn(), vals = decValues(model, Math.max(50, D.dps)), base = vals.get(model.base);
    const Bb = Array.from({ length: n }, () => new Map()), Pinj = new Array(n).fill(d(0)), bs = [];
    const put = (i, j, v) => Bb[i].set(j, Bb[i].has(j) ? D.add(Bb[i].get(j), v) : v);
    for (const br of model.branches) {
      if (!br.on) { bs.push(null); continue; }
      const tap = br.tap && !vals.get(br.tap).isZero() ? vals.get(br.tap) : d(1);
      const b = D.div(1, D.mul(vals.get(br.x), tap)), a = model.idx.get(br.f), t = model.idx.get(br.t);
      const sh = br.shift ? D.div(D.mul(vals.get(br.shift), I.PI()), 180) : d(0);
      const pfinj = D.mul(b, sh.neg());
      bs.push({ b, pfinj, a, t });
      put(a, a, b); put(t, t, b); put(a, t, b.neg()); put(t, a, b.neg());
      Pinj[a] = D.add(Pinj[a], pfinj); Pinj[t] = D.sub(Pinj[t], pfinj);
    }
    const { P } = injectionsDec(model, vals, model.type, null);
    const va0 = model.buses[s].va ? D.div(D.mul(vals.get(model.buses[s].va), I.PI()), 180) : d(0);
    const rhs = others.map(k => {
      const gs = model.buses[k].gs ? D.div(vals.get(model.buses[k].gs), base) : d(0);
      return D.sub(D.sub(D.sub(P[k], Pinj[k]), gs), D.mul(Bb[k].get(s) || d(0), va0));
    });
    const rows = others.map(k => [...Bb[k].entries()].filter(([j]) => j !== s).map(([j, v]) => [pos.get(j), v]));
    const f = rowsToFloat(rows, m), Lc = luComplexFloat(f.G, f.B, m);
    if (!Lc) throw new CalcError('The DC network matrix is singular');
    const x = refinedSolve(rows, Lc, m, rhs);
    const Va = new Array(n); Va[s] = va0; others.forEach((k, c) => { Va[k] = I.re(x[c]); });
    const toDeg = a => D.div(D.mul(a, 180), I.PI());
    const branches = [];
    model.branches.forEach((br, i) => {
      if (!br.on) return;
      const q = bs[i], pf = D.mul(D.add(D.mul(q.b, D.sub(Va[q.a], Va[q.t])), q.pfinj), base);
      const rate = br.rate && !vals.get(br.rate).isZero() ? vals.get(br.rate) : null;
      const loading = rate ? D.div(D.mul(D.abs(pf), 100), rate) : null;
      branches.push({ f: br.f, t: br.t, row: br.row, pf, pt: pf.neg(), loading, rate, over: loading && loading.gt(100) });
    });
    const pd = k => (model.buses[k].pd ? vals.get(model.buses[k].pd) : d(0));
    const bus = model.buses.map((b, k) => ({ n: b.n, name: b.name, type: model.type[k], vm: d(1), va: toDeg(Va[k]), kv: null, pd: pd(k) }));
    // slack generation (DC is lossless): P_slack = [(Bbus·θ + Pbusinj)_s + Gs_s]·base + Pd_s
    let inj = Pinj[s];
    for (const [j, v] of Bb[s]) inj = D.add(inj, D.mul(v, Va[j]));
    const gsS = model.buses[s].gs ? D.div(vals.get(model.buses[s].gs), base) : d(0);
    const pslack = D.add(D.mul(D.add(inj, gsS), base), pd(s));
    bus.forEach((b, k) => { b.pg = k === s ? pslack : D.add(D.mul(P[k], base), pd(k)); });
    return { bus, branches, dc: true };
  }, r => [...r.bus.map(b => b.va), ...r.branches.map(b => b.pf), r.bus[s].pg]);
  return { ...res, method: 'dc', iterations: 1, log: [], switched: [], warnings: model.warnings, reliable, dps,
    gens: [], totals: null };
}

// ═════════════════════════════════════════════════════════ short circuit (sequence networks, Zbus columns)
export const FAULTS = { '3ph': 'Three-phase', slg: 'Single line-to-ground', ll: 'Line-to-line', llg: 'Double line-to-ground' };

function seqNetwork(model, vals, seq, opts, pfV) {
  const D = Dn(), n = model.buses.length, rows = Array.from({ length: n }, () => new Map());
  const put = (i, j, y) => rows[i].set(j, rows[i].has(j) ? add(rows[i].get(j), y) : y);
  const v = x => (x ? vals.get(x) : null);
  const need = [];
  for (const br of model.branches) {
    if (!br.on) continue;
    const a = model.idx.get(br.f), b = model.idx.get(br.t);
    const isTrafo = br.tap && !vals.get(br.tap).isZero();
    if (seq === 0) {
      const conn = br.conn || (isTrafo ? '' : 'line');
      if (!conn) { need.push(`Branch ${br.f}–${br.t}: zero-sequence connection`); continue; }
      if (conn === 'line' || conn === 'YNyn') {
        if (!br.x0) { need.push(`Branch ${br.f}–${br.t}: X0`); continue; }
        const y = div(d(1), E.norm(new Cx(v(br.r0) || d(0), v(br.x0))));
        put(a, a, y); put(b, b, y); put(a, b, mul(y, d(-1))); put(b, a, mul(y, d(-1)));
        if (conn === 'line' && br.b0) { const yc = new Cx(d(0), D.div(v(br.b0), 2)); put(a, a, yc); put(b, b, yc); }
      } else if (conn === 'YNd' || conn === 'Dyn') {
        const z = br.x0 ? new Cx(v(br.r0) || d(0), v(br.x0)) : new Cx(v(br.r) || d(0), v(br.x));
        put(conn === 'YNd' ? a : b, conn === 'YNd' ? a : b, div(d(1), E.norm(z)));
      }
      continue;                                  // Yd, Dy, Dd, Yy: no zero-sequence path
    }
    const ys = div(d(1), E.norm(new Cx(v(br.r) || d(0), v(br.x))));
    const tap = isTrafo ? vals.get(br.tap) : d(1);
    const full = opts.prefault === 'pf';
    const sh = full && br.shift ? vals.get(br.shift) : d(0);
    const tt = sh.isZero() ? tap : mul(tap, I.cisHt(D.div(seq === 2 ? sh.neg() : sh, 180)));
    const ytt = full && br.b ? add(ys, new Cx(d(0), D.div(v(br.b), 2))) : ys;
    put(a, a, div(ytt, D.mul(tap, tap))); put(b, b, ytt);
    put(a, b, div(mul(ys, d(-1)), conj(tt))); put(b, a, div(mul(ys, d(-1)), tt));
  }
  const base = vals.get(model.base);
  if (seq !== 0 && opts.prefault === 'pf') {
    model.buses.forEach((bus, k) => {
      const gs = v(bus.gs) || d(0), bs = v(bus.bs) || d(0);
      if (!gs.isZero() || !bs.isZero()) put(k, k, new Cx(D.div(gs, base), D.div(bs, base)));
      const pd = v(bus.pd) || d(0), qd = v(bus.qd) || d(0);
      if (!pd.isZero() || !qd.isZero()) {                           // loads as constant impedance at the prefault voltage
        const vm2 = D.pow(cabs(pfV[k]), 2);
        put(k, k, new Cx(D.div(D.div(pd, base), vm2), D.div(D.div(qd, base), vm2).neg()));
      }
    });
  }
  for (const g of model.gens) {
    if (!g.on || !model.idx.has(g.bus)) continue;
    const k = model.idx.get(g.bus);
    if (seq === 1) { if (!g.x1) { need.push(`Generator at bus ${g.bus}: X″d`); continue; } put(k, k, div(d(1), new Cx(d(0), v(g.x1)))); }
    if (seq === 2) { const x = v(g.x2) || v(g.x1); if (!x) { need.push(`Generator at bus ${g.bus}: X2 or X″d`); continue; } put(k, k, div(d(1), new Cx(d(0), x))); }
    if (seq === 0 && g.gnd !== 'ungrounded') {
      if (!g.x0) { need.push(`Generator at bus ${g.bus}: X0`); continue; }
      put(k, k, div(d(1), new Cx(d(0), D.add(v(g.x0), D.mul(3, v(g.xn) || d(0))))));
    }
  }
  if (need.length) throw new CaseError([`${['Zero', 'Positive', 'Negative'][seq]}-sequence data needed:`, ...[...new Set(need)]]);
  return rows.map(r => [...r.entries()]);
}
/** Column k of Zbus for one sequence network; buses with no path to ground in that network get null. */
function zbusColumn(rows, n, k) {
  // components of the network; a component without a shunt (path to ground) is floating: Z = ∞
  const adj = rows.map((row, i) => row.filter(([j]) => j !== i).map(([j]) => j));
  const comp = new Array(n).fill(-1);
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const st = [i]; comp[i] = c;
    while (st.length) for (const j of adj[st.pop()]) if (comp[j] < 0) { comp[j] = c; st.push(j); }
    c++;
  }
  const f = rowsToFloat(rows, n);
  const grounded = new Set();
  for (let i = 0; i < n; i++) { let s = 0, sb = 0; for (let j = 0; j < n; j++) { s += f.G[i * n + j]; sb += f.B[i * n + j]; } if (Math.hypot(s, sb) > 1e-12 * Math.hypot(f.G[i * n + i], f.B[i * n + i])) grounded.add(comp[i]); }
  if (!grounded.has(comp[k])) return null;                       // floating at the fault: infinite impedance
  const keep = [...Array(n).keys()].filter(i => comp[i] === comp[k]), pos = new Map(keep.map((i, c2) => [i, c2]));
  const sub_ = keep.map(i => rows[i].filter(([j]) => pos.has(j)).map(([j, y]) => [pos.get(j), y]));
  const fs = rowsToFloat(sub_, keep.length), Lc = luComplexFloat(fs.G, fs.B, keep.length);
  if (!Lc) throw new CalcError('A sequence network matrix is singular', null, true);
  const e = keep.map(i => (i === k ? d(1) : d(0)));
  const z = refinedSolve(sub_, Lc, keep.length, e);
  const col = new Array(n).fill(d(0));
  keep.forEach((i, c2) => { col[i] = z[c2]; });
  return col;
}

const DELTA_WYE = new Set(['YNd', 'Dyn', 'Yd', 'Dy']);
/** Phase shift of each bus's zone (degrees, positive sequence) relative to the faulted bus k, whose phase labels the
 *  fault conditions use. A Δ-Y transformer is taken as clock 11 (Dyn11, YNd11: the to side leads by 30°), unless the
 *  branch has its own shift (MATPOWER sign: a positive shift makes the to side lag); with a power-flow prefault that
 *  shift is already in the network, so it adds nothing here. -> array of Decimal or null (no shift). */
function zoneShifts(model, vals, k, pfMode) {
  const n = model.buses.length, adj = Array.from({ length: n }, () => []);
  for (const br of model.branches) {
    if (!br.on) continue;
    const sh = br.shift ? vals.get(br.shift) : d(0);
    const lead = !sh.isZero() ? (pfMode ? d(0) : sh.neg()) : DELTA_WYE.has(br.conn) ? d(30) : d(0);
    if (lead.isZero()) continue;
    const a = model.idx.get(br.f), b = model.idx.get(br.t);
    adj[a].push([b, lead]); adj[b].push([a, lead.neg()]);
  }
  const rot = new Array(n).fill(null), seen = new Array(n).fill(false), st = [k];
  seen[k] = true;
  // zones are joined by every in-service branch; only the shifting ones change the angle
  const all = Array.from({ length: n }, () => []);
  for (const br of model.branches) { if (!br.on) continue; const a = model.idx.get(br.f), b = model.idx.get(br.t); all[a].push(b); all[b].push(a); }
  while (st.length) {
    const i = st.pop(), base = rot[i] || d(0);
    for (const j of all[i]) {
      if (seen[j]) continue;
      const e = adj[i].find(([m]) => m === j);
      const r = e ? base.add(e[1]) : base;
      rot[j] = r.isZero() ? null : r; seen[j] = true; st.push(j);
    }
  }
  return rot;
}

export function shortCircuit(model, opts) {
  const k = model.idx.get(opts.bus);
  if (k === undefined) throw new CalcError(`Bus ${opts.bus} is not in service`);
  const kind = opts.type;
  let fsol = null;
  if (opts.prefault === 'pf') {
    fsol = floatPowerFlow(model, { qlim: opts.qlim });
    if (!fsol.converged) throw new CalcError('The prefault power flow did not converge');
  }
  const [res, reliable, dps] = E.runVerified(() => {
    const D = Dn(), vals = decValues(model, Math.max(50, D.dps)), n = model.buses.length;
    let Vpre;
    if (fsol) Vpre = refineDec(model, fsol, qfixExactOf(model, fsol)).V;
    else Vpre = model.buses.map(() => d(1));
    const Zf = opts.zf ? E.norm(opts.zf) : d(0);
    const z1 = zbusColumn(seqNetwork(model, vals, 1, opts, Vpre), n, k);
    if (!z1) throw new CalcError('The positive-sequence network has no source: add generator X″d values');
    const z2 = kind === '3ph' ? z1 : zbusColumn(seqNetwork(model, vals, 2, opts, Vpre), n, k) || z1;
    const z0 = kind === 'slg' || kind === 'llg' ? zbusColumn(seqNetwork(model, vals, 0, opts, Vpre), n, k) : null;
    const Vf = Vpre[k], Z1 = z1[k], Z2 = z2[k], Z0 = z0 ? z0[k] : null, zf3 = mul(Zf, d(3));
    let I1 = d(0), I2 = d(0), I0 = d(0);
    if (kind === '3ph') I1 = div(Vf, add(Z1, Zf));
    else if (kind === 'slg') { if (Z0) { I1 = div(Vf, add(add(add(Z0, Z1), Z2), zf3)); I2 = I1; I0 = I1; } }
    else if (kind === 'll') { I1 = div(Vf, add(add(Z1, Z2), Zf)); I2 = mul(I1, d(-1)); }
    else if (kind === 'llg') {
      if (!Z0) { I1 = div(Vf, add(Z1, Z2)); I2 = mul(I1, d(-1)); }
      else {
        const z03 = add(Z0, zf3), par = div(mul(Z2, z03), add(Z2, z03));
        I1 = div(Vf, add(Z1, par));
        I2 = mul(mul(I1, d(-1)), div(z03, add(z03, Z2)));
        I0 = mul(mul(I1, d(-1)), div(Z2, add(z03, Z2)));
      }
    }
    const a = I.aOp(), a2 = I.a2Op();
    const one = d(1);   // phase quantities: sums whose exact cancellation (e.g. a faulted phase) must give 0
    const abc = (x0, x1, x2) => [sumTerms([[one, x0], [one, x1], [one, x2]]), sumTerms([[one, x0], [a2, x1], [a, x2]]),
      sumTerms([[one, x0], [a, x1], [a2, x2]])].map(E.norm);
    const Iabc = abc(I0, I1, I2);
    const base = vals.get(model.base), kv = model.buses[k].kv ? vals.get(model.buses[k].kv) : null;
    const Ibase = kv && !kv.isZero() ? D.div(base, D.mul(D.sqrt(3), kv)) : null;   // kA
    const rot = zoneShifts(model, vals, k, opts.prefault === 'pf');
    const bus = model.buses.map((b, i) => {
      let V1 = E.norm(E.diff(Vpre[i], mul(z1[i], I1))), V2 = mul(mul(z2[i], I2), d(-1));
      const V0 = z0 ? mul(mul(z0[i], I0), d(-1)) : d(0);
      // across Δ-Y transformers positive-sequence quantities turn by +θ and negative-sequence ones by −θ
      if (rot[i]) { V1 = E.norm(mul(V1, I.cisHt(D.div(rot[i], 180)))); V2 = E.norm(mul(V2, I.cisHt(D.div(rot[i].neg(), 180)))); }
      const [Va, Vb, Vc] = abc(V0, V1, V2);
      return { n: b.n, va: Va, vb: Vb, vc: Vc, vam: cabs(Va), vbm: cabs(Vb), vcm: cabs(Vc) };
    });
    const If = kind === '3ph' ? I1 : kind === 'slg' ? Iabc[0] : Iabc[1];
    return { If: E.norm(If), Ifm: cabs(If), IfkA: Ibase ? D.mul(cabs(If), Ibase) : null, seq: [I0, I1, I2].map(E.norm), abc: Iabc,
      abckA: Ibase ? Iabc.map(x => D.mul(cabs(x), Ibase)) : null, Z: { z1: Z1, z2: Z2, z0: Z0 }, bus,
      Sk: kind === '3ph' ? D.mul(D.mul(cabs(I1), cabs(Vf)), base) : null, z0inf: (kind === 'slg' || kind === 'llg') && !Z0 };
  }, r => [r.Ifm, ...r.seq, ...r.abc, ...r.bus.flatMap(b => [b.vam, b.vbm, b.vcm])]);
  return { ...res, reliable, dps, busNum: opts.bus, kind };
}

// ═════════════════════════════════════════════════════════ N-1 contingency analysis
/** Outages to study: every in-service branch and every generator not at the slack bus. */
export function outages(model) {
  const list = [];
  model.branches.forEach(br => { if (br.on) list.push({ kind: 'branch', row: br.row, label: `Branch ${br.f}–${br.t}` }); });
  model.gens.forEach(g => { if (g.on && model.idx.has(g.bus) && model.idx.get(g.bus) !== model.slack) list.push({ kind: 'gen', row: g.row, label: `Generator at bus ${g.bus}` }); });
  return list;
}
/** One contingency: the case with one element out, solved and verified; summarised for ranking. */
function outageCase(caseData, outage) {
  const c = JSON.parse(JSON.stringify(caseData));
  if (outage.kind === 'branch') c.branches[outage.row].on = '0'; else c.gens[outage.row].on = '0';
  return c;
}
/** One outage, solved and verified. Only a summary is kept (a full result is ~160 KB on case30): solveOutage
 *  re-solves it when its details are wanted. */
export function runOutage(caseData, engine, outage, opts) {
  const c = outageCase(caseData, outage);
  let model;
  try { model = compile(c, engine); } catch (ex) { return { outage, status: 'invalid', note: (ex.issues || [ex.msg])[0] }; }
  if (model.island.length) {
    // ranked by the load it cuts off: an isolated bus without load (e.g. a condenser) is not a severe outage
    const lost = model.buses.filter(b => model.island.includes(b.n)).reduce((a, b) => a + (b.pd ? model.f(b.pd) : 0), 0);
    return { outage, status: 'islanding', note: `Buses ${model.island.join(', ')} isolated${lost ? `, ${+lost.toFixed(3)} MW of load cut off` : ', no load cut off'}`,
      severity: lost > 0 ? 1e6 + lost : 1 };
  }
  let r;
  try { r = powerFlow(model, { ...opts, method: 'nr' }); } catch (ex) { return { outage, status: 'diverged', note: ex.msg, severity: 1e5 }; }
  let worst = null, vmin = null, vmax = null, violations = 0;
  for (const b of r.branches) { if (b.loading && (!worst || b.loading.gt(worst.loading))) worst = b; if (b.over) violations++; }
  for (const b of r.bus) { if (!vmin || b.vm.lt(vmin.vm)) vmin = b; if (!vmax || b.vm.gt(vmax.vm)) vmax = b; if (b.vio) violations++; }
  const sev = violations * 1000 + (worst ? worst.loading.toNumber() : 0);
  return { outage, status: violations ? 'violations' : 'ok', violations, worst, vmin, vmax, loss: r.totals.pl, solved: true, severity: sev };
}
/** The full result of one outage, with the model it was solved on (whose Ybus goes with its V). */
export function solveOutage(caseData, engine, outage, opts) {
  const model = compile(outageCase(caseData, outage), engine);
  return { model, result: powerFlow(model, { ...opts, method: 'nr' }) };
}


/** The bus admittance matrix as sparse rows (pu), at the current precision — for "send to calculator". */
export function ybusRows(model) { return ybusDec(model, decValues(model, Math.max(50, Dn().dps))).rows; }
