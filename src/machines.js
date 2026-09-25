/*
 EE Calc — electrical machines (loaded on first use of a machine tool).
 Induction machine per-phase T-circuit on the winding phase: R1 + jX1, then the magnetising branch
 R_Fe ∥ jX_m, then R2'/s + jX2'. "Approximate" moves the magnetising branch to the terminals.
 Line ↔ winding: Y: V/√3, I; Δ: V, I/√3. Torque and its extremes come from the Thévenin equivalent seen
 by the rotor branch, which is exact for this linear circuit (the approximate model's is simply V, Z1).
 All arithmetic runs in the engine's current precision context, so runVerified checks every output.
*/
import * as E from './engine.js';
import { Out, Cell, pfOuts, diff, sq3, n } from './energy.js';

const I = E.internals;
const D = () => I.D;
const { CalcError, Cx, isR } = E;
const { add, mul, div, conj, cabs, PI, re, im } = I;

const IM_SPLIT = { AD: ['0.5', '0.5'], B: ['0.4', '0.6'], C: ['0.3', '0.7'] };   // IEEE 112 X1/X_lr, X2'/X_lr
const phV = (c, V) => (c.choice('conn') === 'Y' ? D().div(V, sq3()) : V);
const phI = (c, I) => (c.choice('conn') === 'Y' ? I : D().div(I, sq3()));
const abs2 = z => (isR(z) ? D().mul(z, z) : D().add(D().mul(z.re, z.re), D().mul(z.im, z.im)));
function evenPoles(c) {
  const p2 = E.toInt(c.x('poles', { positive: true }), null, 'number of poles');
  if (p2 < 2 || p2 % 2) throw new CalcError('Number of poles: must be an even number (2, 4, 6…)');
  return p2;
}

export function tImTest(c) {
  const d = D(), f = c.x('f', { positive: true }), exact = c.choice('model') === 'exact';
  const R1 = d.mul(c.has('kR') ? c.x('kR', { positive: true }) : n(1), c.x('R1', { lo: 0 }));
  const [k1, k2] = IM_SPLIT[c.choice('cls')].map(n);
  // locked-rotor test (magnetising branch neglected); reactance rescaled from f_lr to f
  const Vl = phV(c, c.x('Vlr', { positive: true })), Il = phI(c, c.x('Ilr', { positive: true })), Pl = c.x('Plr', { positive: true });
  const flr = c.has('flr') ? c.x('flr', { positive: true }) : f;
  const Zlr = d.div(Vl, Il), Rlr = d.div(Pl, d.mul(3, d.mul(Il, Il)));
  if (Rlr.gt(Zlr)) throw new CalcError('Locked-rotor P is larger than √3·V·I: check the locked-rotor test');
  const Xlr = d.div(d.mul(d.sqrt(diff(d.mul(Zlr, Zlr), d.mul(Rlr, Rlr))), f), flr);
  const R2 = diff(Rlr, R1);
  if (!R2.gt(0)) throw new CalcError('R₁ is not smaller than R_lr = P_lr / (3·I_lr²): check R₁ and the locked-rotor test');
  if (!Xlr.gt(0)) throw new CalcError('The locked-rotor test gives no reactance (P = √3·V·I): check the data');
  const X1 = d.mul(k1, Xlr), X2 = d.mul(k2, Xlr);
  // no-load test (rotor branch open): P_Fe = P0 − 3·I0²·R1 − P_fw; Q_m = Q0 − 3·I0²·X1 (exact) or Q0 (approximate:
  // the magnetising branch is at the terminals, so I0 does not flow through X1)
  const V0 = phV(c, c.x('V0', { positive: true })), I0 = phI(c, c.x('I0', { positive: true })), P0 = c.x('P0', { positive: true });
  const S0 = d.mul(3, d.mul(V0, I0));
  if (P0.gt(S0)) throw new CalcError('No-load P is larger than √3·V·I: check the no-load test');
  const Q0 = d.sqrt(diff(d.mul(S0, S0), d.mul(P0, P0))), I02 = d.mul(I0, I0);
  const Pcu0 = d.mul(3, d.mul(I02, R1)), Pfw = c.has('Pfw') ? c.x('Pfw', { lo: 0 }) : n(0);
  const Pfe = diff(P0, d.add(Pcu0, Pfw));
  if (Pfe.isNeg()) throw new CalcError('No-load P is smaller than 3·I₀²·R₁ + P_fw: check the no-load test and P_fw');
  const Qm = exact ? diff(Q0, d.mul(3, d.mul(I02, X1))) : Q0;
  if (!Qm.gt(0)) throw new CalcError(exact ? 'No-load Q is not larger than 3·I₀²·X₁: check the tests' : 'The no-load test gives no reactive power: check the data');
  // voltage across the magnetising branch: E1 = V0 − Z1·I0 (exact), V0 (approximate); I0 = (P0 − jQ0) / (3·V0)
  const E12 = exact ? abs2(I.sub(V0, mul(new Cx(R1, X1), new Cx(d.div(P0, d.mul(3, V0)), d.div(Q0, d.mul(3, V0)).neg()))))
                    : d.mul(V0, V0);
  const out = [new Out('R1', 'R₁', R1, 'Ω', 'eng', 'per phase'), new Out('X1', 'X₁', X1, 'Ω'),
    new Out('R2', 'R₂′', R2, 'Ω', 'eng', 'referred to the stator'), new Out('X2', 'X₂′', X2, 'Ω')];
  if (!Pfe.isZero()) out.push(new Out('Rfe', 'R_Fe', d.div(d.mul(3, E12), Pfe), 'Ω'));
  out.push(new Out('Xm', 'X_m', d.div(d.mul(3, E12), Qm), 'Ω'),
    new Out('Pfe', 'P_Fe', Pfe, 'W', 'eng', Pfe.isZero() ? 'R_Fe = ∞' : c.has('Pfw') ? '' : 'includes friction and windage'),
    new Out('Pcu0', 'P_Cu1 at no load', Pcu0, 'W'), new Out('Rlr', 'R_lr', Rlr, 'Ω', 'eng', 'R₁ + R₂′'),
    new Out('Xlr', 'X_lr', Xlr, 'Ω', 'eng', 'X₁ + X₂′ at rated f'));
  return out;
}

/** The machine as a circuit: everything the operating-point formulas need, at the current precision. */
function imModel(c) {
  const d = D(), exact = c.choice('model') === 'exact';
  const V = phV(c, c.x('V', { positive: true })), f = c.x('f', { positive: true }), p2 = evenPoles(c);
  const R1 = c.x('R1', { lo: 0 }), X1 = c.x('X1', { lo: 0 }), R2 = c.x('R2', { positive: true }), X2 = c.x('X2', { lo: 0 });
  const Xm = c.x('Xm', { positive: true }), Rfe = c.has('Rfe') ? c.x('Rfe', { positive: true }) : null;
  const Pfw = c.has('Pfw') ? c.x('Pfw', { lo: 0 }) : n(0);
  const Z1 = new Cx(R1, X1), Ym = new Cx(Rfe ? d.div(1, Rfe) : n(0), d.div(1, Xm).neg());   // Y_m = 1/R_Fe − j/X_m
  const den = exact ? add(n(1), mul(Z1, Ym)) : null;                                         // 1 + Z1·Y_m
  const Vth = exact ? div(V, den) : V, Zth = exact ? div(Z1, den) : Z1;
  const Rth = re(Zth), Xt = d.add(im(Zth), X2), A = d.add(d.mul(Rth, Rth), d.mul(Xt, Xt));
  if (A.isZero()) throw new CalcError('R₁, X₁ and X₂′ can\'t all be zero');
  const ns = d.div(d.mul(120, f), p2), ws = d.div(d.mul(d.mul(4, PI()), f), p2);
  return { d, exact, Y: c.choice('conn') === 'Y', V, R1, R2, X2, Rfe, Pfw, Z1, Ym, Vth, Zth, Rth, Xt, A, rA: d.sqrt(A), Vth2: abs2(Vth), ns, ws };
}
/** Circuit solution at slip s (s = 0: rotor branch open). */
function imAt(m, s, one_s = diff(n(1), s)) {
  const { d } = m, z = n(0);
  let I2 = new Cx(z, z), E1 = m.exact ? m.Vth : m.V;
  if (!s.isZero()) {
    const Z2 = new Cx(d.div(m.R2, s), m.X2);
    I2 = div(m.Vth, add(m.Zth, Z2));
    if (m.exact) E1 = mul(I2, Z2);
  }
  const I1 = add(I2, mul(E1, m.Ym)), I22 = abs2(I2);
  const Pcu2 = d.mul(3, d.mul(I22, m.R2)), Pag = s.isZero() ? z : d.div(Pcu2, s);
  const Pmec = d.mul(Pag, one_s), Pout = diff(Pmec, m.Pfw);
  return { s, I1, I2, E1, one_s, Sin: mul(d.mul(3, m.V), conj(I1)), Pcu1: d.mul(3, d.mul(abs2(m.exact ? I1 : I2), m.R1)),
    Pfe: m.Rfe ? d.div(d.mul(3, abs2(E1)), m.Rfe) : null, Pag, Pcu2, Pmec, Pout, Tem: d.div(Pag, m.ws),
    Iline: m.Y ? I1 : mul(sq3(), I1) };
}
const imEta = r => {
  const P = re(r.Sin);
  if (P.gt(0) && r.Pout.gt(0)) return D().div(r.Pout, P);
  if (P.lt(0) && r.Pout.lt(0)) return D().div(P, r.Pout);
  return null;
};
/** Motoring slip, on the stable branch (0 ≤ s < s_Tmax), for a given shaft power or load torque. */
function imSolve(m, mode, target) {
  const { d } = m, Kd = d.div(d.mul(d.mul(3, m.Vth2), m.R2), m.ws), B = d.mul(2, d.mul(m.Rth, m.R2)), C = d.mul(m.R2, m.R2);
  if (target.isZero() && m.Pfw.isZero()) return n(0);
  // g(s) = 0 with T(s) = K·s / (A·s² + B·s + C); friction and windage P_fw is constant
  const gD = s => {
    const Q = d.add(d.mul(d.add(d.mul(m.A, s), B), s), C), T = d.div(d.mul(Kd, s), Q);
    const Tp = d.div(d.mul(Kd, diff(C, d.mul(m.A, d.mul(s, s)))), d.mul(Q, Q)), u = diff(n(1), s);
    if (mode === 'T') {
      const fr = d.div(m.Pfw, d.mul(m.ws, u));
      return [diff(T, d.add(fr, target)), diff(Tp, d.div(fr, u))];
    }
    const P = d.mul(d.mul(m.ws, u), T);
    return [diff(P, d.add(m.Pfw, target)), d.mul(m.ws, diff(d.mul(u, Tp), T))];
  };
  const [k, a, b, cc, w, fw, tg] = [Kd, m.A, B, C, m.ws, m.Pfw, target].map(x => x.toNumber());
  const g = s => {
    const T = k * s / ((a * s + b) * s + cc);
    return mode === 'T' ? T - fw / (w * (1 - s)) - tg : w * (1 - s) * T - fw - tg;
  };
  const sT = d.div(m.R2, m.rA).toNumber(), hi = sT < 1 ? sT : 1 - 1e-12;
  let lo = 0, up = null;
  for (let i = 0; i <= 240; i++) {                     // first sign change on a log grid (0 < s ≤ hi)
    const s = hi * 10 ** (-12 + i / 20);
    if (g(s) >= 0) { up = s; break; }
    lo = s;
  }
  if (up === null || !isFinite(up)) {
    if (mode === 'P') {                                // the limit on shaft power is P_max, not T_max
      let Pmax = -Infinity;
      for (let i = 0; i <= 2000; i++) { const s = i / 2000, T = k * s / ((a * s + b) * s + cc); Pmax = Math.max(Pmax, w * (1 - s) * T - fw); }
      throw new CalcError(`No stable operating point: the shaft power is more than the machine can deliver (P_max ≈ ${E.fmtReal(n(Pmax), 4)} W)`);
    }
    const Tmax = d.div(d.mul(3, m.Vth2), d.mul(d.mul(2, m.ws), d.add(m.Rth, m.rA)));
    throw new CalcError(`No stable operating point: the load is more than the machine can drive (T_max = ${E.fmtReal(Tmax, 6)} N·m)`);
  }
  for (let i = 0; i < 200 && up - lo > 1e-17 * up; i++) { const mid = (lo + up) / 2; if (g(mid) >= 0) up = mid; else lo = mid; }
  let s = n((lo + up) / 2);
  const tol = n(`1e-${d.dps - 2}`);
  for (let i = 0; i < 40; i++) {                       // Newton at full precision from the double-precision root
    const [gv, gp] = gD(s);
    if (gp.isZero()) break;
    const step = d.div(gv, gp);
    s = d.sub(s, step);
    if (d.abs(step).lte(d.mul(tol, d.abs(s)))) return s;
  }
  throw new CalcError('The operating point could not be found', null, true);
}
const imRegion = s => (s.isZero() ? 'synchronous' : s.isNeg() ? 'generator' : s.lt(1) ? 'motor' : s.eq(1) ? 'standstill' : 'braking (plugging)');

export function tImOp(c) {
  const m = imModel(c), { d } = m;
  const given = ['s', 'n', 'Pout', 'Tl'].filter(k => c.has(k));
  if (given.length > 1) throw new CalcError('Enter only one of: slip, speed, P out, T load');
  const out = [];
  if (given.length) {
    const k = given[0];
    const nn = k === 'n' ? c.x('n') : null;             // given speed: 1 − s = n / n_s exactly (no cancellation)
    const s = k === 's' ? c.x('s') : nn ? d.div(diff(m.ns, nn), m.ns) : imSolve(m, k === 'Tl' ? 'T' : 'P', c.x(k, { lo: 0 }));
    const r = nn ? imAt(m, s, d.div(nn, m.ns)) : imAt(m, s), eta = imEta(r);
    out.push(Object.assign(new Out('s', 's', s, '', 'plain', imRegion(s)), { head: 'Operating point' }), new Out('n', 'n', d.mul(m.ns, r.one_s), 'rpm', 'plain'),
      new Out('I1', 'I₁', r.Iline, 'A', 'eng', 'line'), ...pfOuts(r.Sin),
      new Out('Pin', 'P_in', re(r.Sin), 'W'), new Out('Qin', 'Q_in', im(r.Sin), 'var'), new Out('Pcu1', 'P_Cu1', r.Pcu1, 'W'));
    if (r.Pfe) out.push(new Out('Pfe', 'P_Fe', r.Pfe, 'W'));
    out.push(new Out('Pag', 'P_ag', r.Pag, 'W', 'eng', 'air gap'), new Out('Pcu2', 'P_Cu2', r.Pcu2, 'W'),
      new Out('Pmec', 'P_mec', r.Pmec, 'W', 'eng', 'converted'), new Out('Pout', 'P_out', r.Pout, 'W', 'eng', 'shaft'),
      new Out('Tem', 'T_em', r.Tem, 'N·m', 'plain', 'electromagnetic'));
    if (!r.one_s.isZero()) out.push(new Out('Tsh', 'T_shaft', d.div(r.Pout, d.mul(m.ws, r.one_s)), 'N·m', 'plain'));
    if (eta) out.push(new Out('eta', 'η', d.mul(100, eta), '%', 'plain'));
    out.push(new Out('I2', 'I₂′', D().sqrt(abs2(r.I2)), 'A', 'eng', 'per phase'));
  }
  const st = imAt(m, n(1)), sT = d.div(m.R2, m.rA), gap = diff(m.rA, m.Rth);
  out.push(Object.assign(new Out('ns', 'n_s', m.ns, 'rpm', 'plain'), { head: 'Machine' }), new Out('Vth', 'V_th', d.sqrt(m.Vth2), 'V', 'eng', 'per phase'),
    new Out('Zth', 'Z_th', m.Zth, 'Ω'), new Out('sTmax', 's_Tmax', sT, '', 'plain'),
    new Out('Tmax', 'T_max', d.div(d.mul(3, m.Vth2), d.mul(d.mul(2, m.ws), d.add(m.Rth, m.rA))), 'N·m', 'plain', 'breakdown'),
    new Out('nTmax', 'n at T_max', d.mul(m.ns, diff(n(1), sT)), 'rpm', 'plain'),
    new Out('Tst', 'T_start', st.Tem, 'N·m', 'plain'), new Out('Ist', 'I_start', cabs(st.Iline), 'A', 'eng', 'line'));
  if (gap.gt(0)) out.push(new Out('Tgen', 'T_max generator', d.div(d.mul(3, m.Vth2), d.mul(d.mul(2, m.ws), gap)).neg(), 'N·m', 'plain'));
  if (c.has('tbl')) c.list('tbl').forEach((s, i) => {
    const r = imAt(m, s), eta = imEta(r), j = i + 1;
    out.push(Cell(`s_t${j}`, 's', s, '', j), Cell(`n_t${j}`, 'n', d.mul(m.ns, r.one_s), 'rpm', j),
      Cell(`T_t${j}`, 'T_em', r.Tem, 'N·m', j), Cell(`I_t${j}`, 'I₁', cabs(r.Iline), 'A', j));
    if (eta) out.push(Cell(`eta_t${j}`, 'η', d.mul(100, eta), '%', j));
  });
  return out;
}
