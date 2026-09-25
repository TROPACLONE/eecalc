/*
 EE Calc — calculation engine (JavaScript port of engine.py, on decimal.js).

 Tokenizer -> recursive-descent parser (AST, built once) -> evaluator run at rising precision.
 Every result is computed at LEVELS[0] and LEVELS[1] significant digits and accepted only when
 both agree to VERIFY_DIGITS digits; otherwise precision rises through the remaining levels.

 Values:  Decimal (real) · Cx (complex) · Angle (real angle with explicit unit, in half-turns) · Mat
*/
import Decimal from './decimal.js';

// The second level must be far above the first: a difference lost below 50 digits (e.g. (1+1e-60)-1)
// is only exposed if the second evaluation keeps it. 80 digits does; 60 would not.
export const LEVELS = [50, 80, 140, 260, 500];
export const WORK_DPS = LEVELS[0];
const VERIFY_DIGITS = 42;
const MIN_RELIABLE = 3;
const DEC_GUARD = WORK_DPS - 5;          // digits kept before display rounding (removes computational residue)
export const FULL_SIG = WORK_DPS - 10;
const MAX_EXP10 = 1e15;                   // largest decimal exponent accepted in input
const MAX_RESULT_EXP10 = 9e14;            // largest decimal exponent accepted in results
const MAX_DIM = 30;
const MAX_MAG_BITS = 49;
const LOG2_10 = 3.321928094887362;

// ─── precision contexts ────────────────────────────────────────────────────────
const CTX = new Map();
function ctx(dps) {
  let c = CTX.get(dps);
  if (!c) {
    c = Decimal.clone({ precision: dps, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.EUCLID,
                        toExpNeg: -7, toExpPos: 21, minE: -9e15, maxE: 9e15 });
    c.dps = dps;
    c.CHOP = new c(`1e-${dps - 6}`);            // residue below this fraction of the scale is noise
    c.MAX_HT = new c(`1e${dps - 8}`);           // an angle beyond this has no significant fraction left
    c._pi = null;
    c._hpi = null;
    CTX.set(dps, c);
  }
  return c;
}
let D = ctx(WORK_DPS);
function withDps(dps, fn) {
  const prev = D;
  D = ctx(dps);
  try { return fn(); } finally { D = prev; }
}
function PI() { return D._pi || (D._pi = D.acos(-1)); }
function HALF_PI() { return D._hpi || (D._hpi = D.div(PI(), 2)); }

const Z0 = new Decimal(0), ONE = new Decimal(1);
const BASE_CHOP = new Decimal(`1e-${WORK_DPS - 6}`);
const DISPLAY = Decimal.clone({ precision: DEC_GUARD + 10, rounding: Decimal.ROUND_HALF_UP,
                                toExpNeg: -7, toExpPos: 21, minE: -9e15, maxE: 9e15 });

// ─── types ─────────────────────────────────────────────────────────────────────
export class CalcError extends Error {
  constructor(msg, pos = null, numeric = false, escalate = false) {
    super(msg);
    this.msg = msg;
    this.pos = pos;
    this.numeric = numeric || escalate;   // may be an artefact of finite precision → retried higher
    this.escalate = escalate;             // certainly solvable with more digits → always go higher
  }
}
export class Cx { constructor(re, im) { this.re = re; this.im = im; } }
export class Angle { constructor(ht) { this.ht = ht; } radians() { return D.mul(this.ht, PI()); } }
export class Mat {
  constructor(rows, cols, a) { this.rows = rows; this.cols = cols; this.a = a || new Array(rows * cols).fill(Z0); }
  get(r, c) { return this.a[r * this.cols + c]; }
  set(r, c, v) { this.a[r * this.cols + c] = v; }
}
export const isR = v => v instanceof Decimal;
export const isC = v => v instanceof Cx;
export const isA = v => v instanceof Angle;
export const isM = v => v instanceof Mat;
const re = v => (isC(v) ? v.re : v);
const im = v => (isC(v) ? v.im : Z0);
const isZero = v => (isC(v) ? v.re.isZero() && v.im.isZero() : v.isZero());

// ─── scalar arithmetic at the current precision ────────────────────────────────
function add(a, b) { return isR(a) && isR(b) ? D.add(a, b) : new Cx(D.add(re(a), re(b)), D.add(im(a), im(b))); }
function sub(a, b) { return isR(a) && isR(b) ? D.sub(a, b) : new Cx(D.sub(re(a), re(b)), D.sub(im(a), im(b))); }
function neg(a) { return isC(a) ? new Cx(a.re.neg(), a.im.neg()) : a.neg(); }
// Wide context (2·dps + 4 digits): products of dps-digit numbers are exact in it, so sums of products
// are rounded once instead of term by term (as mpmath does). Costs almost nothing: the product digits
// are computed either way; only the rounding differs.
function W() { return D._w || (D._w = ctx(2 * D.dps + 4)); }
const rnd = x => x.toSD(D.dps);
function mul(a, b) {
  if (isR(a) && isR(b)) return D.mul(a, b);
  if (isR(a)) return new Cx(D.mul(a, b.re), D.mul(a, b.im));
  if (isR(b)) return new Cx(D.mul(a.re, b), D.mul(a.im, b));
  const w = W();
  return new Cx(rnd(w.sub(w.mul(a.re, b.re), w.mul(a.im, b.im))), rnd(w.add(w.mul(a.re, b.im), w.mul(a.im, b.re))));
}
/** a − f·x, rounded once (exact product) — used in elimination and back-substitution. */
function fms(a, f, x) {
  const w = W();
  if (isR(a) && isR(f) && isR(x)) return rnd(w.sub(a, w.mul(f, x)));
  const fr = re(f), fi = im(f), xr = re(x), xi = im(x);
  const pr = w.sub(w.mul(fr, xr), w.mul(fi, xi)), pi = w.add(w.mul(fr, xi), w.mul(fi, xr));
  return new Cx(rnd(w.sub(re(a), pr)), rnd(w.sub(im(a), pi)));
}
function div(a, b) {
  if (isZero(b)) throw new CalcError('Division by zero', null, true);
  if (isR(b)) return isR(a) ? D.div(a, b) : new Cx(D.div(a.re, b), D.div(a.im, b));
  const w = W(), g = x => x.toSD(D.dps + 5);           // numerator and denominator rounded once
  const den = g(w.add(w.mul(b.re, b.re), w.mul(b.im, b.im)));
  const ar = re(a), ai = im(a);
  return new Cx(D.div(g(w.add(w.mul(ar, b.re), w.mul(ai, b.im))), den),
                D.div(g(w.sub(w.mul(ai, b.re), w.mul(ar, b.im))), den));
}
function conj(a) { return isC(a) ? new Cx(a.re, a.im.neg()) : a; }
export function cabs(a) { return isC(a) ? D.hypot(a.re, a.im) : D.abs(a); }
function carg(a) {
  if (!isC(a)) return a.isNeg() ? PI() : new D(0);
  return memoized('arg' + (a.im.d ? a.im.d.join(',') + a.im.e + a.im.s : a.im.toString()) + ':', a.re, () => D.atan2(a.im, a.re));
}
function finiteD(x) { return x.isFinite(); }
/** |re| + |im|: within √2 of |z|, no square root — for pivoting and noise-scale estimates. */
function l1(a) { return isC(a) ? D.add(D.abs(a.re), D.abs(a.im)) : D.abs(a); }
/** |z|² — same ordering as |z|, no square root. */
function abs2(a) { return isC(a) ? D.add(D.mul(a.re, a.re), D.mul(a.im, a.im)) : D.mul(a, a); }

function csqrt(z) {
  if (isR(z)) return z.isNeg() ? new Cx(Z0, D.sqrt(z.neg())) : D.sqrt(z);
  const m = cabs(z);
  if (!z.re.isNeg()) {
    const r = D.sqrt(D.div(D.add(m, z.re), 2));
    return r.isZero() ? new Cx(Z0, Z0) : new Cx(r, D.div(z.im, D.mul(r, 2)));
  }
  let t = D.sqrt(D.div(D.sub(m, z.re), 2));
  const r = D.div(D.abs(z.im), D.mul(t, 2));
  if (z.im.isNeg()) t = t.neg();
  return new Cx(r, t);
}
function cexp(z) {
  if (isR(z)) return D.exp(z);
  const er = D.exp(z.re);
  return new Cx(D.mul(er, D.cos(z.im)), D.mul(er, D.sin(z.im)));
}
function clog(z) {
  if (isR(z)) return z.isNeg() ? new Cx(D.ln(z.neg()), PI()) : D.ln(z);
  return new Cx(D.ln(cabs(z)), carg(z));
}
const I = new Cx(Z0, ONE);
function powInt(a, n) {                     // exact binary powering for integer exponents
  let neg_ = n < 0n; if (neg_) n = -n;
  let res = ONE, base = a;
  while (n > 0n) {
    if (n & 1n) res = mul(res, base);
    n >>= 1n;
    if (n > 0n) base = mul(base, base);
  }
  return neg_ ? div(ONE, res) : res;
}
function cpow(a, b) {
  if (isR(b) && b.isInteger() && D.abs(b).lte(1e9)) {
    if (isR(a)) return D.pow(a, b);
    return powInt(a, BigInt(b.toFixed(0)));
  }
  if (isR(a) && !a.isNeg() && isR(b)) return D.pow(a, b);
  return cexp(mul(b, clog(a)));
}
// Real hyperbolic functions. decimal.js's own series slow down enormously for large arguments
// (cosh(1e5) takes 150 ms), so for |x| > 1 they are built from exp, which stays fast; there is no
// cancellation there (e^x − e^−x ≥ 2.35 for x ≥ 1).
function rsinh(x) {
  if (D.abs(x).lte(1)) return D.sinh(x);
  const e = D.exp(D.abs(x)), v = D.div(D.sub(e, D.div(1, e)), 2);
  return x.isNeg() ? v.neg() : v;
}
function rcosh(x) {
  if (D.abs(x).lte(1)) return D.cosh(x);
  const e = D.exp(D.abs(x));
  return D.div(D.add(e, D.div(1, e)), 2);
}
function rtanh(x) {
  if (D.abs(x).lte(1)) return D.tanh(x);
  const e2 = D.exp(D.mul(2, D.abs(x))), v = D.sub(1, D.div(2, D.add(e2, 1)));
  return x.isNeg() ? v.neg() : v;
}
function csin(z) { return new Cx(D.mul(D.sin(z.re), rcosh(z.im)), D.mul(D.cos(z.re), rsinh(z.im))); }
function ccos(z) { return new Cx(D.mul(D.cos(z.re), rcosh(z.im)), D.mul(D.sin(z.re), rsinh(z.im)).neg()); }
function csinh(z) { return new Cx(D.mul(rsinh(z.re), D.cos(z.im)), D.mul(rcosh(z.re), D.sin(z.im))); }
function ccosh(z) { return new Cx(D.mul(rcosh(z.re), D.cos(z.im)), D.mul(rsinh(z.re), D.sin(z.im))); }

// inverse functions: principal branches, real inputs outside the real domain follow mpmath
function casin(z) {
  if (isR(z)) {
    if (D.abs(z).lte(1)) return D.asin(z);
    const h = D.acosh(D.abs(z)), hp = D.div(PI(), 2);
    return z.isNeg() ? new Cx(hp.neg(), h) : new Cx(hp, h.neg());
  }
  const iz = mul(I, z);
  return mul(new Cx(Z0, ONE.neg()), clog(add(iz, csqrt(sub(ONE, mul(z, z))))));
}
function cacos(z) {
  if (isR(z)) {
    if (D.abs(z).lte(1)) return D.acos(z);
    const h = D.acosh(D.abs(z));
    return z.isNeg() ? new Cx(PI(), h.neg()) : new Cx(Z0, h);
  }
  return sub(D.div(PI(), 2), casin(z));
}
function catan(z) {
  if (isR(z)) return D.atan(z);
  const iz = mul(I, z);
  return mul(new Cx(Z0, new D(0.5)), sub(clog(sub(ONE, iz)), clog(add(ONE, iz))));
}
function casinh(z) { return isR(z) ? D.asinh(z) : clog(add(z, csqrt(add(mul(z, z), ONE)))); }
function cacosh(z) {
  if (isR(z)) {
    if (z.gte(1)) return D.acosh(z);
    if (z.lte(-1)) return new Cx(D.acosh(z.neg()), PI());
    return new Cx(Z0, D.acos(z));
  }
  return clog(add(z, mul(csqrt(add(z, ONE)), csqrt(sub(z, ONE)))));
}
function catanh(z) {
  if (isR(z)) {
    if (D.abs(z).lt(1)) return D.atanh(z);
    if (D.abs(z).eq(1)) return z.isNeg() ? new D(-Infinity) : new D(Infinity);
    const r = D.mul(D.ln(D.div(D.add(z, 1), D.sub(z, 1))), 0.5), hp = D.div(PI(), 2);
    return z.isNeg() ? new Cx(r, hp) : new Cx(r, hp.neg());
  }
  return mul(new D(0.5), sub(clog(add(ONE, z)), clog(sub(ONE, z))));
}

// Exact memo for the costly transcendental results: keyed by the exact input and the precision.
// During live preview the same angles are re-evaluated at every keystroke.
const MEMO_MAX = 512;
const memo = new Map();
function memoized(tag, x, compute) {
  const key = `${tag}${D.dps}|${x.s}|${x.e}|${x.d ? x.d.join(',') : x.toString()}`;
  let v = memo.get(key);
  if (v === undefined) {
    v = compute();
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);   // drop the oldest entry
    memo.set(key, v);
  }
  return v;
}
/** sin(π·ht), cos(π·ht) with exact argument reduction (exact zeros at multiples of 90°). */
function sincospi(ht) { return memoized('scp', ht, () => sincospiRaw(ht)); }
function sincospiRaw(ht) {
  const s2 = D.mul(D.mod(ht, 2), 2);                     // in [0, 4)
  const q = s2.floor().toNumber();                        // quadrant 0..3
  const f = D.sub(s2, q);                                 // position in the quadrant, [0, 1)
  let sb, cb;
  if (f.isZero()) { sb = new D(0); cb = new D(1); }
  else {
    // one Taylor series only: x ≤ π/4, so cos x = √(1 − sin²x) ≥ 0.707 has no cancellation
    const small = f.lte(0.5);
    const x = D.mul(small ? f : D.sub(1, f), HALF_PI());
    const sx = D.sin(x), cx = D.sqrt(D.sub(1, D.mul(sx, sx)));
    if (small) { sb = sx; cb = cx; } else { sb = cx; cb = sx; }
  }
  switch (q) {
    case 0: return [sb, cb];
    case 1: return [cb, sb.neg()];
    case 2: return [sb.neg(), cb.neg()];
    default: return [cb.neg(), sb];
  }
}

// ─── cleaning (rounding residue) ───────────────────────────────────────────────
function chop(v, rel) {
  if (!isC(v)) return v;
  rel = rel || D.CHOP;
  const mag = D.max(D.abs(v.re), D.abs(v.im));
  const tol = D.mul(mag, rel);
  if (D.abs(v.im).lte(tol)) return v.re;
  if (D.abs(v.re).lte(tol)) return new Cx(Z0, v.im);
  return v;
}
function chopRef(v, ref) {
  const tol = D.mul(ref, D.CHOP);
  if (isC(v)) {
    const r = D.abs(v.re).lte(tol) ? Z0 : v.re;
    const i = D.abs(v.im).lte(tol) ? Z0 : v.im;
    return i.isZero() ? r : new Cx(r, i);
  }
  if (isR(v) && D.abs(v).lte(tol)) return Z0;
  return v;
}
export function norm(v) {
  if (isC(v)) {
    v = chop(v);
    return isC(v) && v.im.isZero() ? v.re : v;
  }
  if (typeof v === 'number') return new D(v);
  if (isM(v)) return matMap(v, z => norm(z));
  return v;
}
function matMap(m, f) {
  const out = new Mat(m.rows, m.cols);
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) out.set(r, c, f(m.get(r, c), r, c));
  return out;
}
function denoiseRelMax(m) {
  let ref = new D(0);
  for (const z of m.a) ref = D.max(ref, l1(z));
  return matMap(m, z => chopRef(z, ref));
}
function finalClean(v) {
  if (isC(v)) {
    v = chop(v, BASE_CHOP);
    return isC(v) && v.im.isZero() ? v.re : v;
  }
  if (isM(v)) return matMap(v, z => finalClean(z));
  return v;
}
export function cleanAt(v, dps) { return withDps(dps, () => finalClean(v)); }

function components(v) {
  if (isA(v)) return [v.ht];
  if (isM(v)) return v.a.flatMap(components);
  return isC(v) ? [v.re, v.im] : [v];
}
export function finite(v) { return components(v).every(finiteD); }
export function checkRange(v) {
  for (const x of components(v)) {
    if (!x.isZero() && Math.abs(x.e) > MAX_RESULT_EXP10)
      throw new CalcError('Result is too large (or too small) to represent');
  }
}
function mag2(x) { return x.isZero() ? -Infinity : (x.e + 1) * LOG2_10; }   // ≈ log2|x|

// ─── limits ────────────────────────────────────────────────────────────────────
function checkAngle(ht, pos) {
  if (D.abs(ht).gt(D.MAX_HT)) throw new CalcError('Angle is too large to resolve, even at 500 digits', pos, false, true);
  return ht;
}
export function checkGrowth(x, pos) {
  const m = isC(x) ? D.max(D.abs(x.re), D.abs(x.im)) : D.abs(x);
  if (!m.isZero() && mag2(m) > MAX_MAG_BITS + 1) throw new CalcError('Result is too large to represent', pos);
  return x;
}
export function toInt(x, pos, what = 'value') {
  const r = x.round();
  if (D.abs(D.sub(x, r)).gt(D.mul(D.CHOP, D.max(1, D.abs(x))))) throw new CalcError(`The ${what} must be an integer`, pos, true);
  return r.toNumber();
}
function dim(v, pos) {
  const k = toInt(v, pos, 'matrix size');
  if (!(k >= 1 && k <= MAX_DIM)) throw new CalcError(`Matrix size must be between 1 and ${MAX_DIM}`, pos);
  return k;
}
function cisHt(ht, pos) {
  checkAngle(ht, pos);
  const [s, c] = sincospi(ht);
  return norm(new Cx(c, s));
}
function aOp() { return D._a || (D._a = cisHt(D.div(2, 3))); }      // Fortescue a = 1∠120°
function a2Op() { return D._a2 || (D._a2 = cisHt(D.div(4, 3))); }  // a² = 1∠240°

// ─── tokenizer ─────────────────────────────────────────────────────────────────
const SI_PREFIX = { T: 12, G: 9, M: 6, k: 3, m: -3, u: -6, 'µ': -6, 'μ': -6, n: -9, p: -12 };
const NOT_IDENT = new Set(['º', 'ª', '²', '³', '¹']);
const LETTER = /\p{L}/u;
const isDigit = c => c >= '0' && c <= '9';
const identStart = c => (c === '_' || LETTER.test(c)) && !NOT_IDENT.has(c);
const identChar = c => (c === '_' || isDigit(c) || LETTER.test(c)) && !NOT_IDENT.has(c);
const OPS = [['//', '//'], ['**', '^'], ['∥', '//'], ['+', '+'], ['-', '-'], ['−', '-'], ['*', '*'], ['·', '*'],
  ['×', '*'], ['/', '/'], ['÷', '/'], ['\\', '\\'], ['^', '^'], ['(', '('], [')', ')'], ['[', '['], [']', ']'],
  [';', ';'], ['|', '|'], ['=', '='], ['∠', '∠'], ['<', '∠'], ['@', '∠'], ['°', '°'], ['º', '°'], ['²', '²'],
  ['³', '³'], ['√', '√']];

export function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (isDigit(c) || ((c === '.' || c === ',') && i + 1 < n && isDigit(s[i + 1]))) {
      const start = i;
      while (i < n && isDigit(s[i])) i++;
      const ip = s.slice(start, i) || '0';
      let fp = '', hasPoint = false, exp = 0, hasExp = false;
      if (i < n && (s[i] === '.' || s[i] === ',')) {
        hasPoint = true; i++;
        const f0 = i;
        while (i < n && isDigit(s[i])) i++;
        fp = s.slice(f0, i);
      }
      if (i < n && (s[i] === 'e' || s[i] === 'E')) {
        let j = i + 1;
        if (j < n && (s[j] === '+' || s[j] === '-')) j++;
        if (j < n && isDigit(s[j])) {
          while (j < n && isDigit(s[j])) j++;
          exp = Number(s.slice(i + 1, j));
          hasExp = true; i = j;
        }
      }
      if (i < n && SI_PREFIX[s[i]] !== undefined) {
        let j = i + 1;
        while (j < n && isDigit(s[j])) j++;
        if (j > i + 1 && !hasPoint && !hasExp && (j >= n || !identChar(s[j]))) {
          fp = s.slice(i + 1, j); exp += SI_PREFIX[s[i]]; i = j;            // RKM code: 4k7 = 4,7k
        } else if (i + 1 >= n || !identChar(s[i + 1])) {
          exp += SI_PREFIX[s[i]]; i++;                                        // SI suffix: 4,7k
        }
      }
      let imag = false;
      if (i < n && s[i] === 'j' && (i + 1 >= n || !identChar(s[i + 1]))) { imag = true; i++; }
      if (!Number.isFinite(exp) || Math.abs(exp) > MAX_EXP10) throw new CalcError('Exponent is out of range', start);
      const val = new Decimal(`${ip}.${fp || '0'}e${exp}`);                 // exact: literals are not rounded
      toks.push({ kind: 'num', val: imag ? new Cx(Z0, val) : val, pos: start });
      continue;
    }
    if (identStart(c)) {
      const start = i;
      while (i < n && identChar(s[i])) i++;
      const name = s.slice(start, i);
      if (name[0] === 'j' && name.length > 1 && isDigit(name[1])) {           // j4 -> j · 4
        toks.push({ kind: 'id', val: 'j', pos: start });
        i = start + 1;
        continue;
      }
      toks.push({ kind: 'id', val: name, pos: start });
      continue;
    }
    let matched = false;
    for (const [src, nv] of OPS) {
      if (s.startsWith(src, i)) { toks.push({ kind: 'op', val: nv, pos: i }); i += src.length; matched = true; break; }
    }
    if (!matched) {
      if (c === ',') throw new CalcError("Stray ',' — the comma is the decimal separator; separate arguments with ';'", i);
      throw new CalcError(`Unexpected character '${c}'`, i);
    }
  }
  toks.push({ kind: 'end', val: null, pos: n });
  if (toks[0].kind === 'op' && ['*', '/', '^', '//', '\\', '²', '³'].includes(toks[0].val))
    toks.unshift({ kind: 'id', val: 'ans', pos: 0 });
  return toks;
}

// ─── parser ────────────────────────────────────────────────────────────────────
class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek(k = 0) { return this.t[Math.min(this.i + k, this.t.length - 1)]; }
  next() { return this.t[this.i++]; }
  isOp(...vals) { const t = this.peek(); return t.kind === 'op' && vals.includes(t.val); }
  expect(val) {
    const t = this.peek();
    if (t.kind === 'op' && t.val === val) return this.next();
    if (t.kind === 'end') throw new CalcError(`Missing '${val}'`, t.pos);
    throw new CalcError(`Expected '${val}' here`, t.pos);
  }
  statement() {
    const t0 = this.peek(), t1 = this.peek(1);
    if (t0.kind === 'id' && t1.kind === 'op' && t1.val === '=') {
      this.i += 2;
      const e = this.expr();
      this.end();
      return { k: 'assign', name: t0.val, e, pos: t0.pos };
    }
    const e = this.expr();
    this.end();
    return e;
  }
  end() {
    const t = this.peek();
    if (t.kind !== 'end') {
      if (t.kind === 'op' && t.val === ')') throw new CalcError("Unmatched ')'", t.pos);
      if (t.kind === 'op' && t.val === '=') throw new CalcError("'=' only assigns a name, e.g.  Z1 = 3 + j4", t.pos);
      throw new CalcError('Unexpected input here', t.pos);
    }
  }
  expr() {
    let node = this.par();
    while (this.isOp('+', '-')) { const op = this.next(); node = { k: 'bin', op: op.val, a: node, b: this.par(), pos: op.pos }; }
    return node;
  }
  par() {
    let node = this.mul();
    while (this.isOp('//')) { const op = this.next(); node = { k: 'bin', op: '//', a: node, b: this.mul(), pos: op.pos }; }
    return node;
  }
  mul() {
    let node = this.unary();
    while (this.isOp('*', '/', '\\')) { const op = this.next(); node = { k: 'bin', op: op.val, a: node, b: this.unary(), pos: op.pos }; }
    return node;
  }
  unary() {
    if (this.isOp('-')) { const p = this.next().pos; return { k: 'neg', a: this.unary(), pos: p }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.implicit();
  }
  startsPrimary() {
    const t = this.peek();
    if (t.kind === 'num') return true;
    if (t.kind === 'id') return t.val !== 'rad' && t.val !== 'deg';
    return t.kind === 'op' && (t.val === '(' || t.val === '[' || t.val === '√');
  }
  implicit() {
    let node = this.polar();
    while (this.startsPrimary()) {
      if (this.peek().kind === 'num' && this.t[this.i - 1].kind === 'num')
        throw new CalcError("Two numbers side by side — add an operator (spaces can't group digits)", this.peek().pos);
      const p = this.peek().pos;
      node = { k: 'bin', op: '*', a: node, b: this.polar(), pos: p };
    }
    return node;
  }
  polar() {
    let node = this.power();
    if (this.isOp('∠')) {
      const p = this.next().pos;
      let ang = this.signed(() => this.power());
      while (this.peek().kind === 'id' && (this.peek().val === 'pi' || this.peek().val === 'π')) {
        const q = this.peek().pos;
        ang = { k: 'bin', op: '*', a: ang, b: this.power(), pos: q };
      }
      node = { k: 'polar', r: node, ang, pos: p };
      if (this.isOp('∠')) throw new CalcError("Only one '∠' per term — use parentheses", this.peek().pos);
    }
    return node;
  }
  signed(inner) {
    if (this.isOp('-')) { const p = this.next().pos; return { k: 'neg', a: this.signed(inner), pos: p }; }
    if (this.isOp('+')) { this.next(); return this.signed(inner); }
    return inner();
  }
  power() {
    const base = this.postfix();
    if (this.isOp('^')) { const p = this.next().pos; return { k: 'bin', op: '^', a: base, b: this.signed(() => this.power()), pos: p }; }
    return base;
  }
  postfix() {
    let node = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && t.val === '°') { this.next(); node = { k: 'deg', a: node, pos: t.pos }; }
      else if (t.kind === 'id' && (t.val === 'rad' || t.val === 'deg')) { this.next(); node = { k: t.val, a: node, pos: t.pos }; }
      else if (t.kind === 'op' && (t.val === '²' || t.val === '³')) {
        this.next();
        node = { k: 'bin', op: '^', a: node, b: { k: 'num', v: new Decimal(t.val === '²' ? 2 : 3) }, pos: t.pos };
      } else return node;
    }
  }
  args() {
    const out = [];
    if (!this.isOp(')')) {
      out.push(this.expr());
      while (this.isOp(';')) { this.next(); out.push(this.expr()); }
    }
    this.expect(')');
    return out;
  }
  primary() {
    const t = this.next();
    if (t.kind === 'num') return { k: 'num', v: t.val };
    if (t.kind === 'id') {
      if (t.val === 'rad' || t.val === 'deg') throw new CalcError(`'${t.val}' must follow a number, e.g. 3 ${t.val}`, t.pos);
      if (this.isOp('(')) {
        this.next();
        if (FUNCS.has(t.val)) return { k: 'call', name: t.val, args: this.args(), pos: t.pos };
        return { k: 'callvar', name: t.val, args: this.args(), pos: t.pos };
      }
      return { k: 'var', name: t.val, pos: t.pos };
    }
    if (t.kind === 'op') {
      if (t.val === '(') {
        if (this.isOp(')')) throw new CalcError('Empty parentheses', t.pos);
        const e = this.expr();
        this.expect(')');
        return e;
      }
      if (t.val === '[') return this.matrix(t.pos);
      if (t.val === '√') return { k: 'call', name: 'sqrt', args: [this.signed(() => this.postfix())], pos: t.pos };
      if (t.val === '∠') return { k: 'polar', r: { k: 'num', v: ONE }, ang: this.signed(() => this.power()), pos: t.pos };
    }
    if (t.kind === 'end') throw new CalcError('Incomplete expression', t.pos);
    throw new CalcError(`Unexpected '${t.val}'`, t.pos);
  }
  matrix(pos) {
    if (this.isOp(']')) throw new CalcError('Empty matrix', pos);
    const rows = [[this.expr()]];
    for (;;) {
      if (this.isOp('|')) { this.next(); rows[rows.length - 1].push(this.expr()); }
      else if (this.isOp(';')) { this.next(); rows.push([this.expr()]); }
      else break;
    }
    this.expect(']');
    if (new Set(rows.map(r => r.length)).size !== 1) throw new CalcError('All matrix rows need the same number of columns', pos);
    return { k: 'mat', rows, pos };
  }
}
export function parse(text) { return new Parser(tokenize(text)).statement(); }

// ─── helpers used by functions ─────────────────────────────────────────────────
function num(v) { return isA(v) ? v.radians() : v; }
function scalar(v, pos, what = 'argument') {
  if (isM(v)) throw new CalcError(`This ${what} must be a scalar, not a matrix`, pos);
  return num(v);
}
function real(v, pos, what = 'argument') {
  v = norm(scalar(v, pos, what));
  if (!isR(v)) throw new CalcError(`This ${what} must be real`, pos);
  return v;
}
function needMat(v, pos) { if (!isM(v)) throw new CalcError('This argument must be a matrix', pos); return v; }
function square(v, pos) {
  needMat(v, pos);
  if (v.rows !== v.cols) throw new CalcError(`Matrix must be square (this one is ${v.rows}×${v.cols})`, pos);
  return v;
}
function col(vals) { return new Mat(vals.length, 1, vals.slice()); }
function three(a, pos, name) {
  if (a.length === 1 && isM(a[0]) && a[0].rows * a[0].cols === 3) return a[0].a.slice(0, 3);
  if (a.length === 3) return a.map(x => scalar(x, pos));
  throw new CalcError(`${name} takes three phasors or one 3-element vector`, pos);
}
export function diff(a, b) { return chopRef(sub(a, b), D.max(cabs(a), cabs(b))); }

// ─── matrices ──────────────────────────────────────────────────────────────────
function matAddSub(a, b, op) {
  return matMap(a, (z, r, c) => {
    const w = b.get(r, c);
    return chopRef(op === '+' ? add(z, w) : sub(z, w), D.max(cabs(z), cabs(w)));
  });
}
function matMul(a, b) {                         // each entry cleaned against Σ|a_ik||b_kj|
  const out = new Mat(a.rows, b.cols);
  for (let r = 0; r < a.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const w = W();                                        // exact dot product, rounded once
      let sr = new w(0), si = new w(0), ref = new D(0);
      for (let k = 0; k < a.cols; k++) {
        const x = a.get(r, k), y = b.get(k, c), xr = re(x), xi = im(x), yr = re(y), yi = im(y);
        sr = w.add(sr, w.sub(w.mul(xr, yr), w.mul(xi, yi)));
        si = w.add(si, w.add(w.mul(xr, yi), w.mul(xi, yr)));
        ref = D.add(ref, D.mul(l1(x), l1(y)));
      }
      const s = si.isZero() ? rnd(sr) : new Cx(rnd(sr), rnd(si));
      out.set(r, c, chopRef(s, ref));
    }
  }
  return out;
}
function matScale(m, s, divide = false) { return matMap(m, z => (divide ? div(z, s) : mul(z, s))); }
function lu(A, pos) {
  const n = A.rows, a = A.a.slice(), perm = [...Array(n).keys()];
  let sign = 1, scale = new D(0);
  for (const z of a) scale = D.max(scale, abs2(z));
  const tol = D.mul(scale, D.mul(D.CHOP, D.CHOP).mul(1e4));     // (100·CHOP·max|a|)², compared with |pivot|²
  for (let k = 0; k < n; k++) {
    let p = k, best = abs2(a[k * n + k]);
    for (let r = k + 1; r < n; r++) { const v = abs2(a[r * n + k]); if (v.gt(best)) { best = v; p = r; } }
    if (best.lte(tol)) return { singular: true };
    if (p !== k) {
      for (let c = 0; c < n; c++) { const t = a[k * n + c]; a[k * n + c] = a[p * n + c]; a[p * n + c] = t; }
      [perm[k], perm[p]] = [perm[p], perm[k]];
      sign = -sign;
    }
    const piv = a[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = div(a[r * n + k], piv);
      a[r * n + k] = f;
      if (isZero(f)) continue;
      for (let c = k + 1; c < n; c++) a[r * n + c] = fms(a[r * n + c], f, a[k * n + c]);
    }
  }
  return { a, perm, sign, n, singular: false };
}
function luSolveCols(L, B) {                      // B: Mat n×m → X: n×m
  const { a, perm, n } = L, m = B.cols, X = new Mat(n, m);
  for (let c = 0; c < m; c++) {
    const y = new Array(n);
    for (let r = 0; r < n; r++) {
      let s = B.get(perm[r], c);
      for (let k = 0; k < r; k++) s = fms(s, a[r * n + k], y[k]);
      y[r] = s;
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = y[r];
      for (let k = r + 1; k < n; k++) s = fms(s, a[r * n + k], X.get(k, c));
      X.set(r, c, div(s, a[r * n + r]));
    }
  }
  return X;
}
function eye(n) { const m = new Mat(n, n); for (let i = 0; i < n; i++) m.set(i, i, ONE); return m; }
function matInv(v, pos) {
  square(v, pos);
  const L = lu(v, pos);
  if (L.singular) throw new CalcError('Matrix is singular — it has no inverse', pos, true);
  return denoiseRelMax(norm(luSolveCols(L, eye(v.rows))));
}
export function solve(A, b, pos) {
  square(A, pos);
  needMat(b, pos);
  if (b.rows !== A.rows) throw new CalcError(`Right-hand side needs ${A.rows} rows (it has ${b.rows})`, pos);
  const L = lu(A, pos);
  if (L.singular) throw new CalcError('Matrix is singular — the system has no unique solution', pos, true);
  return denoiseRelMax(norm(luSolveCols(L, b)));
}
function det(v, pos) {
  square(v, pos);
  const L = lu(v, pos);
  if (L.singular) return new D(0);
  let d = new D(L.sign);
  for (let k = 0; k < L.n; k++) d = mul(d, L.a[k * L.n + k]);
  return d;
}
function transp(m, h = false) {
  const out = new Mat(m.cols, m.rows);
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) out.set(c, r, h ? conj(m.get(r, c)) : m.get(r, c));
  return out;
}

// ─── functions ─────────────────────────────────────────────────────────────────
export const FUNCS = new Map();
function fn(names, f, lo = 1, hi = 1) { for (const nm of names.split(' ')) FUNCS.set(nm, { f, lo, hi }); }
const elementwise = f => (E, a, pos) => (isM(a[0]) ? matMap(a[0], z => f(z)) : f(num(a[0])));

fn('abs mag', (E, a, pos) => (isA(a[0]) ? new Angle(D.abs(a[0].ht)) : elementwise(z => cabs(z))(E, a, pos)));
fn('re real', elementwise(z => re(z)));
fn('im imag', elementwise(z => im(z)));
fn('conj', elementwise(z => conj(z)));
fn('ang arg angle', (E, a, pos) => {
  if (isA(a[0])) return a[0];
  const z = norm(scalar(a[0], pos));
  if (isZero(z)) return new Angle(new D(0));
  return new Angle(D.div(carg(z), PI()));
});
fn('fase cis', (E, a, pos) => cisHt(E.angleHt(a[0], pos), pos));
fn('polar', (E, a, pos) => mul(scalar(a[0], pos), cisHt(E.angleHt(a[1], pos), pos)), 2, 2);
fn('rect', (E, a, pos) => new Cx(real(a[0], pos), real(a[1], pos)), 2, 2);
fn('sqrt', (E, a, pos) => csqrt(norm(scalar(a[0], pos))));
fn('root', (E, a, pos) => {
  const x = norm(scalar(a[0], pos)), n = real(a[1], pos);
  if (n.isZero()) throw new CalcError('root(x;0) is undefined', pos);
  if (isR(x) && x.isNeg() && n.isInteger() && n.mod(2).abs().eq(1)) return D.pow(x.neg(), D.div(1, n)).neg();
  return cpow(x, D.div(1, n));
}, 2, 2);
fn('exp', (E, a, pos) => cexp(checkGrowth(norm(scalar(a[0], pos)), pos)));
fn('ln', (E, a, pos) => clog(norm(scalar(a[0], pos))));
fn('log10', (E, a, pos) => { const x = norm(scalar(a[0], pos)); return isR(x) && !x.isNeg() ? D.log10(x) : div(clog(x), D.ln(10)); });
fn('log2', (E, a, pos) => { const x = norm(scalar(a[0], pos)); return isR(x) && !x.isNeg() ? D.log2(x) : div(clog(x), D.ln(2)); });
fn('log', (E, a, pos) => {
  const x = norm(scalar(a[0], pos));
  if (a.length === 2) return div(clog(x), clog(norm(scalar(a[1], pos))));
  return isR(x) && !x.isNeg() ? D.log10(x) : div(clog(x), D.ln(10));
}, 1, 2);
function trig(kind) {
  return (E, a, pos) => {
    const v = a[0], x = norm(scalar(v, pos));
    if (isA(v) || isR(x)) {
      const ht = checkAngle(E.angleHt(v, pos), pos);
      const [s, c] = sincospi(ht);
      if (kind === 'sin') return s;
      if (kind === 'cos') return c;
      if (c.isZero()) throw new CalcError('tan is undefined here (cos = 0)', pos, true);
      return D.div(s, c);
    }
    checkGrowth(im(x), pos);
    if (D.abs(x.re).gt(D.MAX_HT)) throw new CalcError('Angle is too large to resolve, even at 500 digits', pos, false, true);
    if (kind === 'sin') return csin(x);
    if (kind === 'cos') return ccos(x);
    return div(csin(x), ccos(x));
  };
}
for (const k of ['sin', 'cos', 'tan']) fn(k, trig(k));
function itrig(f) {
  return (E, a, pos) => {
    const r = norm(f(norm(scalar(a[0], pos))));
    return isR(r) ? new Angle(D.div(r, PI())) : r;
  };
}
fn('asin', itrig(casin)); fn('acos', itrig(cacos)); fn('atan', itrig(catan));
fn('atan2', (E, a, pos) => new Angle(D.div(D.atan2(real(a[0], pos), real(a[1], pos)), PI())), 2, 2);
const hyp = {
  sinh: x => (isR(x) ? rsinh(x) : csinh(x)), cosh: x => (isR(x) ? rcosh(x) : ccosh(x)),
  tanh: x => (isR(x) ? rtanh(x) : div(csinh(x), ccosh(x))), asinh: casinh, acosh: cacosh, atanh: catanh,
};
for (const [k, f] of Object.entries(hyp)) fn(k, (E, a, pos) => f(checkGrowth(norm(scalar(a[0], pos)), pos)));

export function roundHalfUp(x, n) {
  if (x.isZero()) return x;
  const d = toDecimal(x);
  if (d.decimalPlaces() <= n) return x;                                       // already this coarse
  return d.toDecimalPlaces(n, Decimal.ROUND_HALF_UP);
}
fn('round', (E, a, pos) => {
  const n = a.length === 2 ? toInt(real(a[1], pos), pos, 'number of decimals') : 0;
  if (Math.abs(n) > DEC_GUARD) throw new CalcError(`round(): use between ${-DEC_GUARD} and ${DEC_GUARD} decimals`, pos);
  const r = x => (n >= 0 ? roundHalfUp(x, n) : roundNeg(x, n));
  const rz = z => (isC(z) ? new Cx(r(z.re), r(z.im)) : r(z));
  const v = a[0];
  if (isA(v)) {
    const f = E.angleUnit === 'deg' ? new D(180) : PI();
    return new Angle(D.div(r(D.mul(v.ht, f)), f));
  }
  if (isM(v)) return matMap(v, rz);
  return rz(scalar(v, pos));
}, 1, 2);
function roundNeg(x, n) {                         // round to 10^(-n) (n < 0): tens, hundreds…
  const q = new Decimal(`1e${-n}`);
  return toDecimal(x).div(q).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(q);
}

export function parallel(x, y, pos) {
  if (isZero(x) || isZero(y)) return new D(0);
  const s = add(x, y);
  if (isZero(norm(chopRef(s, D.max(cabs(x), cabs(y))))))
    throw new CalcError('Parallel of opposite impedances is infinite (resonance)', pos, true);
  return div(mul(x, y), s);
}
fn('par', (E, a, pos) => a.slice(1).reduce((acc, v) => parallel(acc, scalar(v, pos), pos), scalar(a[0], pos)), 2, 64);
fn('zl', (E, a, pos) => new Cx(Z0, D.mul(D.mul(D.mul(2, PI()), real(a[0], pos)), real(a[1], pos))), 2, 2);
fn('zc', (E, a, pos) => {
  const d = D.mul(D.mul(D.mul(2, PI()), real(a[0], pos)), real(a[1], pos));
  if (d.isZero()) throw new CalcError('zc: f·C = 0 gives infinite impedance', pos, true);
  return new Cx(Z0, D.div(-1, d));
}, 2, 2);
fn('omega', (E, a, pos) => D.mul(D.mul(2, PI()), real(a[0], pos)));
fn('pf', (E, a, pos) => D.cos(carg(norm(scalar(a[0], pos)))));
fn('db20', (E, a, pos) => D.mul(20, D.log10(cabs(scalar(a[0], pos)))));
fn('db10', (E, a, pos) => D.mul(10, D.log10(cabs(scalar(a[0], pos)))));
fn('s3', (E, a, pos) => mul(mul(D.sqrt(3), scalar(a[0], pos)), conj(scalar(a[1], pos))), 2, 2);
fn('s1', (E, a, pos) => mul(scalar(a[0], pos), conj(scalar(a[1], pos))), 2, 2);
fn('i3', (E, a, pos) => {
  const v = scalar(a[1], pos);
  if (isZero(v)) throw new CalcError('i3: the voltage can\'t be zero', pos, true);
  return conj(div(scalar(a[0], pos), mul(D.sqrt(3), v)));
}, 2, 2);
export function starToDelta(za, zb, zc, pos = null) {
  if (isZero(za) || isZero(zb) || isZero(zc)) throw new CalcError('A star impedance of zero has no delta equivalent', pos, true);
  const sp = add(add(mul(za, zb), mul(zb, zc)), mul(zc, za));
  return [div(sp, zc), div(sp, za), div(sp, zb)];
}
export function deltaToStar(zab, zbc, zca, pos = null) {
  const s = add(add(zab, zbc), zca);
  if (isZero(norm(chopRef(s, D.max(cabs(zab), cabs(zbc), cabs(zca))))))
    throw new CalcError('The delta impedances sum to zero', pos, true);
  return [div(mul(zab, zca), s), div(mul(zab, zbc), s), div(mul(zbc, zca), s)];
}
fn('y2d', (E, a, pos) => col(starToDelta(...three(a, pos, 'y2d'), pos)), 1, 3);
fn('d2y', (E, a, pos) => col(deltaToStar(...three(a, pos, 'd2y'), pos)), 1, 3);
fn('zbase', (E, a, pos) => D.div(D.mul(real(a[0], pos), real(a[0], pos)), nz(real(a[1], pos))), 2, 2);
fn('ybase', (E, a, pos) => D.div(real(a[1], pos), nz(D.mul(real(a[0], pos), real(a[0], pos)))), 2, 2);
fn('ibase', (E, a, pos) => D.div(real(a[1], pos), nz(D.mul(D.sqrt(3), real(a[0], pos)))), 2, 2);
fn('pu', (E, a, pos) => (isM(a[0]) ? matScale(a[0], scalar(a[1], pos), true) : div(scalar(a[0], pos), scalar(a[1], pos))), 2, 2);
fn('chbase', (E, a, pos) => {
  const z = scalar(a[0], pos), [vo, so, vn, sn] = a.slice(1).map(x => real(x, pos));
  const k = D.mul(D.pow(D.div(vo, nz(vn)), 2), D.div(sn, nz(so)));
  return mul(z, k);
}, 5, 5);
function nz(x) { if (x.isZero()) throw new CalcError('Division by zero', null, true); return x; }
export function fortescue(x, y, z, p, q) {
  const ref = D.max(cabs(x), cabs(y), cabs(z));
  return chopRef(add(add(x, mul(p, y)), mul(q, z)), ref);
}
fn('seq', (E, args, pos) => {
  const [va, vb, vc] = three(args, pos, 'seq'), a = aOp(), a2 = a2Op();
  return col([div(fortescue(va, vb, vc, ONE, ONE), new D(3)), div(fortescue(va, vb, vc, a, a2), new D(3)), div(fortescue(va, vb, vc, a2, a), new D(3))]);
}, 1, 3);
fn('abc', (E, args, pos) => {
  const [v0, v1, v2] = three(args, pos, 'abc'), a = aOp(), a2 = a2Op();
  return col([fortescue(v0, v1, v2, ONE, ONE), fortescue(v0, v1, v2, a2, a), fortescue(v0, v1, v2, a, a2)]);
}, 1, 3);
fn('inv', (E, a, pos) => (isM(a[0]) ? matInv(a[0], pos) : div(ONE, scalar(a[0], pos))));
fn('det', (E, a, pos) => det(a[0], pos));
fn('transp', (E, a, pos) => transp(needMat(a[0], pos)));
fn('herm', (E, a, pos) => transp(needMat(a[0], pos), true));
fn('solve', (E, a, pos) => solve(a[0], a[1], pos), 2, 2);
fn('eye', (E, a, pos) => eye(dim(real(a[0], pos), pos)));
fn('zeros', (E, a, pos) => {
  const r = dim(real(a[0], pos), pos), c = a.length === 2 ? dim(real(a[1], pos), pos) : r;
  return new Mat(r, c);
}, 1, 2);
fn('diag', (E, a, pos) => {
  let vals;
  if (a.length === 1 && isM(a[0])) {
    if (a[0].rows !== 1 && a[0].cols !== 1) throw new CalcError('diag(v) needs a vector', pos);
    vals = a[0].a.slice();
  } else vals = a.map(x => scalar(x, pos));
  dim(new Decimal(vals.length), pos);
  const m = new Mat(vals.length, vals.length);
  vals.forEach((v, i) => m.set(i, i, v));
  return m;
}, 1, 64);

const CONSTS = {
  pi: () => PI(), 'π': () => PI(), e: () => D.exp(1), j: () => new Cx(Z0, ONE), a: () => aOp(),
  c0: () => new Decimal('299792458'), mu0: () => new Decimal('1.25663706127e-6'), eps0: () => new Decimal('8.8541878188e-12'),
};
const RESERVED = new Set(['ans', 'rad', 'deg']);

// ─── verification across precision levels ─────────────────────────────────────
export function agreeDigits(a, b, dps) {
  const both = (isR(a) || isC(a)) && (isR(b) || isC(b));
  if (!both && a.constructor !== b.constructor) return 0;
  if (isM(a) && (a.rows !== b.rows || a.cols !== b.cols)) return 0;
  return withDps((dps || LEVELS[LEVELS.length - 1]) + 10, () => {
    const pairs = isM(a) ? a.a.map((x, i) => [x, b.a[i]]) : isA(a) ? [[a.ht, b.ht]] : [[a, b]];
    let worst = VERIFY_DIGITS + 1;
    for (const [x, y] of pairs) {
      const mag = D.max(cabs(x), cabs(y)), floor = D.mul(mag, BASE_CHOP);
      for (const [p, q] of [[re(x), re(y)], [im(x), im(y)]]) {
        if (D.abs(p).lte(floor) && D.abs(q).lte(floor)) continue;
        const d = D.abs(D.sub(p, q));
        if (!d.isZero()) worst = Math.min(worst, log10Fast(D.max(D.abs(p), D.abs(q))) - log10Fast(d));
      }
    }
    return worst;
  });
}
function agreeAll(xs, ys, dps) {
  if (xs.length !== ys.length) return 0;
  let best = VERIFY_DIGITS + 1;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x == null && y == null) continue;
    if (x == null || y == null) return 0;
    best = Math.min(best, agreeDigits(x, y, dps));
  }
  return best;
}
/** log10 of a positive Decimal from its exponent and leading digits (no series needed). */
function log10Fast(x) {
  const s = x.toExponential(14);
  return x.e + Math.log10(parseFloat(s.slice(0, s.indexOf('e'))));
}
/** Run fn() at rising precision until two consecutive levels agree. -> [result, reliable|null, dps] */
export function runVerified(fn, values = r => [r]) {
  const out = [];
  for (const dps of LEVELS) {
    try { out.push(['ok', withDps(dps, fn), dps]); }
    catch (ex) {
      const err = asCalcError(ex);
      if (!err.numeric) throw err;
      out.push(['err', err, dps]);
    }
    if (out.length >= 2) {
      const [prev, cur] = out.slice(-2);
      if (cur[0] === 'err' && cur[1].escalate) continue;
      if (prev[0] === 'err' && cur[0] === 'err' && prev[1].msg === cur[1].msg) throw cur[1];
      if (prev[0] === 'ok' && cur[0] === 'ok' && agreeAll(values(prev[1]), values(cur[1]), dps) >= VERIFY_DIGITS)
        return [cur[1], null, dps];
    }
  }
  const [prev, cur] = out.slice(-2);
  if (cur[0] === 'err') throw cur[1];
  if (prev[0] === 'ok') {
    const d = Math.floor(agreeAll(values(prev[1]), values(cur[1])));
    if (d >= MIN_RELIABLE) return [cur[1], d, LEVELS[LEVELS.length - 1]];
  }
  throw new CalcError(`This result can't be determined reliably, even at ${LEVELS[LEVELS.length - 1]} digits`);
}
function asCalcError(ex) {
  if (ex instanceof CalcError) return ex;
  if (ex instanceof RangeError) return new CalcError('Expression is nested too deeply');
  return new CalcError("This expression can't be evaluated");
}

// ─── engine ────────────────────────────────────────────────────────────────────
export class Engine {
  constructor() {
    this.vars = new Map();
    this.ans = null;
    this.angleUnit = 'deg';
    this._state = 0;          // bumped whenever something an expression can read changes
    this._cache = null;       // last evaluation: {key, name, value, reliable}
    this._ast = null;         // last parsed text: {text, node}
  }
  setVar(name, v) { this.vars.set(name, v); this._state++; }
  delVar(name) { if (this.vars.delete(name)) this._state++; }
  clearVars() { this.vars.clear(); this._state++; }
  reset() { this.vars.clear(); this.ans = null; this._cache = null; this._ast = null; this._state++; memo.clear(); }

  untaggedHt(x) { return this.angleUnit === 'deg' ? D.div(x, 180) : D.div(x, PI()); }
  angleHt(v, pos) {
    if (isA(v)) return v.ht;
    v = norm(scalar(v, pos, 'angle'));
    if (!isR(v)) throw new CalcError('An angle must be a real number', pos);
    return this.untaggedHt(v);
  }
  lookup(name, pos) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (name === 'ans') {
      if (this.ans === null) throw new CalcError('No previous result yet', pos);
      return this.ans;
    }
    if (CONSTS[name]) return CONSTS[name]();
    if (FUNCS.has(name)) throw new CalcError(`'${name}' is a function — write ${name}(…)`, pos);
    if (name.startsWith('j') && name.length > 1) {
      try { return mul(new Cx(Z0, ONE), scalar(this.lookup(name.slice(1), pos), pos)); } catch { /* fall through */ }
    }
    if (FUNCS.has(name.toLowerCase())) throw new CalcError(`Unknown name '${name}' — function names are lowercase: ${name.toLowerCase()}(…)`, pos);
    throw new CalcError(`Unknown name '${name}'`, pos);
  }
  checkName(name, pos) {
    if (CONSTS[name]) throw new CalcError(`'${name}' is ${name === 'a' ? 'the Fortescue operator (1∠120°)' : 'a built-in constant'}; choose another name`, pos);
    if (RESERVED.has(name)) throw new CalcError(`'${name}' is reserved; choose another name`, pos);
    if (FUNCS.has(name)) throw new CalcError(`'${name}' is a function name; choose another name`, pos);
  }
  _parse(text) {
    if (this._ast && this._ast.text === text) return this._ast.node;
    let node;
    try { node = parse(text); } catch (ex) { throw asCalcError(ex); }
    this._ast = { text, node };
    return node;
  }
  /** -> {name, value, reliable}. Throws CalcError. */
  evaluate(text, commit = true) {
    text = text.trim();
    if (!text) throw new CalcError('Empty expression', 0);
    const key = `${this._state}\u0000${this.angleUnit}\u0000${text}`;
    let name, v, reliable;
    if (this._cache && this._cache.key === key) ({ name, value: v, reliable } = this._cache);   // verified by the preview
    else {
      let node = this._parse(text);
      name = null;
      if (node.k === 'assign') { name = node.name; this.checkName(name, node.pos); node = node.e; }
      let dps;
      [v, reliable, dps] = runVerified(() => this.finish(this.ev(node)));
      v = cleanAt(v, dps);
      this._cache = { key, name, value: v, reliable };
    }
    if (commit) {
      if (name) this.vars.set(name, v);
      this.ans = v;
      this._state++;
      this._cache = null;
    }
    return { name, value: v, reliable };
  }
  /** One expression at the current precision, no assignment (input fields of tools). */
  evalValue(text) {
    const node = this._parse(text.trim());
    if (node.k === 'assign') throw new CalcError("Assignments aren't allowed here", 0);
    return this.finish(this.ev(node));
  }
  finish(v) {
    v = norm(v);
    if (!finite(v)) throw new CalcError('Result is infinite or undefined', null, true);
    checkRange(v);
    return v;
  }
  ev(n) {
    try {
      switch (n.k) {
        case 'num': return n.v;
        case 'var': return this.lookup(n.name, n.pos);
        case 'neg': { const v = this.ev(n.a); return isA(v) ? new Angle(v.ht.neg()) : isM(v) ? matMap(v, neg) : neg(v); }
        case 'bin': return norm(this.binop(n.op, this.ev(n.a), this.ev(n.b), n.pos));
        case 'polar': {
          const r = this.ev(n.r), ht = this.angleHt(this.ev(n.ang), n.pos);
          return norm(mul(scalar(r, n.pos, 'magnitude'), cisHt(ht, n.pos)));
        }
        case 'deg': case 'rad': {
          const v = this.ev(n.a);
          if (isA(v)) throw new CalcError('This angle already has a unit', n.pos);
          const x = real(v, n.pos, 'angle');
          return new Angle(n.k === 'deg' ? D.div(x, 180) : D.div(x, PI()));
        }
        case 'call': {
          const { f, lo, hi } = FUNCS.get(n.name);
          const args = n.args.map(a => this.ev(a));
          if (args.length < lo || args.length > hi)
            throw new CalcError(`${n.name}() takes ${lo === hi ? lo : `${lo}–${hi}`} argument(s), got ${args.length}`, n.pos);
          return norm(f(this, args, n.pos));
        }
        case 'callvar': return this.callvar(n);
        case 'mat': return this.matrix(n);
      }
    } catch (ex) {
      if (ex instanceof CalcError) throw ex;
      if (ex instanceof RangeError) throw ex;       // stack overflow: reported by asCalcError
      throw new CalcError('Invalid operation for these operands', n.pos ?? null);
    }
    throw new CalcError('Internal: unknown node ' + n.k);
  }
  callvar(n) {
    const v = this.lookup(n.name, n.pos), vals = n.args.map(a => this.ev(a));
    if (isM(v)) {
      const idx = vals.map(x => toInt(real(x, n.pos, 'index'), n.pos, 'index'));
      const oor = () => new CalcError(`Index out of range for a ${v.rows}×${v.cols} matrix`, n.pos);
      if (idx.length === 1) {
        const k = idx[0];
        if (!(k >= 1 && k <= v.rows * v.cols)) throw oor();
        if (v.rows === 1 || v.cols === 1) return v.a[k - 1];
        if (k > v.rows) throw oor();
        return new Mat(1, v.cols, v.a.slice((k - 1) * v.cols, k * v.cols));
      }
      if (idx.length === 2) {
        const [r, c] = idx;
        if (!(r >= 1 && r <= v.rows && c >= 1 && c <= v.cols)) throw oor();
        return v.get(r - 1, c - 1);
      }
      throw new CalcError('Use M(i) or M(i;j) to index a matrix', n.pos);
    }
    if (vals.length !== 1) throw new CalcError(`'${n.name}' is not a function or matrix`, n.pos);
    return norm(this.binop('*', v, vals[0], n.pos));
  }
  matrix(n) {
    const rows = n.rows, m = new Mat(rows.length, rows[0].length);
    rows.forEach((row, r) => row.forEach((e, c) => {
      const v = this.ev(e);
      if (isM(v)) throw new CalcError("Nested matrices aren't supported", n.pos);
      if (isA(v)) throw new CalcError('Put angles inside a phasor (r∠θ) before storing them in a matrix', n.pos);
      m.set(r, c, v);
    }));
    return m;
  }
  angleOp(op, a, b, A, B) {
    if (op === '+' || op === '-') {
      if (A && B) return new Angle(op === '+' ? D.add(a.ht, b.ht) : D.sub(a.ht, b.ht));
      const other = A ? b : a;
      if (!isM(other) && isR(norm(other))) {
        const o = this.untaggedHt(other);
        if (A) return new Angle(op === '+' ? D.add(a.ht, o) : D.sub(a.ht, o));
        return new Angle(op === '+' ? D.add(o, b.ht) : D.sub(o, b.ht));
      }
      return null;
    }
    if (op === '*' && A !== B) {
      const other = A ? b : a, ang = A ? a : b;
      if (!isM(other) && isR(norm(other))) return new Angle(D.mul(ang.ht, other));
    }
    if (op === '/') {
      if (A && B) { if (b.ht.isZero()) throw new CalcError('Division by zero', null, true); return D.div(a.ht, b.ht); }
      if (A && !isM(b) && isR(norm(b))) { if (b.isZero()) throw new CalcError('Division by zero', null, true); return new Angle(D.div(a.ht, b)); }
    }
    return null;
  }
  binop(op, a, b, pos) {
    const A = isA(a), B = isA(b);
    if (A || B) {
      const r = this.angleOp(op, a, b, A, B);
      if (r !== null) return r;
      a = num(a); b = num(b);
    }
    const ma = isM(a), mb = isM(b);
    if (op === '+' || op === '-') {
      if (ma !== mb) throw new CalcError("Can't add a matrix and a scalar", pos);
      if (ma) {
        if (a.rows !== b.rows || a.cols !== b.cols) throw new CalcError(`Can't add ${a.rows}×${a.cols} and ${b.rows}×${b.cols}`, pos);
        return matAddSub(a, b, op);
      }
      return chopRef(op === '+' ? add(a, b) : sub(a, b), D.max(cabs(a), cabs(b)));   // cancellation residue is noise
    }
    if (op === '*') {
      if (ma && mb) {
        if (a.cols !== b.rows) throw new CalcError(`Can't multiply ${a.rows}×${a.cols} by ${b.rows}×${b.cols}`, pos);
        return matMul(a, b);
      }
      if (ma) return matScale(a, b);
      if (mb) return matScale(b, a);
      return mul(a, b);
    }
    if (op === '/') {
      if (mb) throw new CalcError("Can't divide by a matrix — use inv(M) or A\\b", pos);
      if (ma) return matScale(a, b, true);
      return div(a, b);
    }
    if (op === '\\') {
      if (ma) {
        if (!mb) throw new CalcError('A\\b needs b as a column vector', pos);
        return solve(a, b, pos);
      }
      if (mb) throw new CalcError('Left division needs a square matrix on the left', pos);
      return div(b, a);
    }
    if (op === '^') {
      if (mb) throw new CalcError("Exponent can't be a matrix", pos);
      if (ma) {
        let p = norm(b);
        if (!isR(p)) throw new CalcError('Matrix powers need an integer exponent', pos);
        p = toInt(p, pos, 'matrix exponent');
        square(a, pos);
        if (Math.abs(p) > 1e6) throw new CalcError('Matrix exponent is too large', pos);
        if (p < 0) { a = matInv(a, pos); p = -p; }
        let res = eye(a.rows), base = a;
        while (p > 0) { if (p & 1) res = matMul(res, base); p = Math.floor(p / 2); if (p) base = matMul(base, base); }
        return denoiseRelMax(res);
      }
      a = norm(a); b = norm(b);
      if (isZero(a)) {
        if (!isZero(b) && re(b).isNeg()) throw new CalcError('Division by zero', pos, true);
        return isZero(b) ? new D(1) : new D(0);
      }
      const la = D.abs(D.ln(cabs(a)));
      if (!cabs(a).eq(1) && !isZero(b) && mag2(cabs(b)) + mag2(la) > MAX_MAG_BITS + 1)
        throw new CalcError('Result is too large to represent', pos);
      if (isC(a) || isC(b) || a.isNeg()) {
        const rot = D.add(D.mul(re(b), carg(a)), D.mul(im(b), D.ln(cabs(a))));
        checkAngle(D.div(rot, PI()), pos);
      }
      return cpow(a, b);
    }
    if (op === '//') {
      if (ma || mb) throw new CalcError("'//' works on scalars (impedances)", pos);
      return parallel(a, b, pos);
    }
    throw new CalcError(`Unknown operator ${op}`, pos);
  }
}

// ─── formatting ────────────────────────────────────────────────────────────────
const SI_OUT = { 12: 'T', 9: 'G', 6: 'M', 3: 'k', 0: '', '-3': 'm', '-6': 'µ', '-9': 'n', '-12': 'p' };
function toDecimal(x) { return new DISPLAY(x).toSignificantDigits(DEC_GUARD, Decimal.ROUND_HALF_EVEN); }
/** x > 0 -> [D, e]: D has `sig` digits, x ≈ D[0].D[1:] × 10^e, rounded half-up. */
function digits(x, sig) {
  const s = toDecimal(x).toExponential(sig - 1, Decimal.ROUND_HALF_UP);   // "d.ddde+N"
  const k = s.indexOf('e');
  return [s.slice(0, k).replace('.', ''), parseInt(s.slice(k + 1), 10)];
}
function place(Dg, e) {
  let ip, fr;
  if (e >= 0) {
    if (e + 1 >= Dg.length) { ip = Dg + '0'.repeat(e + 1 - Dg.length); fr = ''; }
    else { ip = Dg.slice(0, e + 1); fr = Dg.slice(e + 1); }
  } else { ip = '0'; fr = '0'.repeat(-e - 1) + Dg; }
  fr = fr.replace(/0+$/, '');
  return ip + (fr ? ',' + fr : '');
}
export function fmtReal(x, sig = 10, notation = 'auto') {
  x = new Decimal(x);
  if (x.isZero()) return '0';
  const negv = x.isNeg();
  const [Dg, e] = digits(x.abs(), sig);
  let s;
  if (notation === 'eng') {
    const e3 = Math.floor(e / 3) * 3;
    s = place(Dg, e - e3) + (SI_OUT[e3] !== undefined ? SI_OUT[e3] : `e${e3}`);
  } else if (notation === 'sci' || !(e >= -5 && e < Math.max(sig, 1))) {
    const tail = Dg.slice(1).replace(/0+$/, '');
    s = Dg[0] + (tail ? ',' + tail : '') + `e${e}`;
  } else s = place(Dg, e);
  return (negv ? '-' : '') + s;
}
export function fmtAngleHt(ht, unit, sig) {
  if (unit === 'deg') return fmtReal(withDps(WORK_DPS, () => D.mul(ht, 180)), sig) + '°';
  return fmtReal(withDps(WORK_DPS, () => D.mul(ht, PI())), sig) + ' rad';
}
export function fmtRect(z, sig, notation) {
  z = withDps(WORK_DPS, () => norm(z));
  if (isR(z)) return fmtReal(z, sig, notation);
  const ims = fmtReal(z.im.abs(), sig, notation);
  if (z.re.isZero()) return (z.im.isNeg() ? '-j' : 'j') + ims;
  return `${fmtReal(z.re, sig, notation)} ${z.im.isNeg() ? '-' : '+'} j${ims}`;
}
/**
 Format a transcendental quantity cheaply but exactly: compute it with sig+20 digits, and accept the
 text only if the value's lower and upper error bounds round to the same text. Otherwise (a near-tie)
 recompute at the full working precision.
*/
function displayExact(compute, sig, fmt) {
  const p = Math.min(WORK_DPS, sig + 20);
  if (p < WORK_DPS) {
    const v = withDps(p, compute);
    const err = withDps(p + 5, () => D.mul(D.abs(v), new D(`1e-${p - 3}`)));
    const txt = fmt(v);
    if (fmt(withDps(p + 5, () => D.sub(v, err))) === txt && fmt(withDps(p + 5, () => D.add(v, err))) === txt) return txt;
  }
  return fmt(withDps(WORK_DPS, compute));
}
/** Magnitude and angle texts of a complex number (magnitude formatted by magFmt). */
export function polarParts(z, sig, unit, magFmt) {
  const mag = displayExact(() => cabs(z), sig, magFmt);
  const ang = unit === 'deg'
    ? displayExact(() => D.div(D.mul(carg(z), 180), PI()), sig, v => fmtReal(v, sig) + '°')
    : displayExact(() => carg(z), sig, v => fmtReal(v, sig) + ' rad');
  return [mag, ang];
}
export function fmtPolar(z, sig, notation, unit) {
  z = withDps(WORK_DPS, () => norm(z));
  if (isZero(z)) return '0';
  const mag = displayExact(() => cabs(z), sig, v => fmtReal(v, sig, notation));
  const ang = unit === 'deg'
    ? displayExact(() => D.div(D.mul(carg(z), 180), PI()), sig, v => fmtReal(v, sig) + '°')
    : displayExact(() => carg(z), sig, v => fmtReal(v, sig) + ' rad');
  return `${mag} ∠ ${ang}`;
}
function grid(m, cell) {
  const cells = [];
  for (let r = 0; r < m.rows; r++) { const row = []; for (let c = 0; c < m.cols; c++) row.push(cell(m.get(r, c))); cells.push(row); }
  const w = [];
  for (let c = 0; c < m.cols; c++) w.push(Math.max(...cells.map(row => row[c].length)));
  return cells.map(row => '[ ' + row.map((s, c) => s.padStart(w[c])).join('   ') + ' ]');
}
/** -> [[text, role]]; role 'main' (rectangular / real) or 'alt' (polar / secondary). */
export function formatValue(v, unit = 'deg', sig = 10, notation = 'auto') {
  if (isA(v)) return [[fmtAngleHt(v.ht, unit, sig), 'main'], [fmtAngleHt(v.ht, unit === 'deg' ? 'rad' : 'deg', sig), 'alt']];
  if (isM(v)) {
    const lines = grid(v, z => fmtRect(z, sig, notation)).map(l => [l, 'main']);
    if (v.a.some(z => isC(withDps(WORK_DPS, () => norm(z))))) grid(v, z => fmtPolar(z, sig, notation, unit)).forEach(l => lines.push([l, 'alt']));
    return lines;
  }
  v = withDps(WORK_DPS, () => norm(v));
  if (isC(v)) return [[fmtRect(v, sig, notation), 'main'], [fmtPolar(v, sig, notation, unit), 'alt']];
  return [[fmtReal(v, sig, notation), 'main']];
}
/** Rectangular text at 40 significant digits (or fewer if not all verified), re-parseable. */
export function fullPrecision(v, unit = 'deg', reliable = null) {
  const sig = reliable ? Math.min(FULL_SIG, reliable) : FULL_SIG;
  if (isA(v)) return fmtAngleHt(v.ht, unit, sig).replace(' rad', 'rad');
  if (isM(v)) {
    const rows = [];
    for (let r = 0; r < v.rows; r++) { const row = []; for (let c = 0; c < v.cols; c++) row.push(fmtRect(v.get(r, c), sig, 'auto')); rows.push(row.join(' | ')); }
    return '[' + rows.join(' ; ') + ']';
  }
  return fmtRect(v, sig, 'auto');
}
export const internals = { withDps, get D() { return D; }, add, sub, mul, div, neg, conj, cabs, carg, csqrt, cexp, clog, cpow,
  norm, chopRef, cisHt, aOp, a2Op, PI, re, im, isZero, three, col, scalar, real, csinh, ccosh, rsinh, rcosh };
