/*
 EE Calc — energy-systems tools (JavaScript port of energy.py).
 Each tool is plain data (fields, units, description) plus a formula; results are verified by the
 engine at rising precision exactly like calculator results.

 Conventions (three-phase, balanced): V is line-to-line (its angle, if any, is the phase-voltage
 angle, V_an = 0°); I is the line current, angle measured from V_an; S = √3·V·I* = P + jQ, Q > 0 lagging.
*/
import Decimal from './decimal.js';
import * as E from './engine.js';

const I = E.internals;
const D = () => I.D;
const { Angle, CalcError, Cx, isR, isC, isA, isM } = E;
const { add, mul, div, conj, cabs, carg, csqrt, PI, re, im, isZero } = I;
const sq3 = () => D().sqrt(3);
const n = x => new (D())(x);

export class Field {
  constructor(key, label, unit = '', optional = false, deflt = '') {
    Object.assign(this, { key, label, unit, optional, default: deflt });
  }
}
/** Selector field: options [[value, label]]; never missing (falls back to the default). */
export class Choice {
  constructor(key, label, options, deflt = options[0][0]) {
    Object.assign(this, { key, label, options, default: deflt, choice: true, optional: true, unit: '' });
  }
}
/** List field: up to `max` values separated by ';' (each an expression). */
export class List extends Field {
  constructor(key, label, unit = '', max = 12) { super(key, label, unit, true); this.list = true; this.max = max; }
}
export class Out {
  constructor(key, label, value, unit = '', fmt = 'eng', note = '') {
    Object.assign(this, { key, label, value, unit, fmt, note });
  }
}
/** A table cell: shown in a grid (row `row`) instead of the result list; verified like any output. */
const Cell = (key, label, value, unit, row) => Object.assign(new Out(key, label, value, unit, 'plain'), { row });
export class Incomplete extends Error {
  constructor(labels) { super(labels.join(', ')); this.labels = labels; }
}

class Inputs {
  constructor(vals, labels) { this.vals = vals; this.labels = labels; }
  has(k) { return this.vals[k] != null; }
  choice(k) { return this.vals[k]; }
  list(k, opts) {
    const v = this.vals[k] || [];
    return v.map((x, i) => this.x(k, opts, x, i + 1));
  }
  z(k) {
    const v = this.vals[k];
    if (isA(v) || isM(v)) throw new CalcError(`${this.labels[k]}: expects a number or a phasor`);
    return E.norm(v);
  }
  x(k, { positive = false, lo = null, hi = null } = {}, raw, idx) {
    const v = raw === undefined ? this.z(k) : E.norm(raw);
    const lab = idx ? `${this.labels[k]} (value ${idx})` : this.labels[k];
    if (isA(v) || isM(v) || !isR(v)) throw new CalcError(`${lab}: must be a real number`);
    if (positive && !v.gt(0)) throw new CalcError(`${lab}: must be greater than zero`);
    if (lo !== null && v.lt(lo)) throw new CalcError(`${lab}: must be at least ${E.fmtReal(new Decimal(lo), 6)}`);
    if (hi !== null && v.gt(hi)) throw new CalcError(`${lab}: must be at most ${E.fmtReal(new Decimal(hi), 6)}`);
    return v;
  }
}

const angleOf = z => (isZero(z) ? new Angle(n(0)) : new Angle(D().div(carg(z), PI())));
function pfOuts(S) {
  S = E.norm(S);
  const m = cabs(S);
  if (m.isZero()) return [];
  const q = im(S);
  const note = q.isZero() ? 'unity' : q.gt(0) ? 'lagging' : 'leading';
  return [new Out('PF', 'pf', D().div(D().abs(re(S)), m), '', 'plain', note), new Out('phi', 'φ', angleOf(S), '')];
}
const diff = E.diff;
function nzv(x, what) { if (isZero(E.norm(x))) throw new CalcError(`${what} can't be zero`, null, true); return x; }
const hsinh = z => (isR(z) ? I.rsinh(z) : I.csinh(z));
const hcosh = z => (isR(z) ? I.rcosh(z) : I.ccosh(z));

// ── formulas ─────────────────────────────────────────────────────────────────
function tPower3(c) {
  const S = mul(mul(sq3(), c.z('V')), conj(c.z('I')));
  return [new Out('S', 'S', S, 'VA'), new Out('P', 'P', re(S), 'W'), new Out('Q', 'Q', im(S), 'var'),
    new Out('Smag', '|S|', cabs(S), 'VA'), ...pfOuts(S)];
}
function tCurrent(c) {
  const P = c.x('P'), Q = c.has('Q') ? c.x('Q') : n(0), V = nzv(c.z('V'), 'V');
  const S = new Cx(P, Q), Ic = conj(div(S, mul(sq3(), V)));
  return [new Out('I', 'I', Ic, 'A'), new Out('Imag', '|I|', cabs(Ic), 'A'), new Out('Smag', '|S|', cabs(S), 'VA'), ...pfOuts(S)];
}
function tPfc(c) {
  const d = D();
  const P = c.x('P', { positive: true }), pf1 = c.x('pf1', { lo: '1e-6', hi: 1 }), pf2 = c.x('pf2', { lo: '1e-6', hi: 1 });
  const V = c.x('V', { positive: true }), f = c.x('f', { positive: true });
  if (!pf2.gt(pf1)) throw new CalcError('The target pf must be higher than the present pf');
  const tan1 = d.div(d.sqrt(diff(n(1), d.mul(pf1, pf1))), pf1), tan2 = d.div(d.sqrt(diff(n(1), d.mul(pf2, pf2))), pf2);
  const Qc = d.mul(P, diff(tan1, tan2)), w = d.mul(d.mul(2, PI()), f), V2 = d.mul(V, V);
  return [new Out('Qc', 'Qc', Qc, 'var', 'eng', 'capacitor bank, three-phase'),
    new Out('CY', 'C (star)', d.div(Qc, d.mul(w, V2)), 'F', 'eng', 'per phase'),
    new Out('CD', 'C (delta)', d.div(Qc, d.mul(d.mul(3, w), V2)), 'F', 'eng', 'per phase'),
    new Out('Q1', 'Q before', d.mul(P, tan1), 'var'), new Out('Q2', 'Q after', d.mul(P, tan2), 'var'),
    new Out('I1', 'I before', d.div(P, d.mul(d.mul(pf1, sq3()), V)), 'A'),
    new Out('I2', 'I after', d.div(P, d.mul(d.mul(pf2, sq3()), V)), 'A')];
}
function tPu(c) {
  const d = D(), S = c.x('S', { positive: true }), V = c.x('V', { positive: true });
  const Zb = d.div(d.mul(V, V), S), Ib = d.div(S, d.mul(sq3(), V));
  const out = [new Out('Zb', 'Z base', Zb, 'Ω'), new Out('Ib', 'I base', Ib, 'A'), new Out('Yb', 'Y base', d.div(S, d.mul(V, V)), 'S')];
  if (c.has('Z')) out.push(new Out('zpu', 'z', div(c.z('Z'), Zb), 'pu', 'plain'));
  if (c.has('I')) out.push(new Out('ipu', 'i', div(c.z('I'), Ib), 'pu', 'plain'));
  return out;
}
function tChbase(c) {
  const d = D(), z = c.z('z');
  const vo = c.x('Vo', { positive: true }), so = c.x('So', { positive: true });
  const vn = c.x('Vn', { positive: true }), sn = c.x('Sn', { positive: true });
  const r = d.div(vo, vn);
  return [new Out('znew', 'z new', mul(z, d.mul(d.mul(r, r), d.div(sn, so))), 'pu', 'plain')];
}
function tSeq(c) {
  const d = D(), m = E.FUNCS.get('seq').f(null, [c.z('Va'), c.z('Vb'), c.z('Vc')], null);
  const [v0, v1, v2] = m.a.map(x => E.norm(x));
  const out = [new Out('V0', 'V0 (zero)', v0, '', 'plain'), new Out('V1', 'V1 (positive)', v1, '', 'plain'),
    new Out('V2', 'V2 (negative)', v2, '', 'plain')];
  const m1 = cabs(v1);
  if (!m1.isZero()) out.push(new Out('u2', '|V2| / |V1|', d.div(d.mul(100, cabs(v2)), m1), '%', 'plain', 'unbalance'),
    new Out('u0', '|V0| / |V1|', d.div(d.mul(100, cabs(v0)), m1), '%', 'plain'));
  return out;
}
function tY2d(c) {
  const [zab, zbc, zca] = E.starToDelta(c.z('Za'), c.z('Zb'), c.z('Zc'));
  return [new Out('Zab', 'Zab', zab, 'Ω'), new Out('Zbc', 'Zbc', zbc, 'Ω'), new Out('Zca', 'Zca', zca, 'Ω')];
}
function tD2y(c) {
  const [za, zb, zc] = E.deltaToStar(c.z('Zab'), c.z('Zbc'), c.z('Zca'));
  return [new Out('Za', 'Za', za, 'Ω'), new Out('Zb', 'Zb', zb, 'Ω'), new Out('Zc', 'Zc', zc, 'Ω')];
}
function tVdrop(c) {
  const d = D(), R = c.x('R'), X = c.x('X'), P = c.x('P'), Q = c.has('Q') ? c.x('Q') : n(0), V = c.x('V', { positive: true });
  const Ic = conj(div(new Cx(P, Q), mul(sq3(), V)));
  const vs = add(d.div(V, sq3()), mul(new Cx(R, X), Ic));
  const Vs = d.mul(sq3(), cabs(vs)), dV = diff(Vs, V), I2 = d.mul(cabs(Ic), cabs(Ic));
  return [new Out('dV', 'ΔV', dV, 'V', 'eng', 'exact'), new Out('dVpct', 'ΔV', d.div(d.mul(100, dV), V), '%', 'plain', 'exact'),
    new Out('dVa', 'ΔV ≈ (RP+XQ)/V', d.div(d.add(d.mul(R, P), d.mul(X, Q)), V), 'V', 'eng', 'approximation'),
    new Out('Vs', 'V sending', Vs, 'V'), new Out('delta', 'δ', angleOf(vs), ''), new Out('Imag', '|I|', cabs(Ic), 'A'),
    new Out('Ploss', 'P loss', d.mul(d.mul(3, I2), R), 'W'), new Out('Qloss', 'Q loss', d.mul(d.mul(3, I2), X), 'var')];
}
function tLine(c) {
  const d = D(), z = c.z('z'), y = c.z('y'), len = c.x('l', { positive: true });
  nzv(y, 'y'); nzv(z, 'z');
  const zc = csqrt(E.norm(div(z, y))), g = csqrt(E.norm(mul(z, y)));
  const gl = E.checkGrowth(E.norm(mul(g, len)), null);
  const A = hcosh(gl), sh = hsinh(gl), B = mul(zc, sh), C = div(sh, zc);
  const out = [new Out('Zc', 'Zc', zc, 'Ω'), new Out('gamma', 'γ', g, '1/km', 'plain'),
    new Out('A', 'A = D', A, '', 'plain'), new Out('B', 'B', B, 'Ω'), new Out('C', 'C', C, 'S')];
  if (c.has('VR')) {
    const VR = c.x('VR', { positive: true });
    out.push(new Out('SIL', 'SIL', d.div(d.mul(VR, VR), cabs(zc)), 'W', 'eng', 'V² / |Zc|'));
    if (c.has('SR')) {
      const SR = c.z('SR'), vr = d.div(VR, sq3()), ir = conj(div(SR, d.mul(3, vr)));
      const vs = add(mul(A, vr), mul(B, ir)), is_ = add(mul(C, vr), mul(A, ir));
      const SS = mul(mul(n(3), vs), conj(is_)), Vs = d.mul(sq3(), cabs(vs));
      out.push(new Out('Vs', 'V sending', Vs, 'V', 'eng', 'line-to-line'), new Out('delta', 'δ', angleOf(vs), '', 'eng', 'load angle'),
        new Out('Is', 'I sending', is_, 'A'), new Out('Ss', 'S sending', SS, 'VA'),
        new Out('Ploss', 'P loss', diff(re(SS), re(SR)), 'W'));
      if (re(SS).gt(0)) out.push(new Out('eta', 'η', d.div(d.mul(100, re(SR)), re(SS)), '%', 'plain'));
      out.push(new Out('reg', 'Regulation', d.div(d.mul(100, diff(d.div(Vs, cabs(A)), VR)), VR), '%', 'plain',
        '(V no-load − V load) / V load'));
    }
  }
  return out;
}
function tTrafo(c) {
  const d = D(), Sn = c.x('Sn', { positive: true }), Vn = c.x('Vn', { positive: true });
  const uk = d.div(c.x('uk', { positive: true, hi: 100 }), 100), Pk = c.x('Pk', { lo: 0 }), rk = d.div(Pk, Sn);
  if (rk.gt(uk)) throw new CalcError('Pk / Sn is larger than uk: check the test data');
  const xk = d.sqrt(diff(d.mul(uk, uk), d.mul(rk, rk))), Zb = d.div(d.mul(Vn, Vn), Sn);
  const out = [new Out('zk', 'zk', uk, 'pu', 'plain'), new Out('rk', 'rk', rk, 'pu', 'plain'), new Out('xk', 'xk', xk, 'pu', 'plain'),
    new Out('Zk', 'Zk', mul(new Cx(rk, xk), Zb), 'Ω', 'eng', 'per phase, star'),
    new Out('Rk', 'Rk', d.mul(rk, Zb), 'Ω'), new Out('Xk', 'Xk', d.mul(xk, Zb), 'Ω')];
  if (c.has('i0') && c.has('P0')) {
    const y0 = d.div(c.x('i0', { positive: true, hi: 100 }), 100), g0 = d.div(c.x('P0', { lo: 0 }), Sn);
    if (g0.gt(y0)) throw new CalcError('P0 / Sn is larger than i0: check the test data');
    const b0 = d.sqrt(diff(d.mul(y0, y0), d.mul(g0, g0)));
    if (!g0.isZero()) out.push(new Out('Rfe', 'R_fe', d.div(Zb, g0), 'Ω', 'eng', 'shunt, per phase'));
    if (!b0.isZero()) out.push(new Out('Xm', 'X_m', d.div(Zb, b0), 'Ω', 'eng', 'shunt, per phase'));
  }
  return out;
}
function tSc(c) {
  const d = D(), Un = c.x('Un', { positive: true }), Sk = c.x('Sk', { positive: true });
  const cf = c.x('c', { positive: true }), rx = c.x('RX', { lo: 0 });
  const ZQ = d.div(d.mul(cf, d.mul(Un, Un)), Sk), XQ = d.div(ZQ, d.sqrt(d.add(1, d.mul(rx, rx)))), RQ = d.mul(rx, XQ);
  const Ik = d.div(d.mul(cf, Un), d.mul(sq3(), ZQ));
  const kappa = d.add(n('1.02'), d.mul(n('0.98'), d.exp(d.mul(-3, rx))));
  return [new Out('ZQ', 'Z_Q', new Cx(RQ, XQ), 'Ω', 'eng', 'per phase'), new Out('RQ', 'R_Q', RQ, 'Ω'), new Out('XQ', 'X_Q', XQ, 'Ω'),
    new Out('Ik', 'I_k″', Ik, 'A', 'eng', 'initial symmetrical'), new Out('kappa', 'κ', kappa, '', 'plain'),
    new Out('ip', 'i_p', d.mul(d.mul(kappa, d.sqrt(2)), Ik), 'A', 'eng', 'peak')];
}
function tIm(c) {
  const d = D(), f = c.x('f', { positive: true }), poles = c.x('poles', { positive: true });
  const p2 = E.toInt(poles, null, 'number of poles');
  if (p2 < 2 || p2 % 2) throw new CalcError('Number of poles: must be an even number (2, 4, 6…)');
  const ns = d.div(d.mul(120, f), p2);
  const out = [new Out('ns', 'n_s', ns, 'rpm', 'plain'), new Out('ws', 'ω_s', d.div(d.mul(d.mul(2, PI()), ns), 60), 'rad/s', 'plain')];
  if (c.has('n')) {
    const s = d.div(diff(ns, c.x('n')), ns);
    out.push(new Out('s', 's', s, '', 'plain', 'slip'), new Out('spct', 's', d.mul(100, s), '%', 'plain'), new Out('fr', 'f rotor', d.mul(s, f), 'Hz', 'plain'));
  }
  return out;
}

// ── catalogue ────────────────────────────────────────────────────────────────
// Heavier tools live in their own module, loaded on first use (see ready()).
const machines = () => import('./machines.js');
const IM_CONN = [['Y', 'Star (Y)'], ['D', 'Delta (Δ)']];
const IM_MODEL = [['exact', 'Exact T'], ['approx', 'Approximate']];
const IM_CLASS = [['AD', 'A, D, wound'], ['B', 'B'], ['C', 'C']];
const F = (...a) => new Field(...a);
export const TOOLS = [
  { id: 'power3', group: 'Power', title: 'Three-phase power', desc: "S = √3·V·I* from line-to-line voltage and line current. The current's angle is measured from the phase voltage.",
    fields: [F('V', 'V (line-to-line)', 'V'), F('I', 'I (line)', 'A')], fn: tPower3 },
  { id: 'current', group: 'Power', title: 'Line current from P and Q', desc: 'I = (S / √3·V)*, with S = P + jQ. Q > 0 for inductive loads.',
    fields: [F('P', 'P', 'W'), F('Q', 'Q', 'var', true), F('V', 'V (line-to-line)', 'V')], fn: tCurrent },
  { id: 'pfc', group: 'Power', title: 'Power-factor correction', desc: 'Capacitor bank that raises a lagging power factor from pf1 to pf2.',
    fields: [F('P', 'P', 'W'), F('pf1', 'pf present'), F('pf2', 'pf target'), F('V', 'V (line-to-line)', 'V'), F('f', 'f', 'Hz', false, '50')], fn: tPfc },
  { id: 'pu', group: 'Per unit', title: 'Per-unit bases', desc: 'Three-phase bases: Z = V²/S, I = S/(√3·V), Y = S/V². Optionally convert a value.',
    fields: [F('S', 'S base (three-phase)', 'VA'), F('V', 'V base (line-to-line)', 'V'), F('Z', 'Z to convert', 'Ω', true), F('I', 'I to convert', 'A', true)], fn: tPu },
  { id: 'chbase', group: 'Per unit', title: 'Change of base', desc: 'z_new = z_old · (V_old / V_new)² · (S_new / S_old)',
    fields: [F('z', 'z old', 'pu'), F('Vo', 'V old', 'V'), F('So', 'S old', 'VA'), F('Vn', 'V new', 'V'), F('Sn', 'S new', 'VA')], fn: tChbase },
  { id: 'vdrop', group: 'Circuits and lines', title: 'Voltage drop and losses', desc: 'Three-phase line or cable with series R + jX per phase, feeding P + jQ at voltage V.',
    fields: [F('R', 'R per phase', 'Ω'), F('X', 'X per phase', 'Ω'), F('P', 'P load', 'W'), F('Q', 'Q load', 'var', true), F('V', 'V at the load (line-to-line)', 'V')], fn: tVdrop },
  { id: 'line', group: 'Circuits and lines', title: 'Transmission line', desc: 'Long-line (distributed) model: ABCD parameters, and sending-end values for a given load.',
    fields: [F('z', 'z series', 'Ω/km'), F('y', 'y shunt', 'S/km'), F('l', 'length', 'km'), F('VR', 'V receiving (line-to-line)', 'V', true), F('SR', 'S receiving (three-phase)', 'VA', true)], fn: tLine },
  { id: 'y2d', group: 'Circuits and lines', title: 'Star to delta', desc: 'Zab = ΣZZ / Zc,  Zbc = ΣZZ / Za,  Zca = ΣZZ / Zb  (unbalanced allowed)',
    fields: [F('Za', 'Za', 'Ω'), F('Zb', 'Zb', 'Ω'), F('Zc', 'Zc', 'Ω')], fn: tY2d },
  { id: 'd2y', group: 'Circuits and lines', title: 'Delta to star', desc: 'Za = Zab·Zca / ΣZ,  Zb = Zab·Zbc / ΣZ,  Zc = Zbc·Zca / ΣZ  (unbalanced allowed)',
    fields: [F('Zab', 'Zab', 'Ω'), F('Zbc', 'Zbc', 'Ω'), F('Zca', 'Zca', 'Ω')], fn: tD2y },
  { id: 'seq', group: 'Circuits and lines', title: 'Symmetrical components', desc: 'Fortescue: zero, positive and negative sequence of three phasors.',
    fields: [F('Va', 'Va'), F('Vb', 'Vb'), F('Vc', 'Vc')], fn: tSeq },
  { id: 'trafo', group: 'Machines', title: 'Transformer from test data', desc: 'Series impedance from the short-circuit test; magnetising branch from the no-load test (optional). Ohmic values refer to the side of voltage Vn.',
    fields: [F('Sn', 'Sn', 'VA'), F('Vn', 'Vn (line-to-line)', 'V'), F('uk', 'uk', '%'), F('Pk', 'Pk (load losses)', 'W'), F('i0', 'i0', '%', true), F('P0', 'P0 (no-load losses)', 'W', true)], fn: tTrafo },
  { id: 'im', group: 'Machines', title: 'Induction machine speed', desc: 'Synchronous speed n_s = 120·f / poles, and slip for a given rotor speed.',
    fields: [F('f', 'f', 'Hz', false, '50'), F('poles', 'Number of poles (2p)'), F('n', 'Rotor speed', 'rpm', true)], fn: tIm },
  { id: 'imtest', group: 'Machines', title: 'Induction machine: parameters from tests',
    desc: 'Per-phase equivalent circuit from the DC (R₁), no-load and locked-rotor tests. Locked rotor: R₂′ = P/(3I²) − R₁, X₁ + X₂′ = √(Z² − R²)·f/f_lr, split by IEEE 112 design class. No load: P_Fe = P₀ − 3I₀²R₁ − P_fw, Q_m = Q₀ − 3I₀²X₁, R_Fe = 3E²/P_Fe, X_m = 3E²/Q_m with E = |V − Z₁I₀| (exact) or V (approximate). Line values in; per-phase values out.',
    fields: [new Choice('conn', 'Connection', IM_CONN), new Choice('model', 'Circuit', IM_MODEL), new Choice('cls', 'Design class', IM_CLASS),
      F('f', 'Rated f', 'Hz', false, '50'), F('R1', 'R₁ per phase (DC)', 'Ω'), F('kR', 'R₁ correction factor', '', true),
      F('V0', 'No load: V (line-to-line)', 'V'), F('I0', 'No load: I (line)', 'A'), F('P0', 'No load: P', 'W'), F('Pfw', 'Friction and windage P_fw', 'W', true),
      F('Vlr', 'Locked rotor: V (line-to-line)', 'V'), F('Ilr', 'Locked rotor: I (line)', 'A'), F('Plr', 'Locked rotor: P', 'W'), F('flr', 'Locked rotor: f', 'Hz', true)], load: machines, fnName: 'tImTest' },
  { id: 'imop', group: 'Machines', title: 'Induction machine: operating point',
    desc: 'Per-phase equivalent circuit (values per winding phase, referred to the stator) at a given slip, speed, shaft power or load torque. P_ag = 3I₂′²R₂′/s, T = P_ag/ω_s, P_out = (1 − s)P_ag − P_fw (P_fw constant). T_max, s_Tmax, T_start and the generator pull-out torque (at s = −s_Tmax) from the Thévenin equivalent. Leave R_Fe empty to neglect core losses. Table: slips separated by ;',
    fields: [new Choice('conn', 'Connection', IM_CONN), new Choice('model', 'Circuit', IM_MODEL),
      F('V', 'V (line-to-line)', 'V'), F('f', 'f', 'Hz', false, '50'), F('poles', 'Number of poles (2p)'),
      F('R1', 'R₁', 'Ω'), F('X1', 'X₁', 'Ω'), F('R2', 'R₂′', 'Ω'), F('X2', 'X₂′', 'Ω'), F('Xm', 'X_m', 'Ω'), F('Rfe', 'R_Fe', 'Ω', true),
      F('Pfw', 'Friction and windage P_fw', 'W', true),
      F('s', 'Slip s', '', true), F('n', 'or speed', 'rpm', true), F('Pout', 'or P out (shaft)', 'W', true), F('Tl', 'or T load (shaft)', 'N·m', true),
      new List('tbl', 'Table at slips', '')], load: machines, fnName: 'tImOp' },
  { id: 'sc', group: 'Faults', title: 'Three-phase short circuit', desc: 'Network feeder from its short-circuit power (IEC 60909): Z_Q = c·Un²/S_k″, I_k″ = c·Un / (√3·Z_Q), κ = 1,02 + 0,98·e^(−3R/X), i_p = κ·√2·I_k″.',
    fields: [F('Un', 'Un (line-to-line)', 'V'), F('Sk', 'S_k″ (three-phase)', 'VA'), F('c', 'Voltage factor c', '', false, '1,1'), F('RX', 'R/X of the network', '', false, '0,1')], fn: tSc },
];
export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));
export const GROUPS = [];
for (const t of TOOLS) {
  if (!GROUPS.length || GROUPS[GROUPS.length - 1][0] !== t.group) GROUPS.push([t.group, []]);
  GROUPS[GROUPS.length - 1][1].push(t);
}

/** Loads a lazily-defined tool's formula (no-op for built-in ones). Call before compute(). */
export async function ready(tool) { if (!tool.fn) tool.fn = (await tool.load())[tool.fnName]; return tool; }
export { Cell, pfOuts, diff, sq3, n };

/** Splits a list on top-level ';' only, so values may themselves contain function calls such as log(8;2). */
function splitTop(t) {
  const out = []; let depth = 0, cur = '';
  for (const ch of t) {
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
/** -> {outs, reliable, dps}. Throws Incomplete or CalcError. */
export function compute(engine, tool, texts) {
  const missing = tool.fields.filter(f => !f.optional && !(texts[f.key] || '').trim()).map(f => f.label);
  if (missing.length) throw new Incomplete(missing);
  const labels = Object.fromEntries(tool.fields.map(f => [f.key, f.label]));
  const once = () => {
    const vals = {};
    for (const f of tool.fields) {
      const t = (texts[f.key] || '').trim();
      if (f.choice) { vals[f.key] = f.options.some(o => o[0] === t) ? t : f.default; continue; }
      if (!t) { vals[f.key] = null; continue; }
      try {
        if (f.list) {
          const parts = splitTop(t).map(x => x.trim()).filter(Boolean);
          if (parts.length > f.max) throw new CalcError(`at most ${f.max} values`);
          vals[f.key] = parts.length ? parts.map(x => engine.evalValue(x)) : null;
        } else vals[f.key] = engine.evalValue(t);
      } catch (ex) {
        if (ex instanceof CalcError) throw new CalcError(`${f.label}: ${ex.msg}`, null, ex.numeric, ex.escalate);
        throw ex;
      }
    }
    let outs;
    try { outs = tool.fn(new Inputs(vals, labels)); }
    catch (ex) { if (ex instanceof CalcError) throw ex; throw new CalcError('These values can\'t be evaluated'); }
    for (const o of outs) {
      o.value = E.norm(o.value);
      if (!E.finite(o.value)) throw new CalcError(`${o.label} is infinite or undefined`, null, true);
      E.checkRange(o.value);
    }
    return outs;
  };
  const [outs, reliable, dps] = E.runVerified(once, r => r.map(o => o.value));
  for (const o of outs) o.value = E.cleanAt(o.value, dps);
  return { outs, reliable, dps };
}

export function withUnit(text, unit) {
  if (!unit) return text;
  const last = text.slice(-1), prev = text.slice(-2, -1);
  if ('TGMkmµnp'.includes(last) && /[0-9]/.test(prev)) return `${text.slice(0, -1)} ${last}${unit}`;
  return `${text} ${unit}`;
}
/** -> display lines of one result (rectangular, then polar for complex values). */
export function formatOut(o, unit = 'deg', sig = 10, notation = 'auto') {
  const v = o.value;
  if (isA(v)) return [E.fmtAngleHt(v.ht, unit, sig)];
  const nn = notation !== 'auto' ? notation : o.fmt === 'eng' ? 'eng' : 'auto';
  if (isC(v)) {
    const rect = E.fmtRect(v, sig, nn);
    const [mag, ang] = E.polarParts(v, sig, unit, x => withUnit(E.fmtReal(x, sig, nn), o.unit));
    return [o.unit ? `${rect} ${o.unit}` : rect, `${mag} ∠ ${ang}`];
  }
  return [withUnit(E.fmtReal(v, sig, nn), o.unit)];
}

export const REFERENCE = `Power
  s3(V;I)       √3·V·I*   three-phase complex power
  s1(V;I)       V·I*      single-phase complex power
  i3(S;V)       (S/(√3·V))*   line current
  pf(S)         cos(∠S)
  V is line-to-line; its angle is the phase-voltage angle.

Per unit
  zbase(V;S)  ybase(V;S)  ibase(V;S)  pu(x;base)
  chbase(z;Vo;So;Vn;Sn)

Circuits
  Z1 // Z2   par(Z1;Z2;…)   zl(f;L)   zc(f;C)
  omega(f)   db20(x)   db10(x)
  y2d(Za;Zb;Zc)   d2y(Zab;Zbc;Zca)

Symmetrical components
  seq(Va;Vb;Vc) → [V0; V1; V2]
  abc(V0;V1;V2) → [Va; Vb; Vc]
  a = 1∠120°`;
