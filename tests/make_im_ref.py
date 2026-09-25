"""Independent reference for the induction-machine tools (imtest, imop), written with mpmath at 80 digits.

It deliberately avoids the JavaScript's formula paths where they matter:
  * the operating point solves the T-circuit directly (input impedance, then current division), not
    through the Thévenin equivalent;
  * s_Tmax, T_max, the generator pull-out torque and the slip for a given P out / T load are found
    numerically (mpmath root finders on the circuit functions), not from closed forms;
  * the test reduction works with complex powers (Z = S / I²) instead of |Z|, R, √(Z² − R²).
Test data are synthesised from a "true" machine (full T-circuit, locked rotor at f_lr, no-load at a small
slip), so they are consistent like real measurements. Output: im_ref.json.
"""
import json, random
from mpmath import mp, mpf, mpc, sqrt, fabs, pi, findroot, diff as mdiff, arg, degrees

mp.dps = 80
rng = random.Random(20260925)
SPLIT = {'AD': ('0.5', '0.5'), 'B': ('0.4', '0.6'), 'C': ('0.3', '0.7')}


def txt(x, sig=None):
    """Decimal string with a comma, as typed in the app."""
    sig = sig or rng.choice([4, 6, 8, 12])
    return mp.nstr(mpf(x), sig, min_fixed=-6, max_fixed=12).replace('.', ',').replace('e', 'e')


def num(t):
    return mpf(t.replace(',', '.'))


def ph(conn, V, I):
    return (V / sqrt(3), I) if conn == 'Y' else (V, I / sqrt(3))


# ─── operating point ─────────────────────────────────────────────────────────
class Machine:
    def __init__(self, conn, model, V, f, poles, R1, X1, R2, X2, Xm, Rfe, Pfw):
        self.conn, self.exact = conn, model == 'exact'
        self.V = V / sqrt(3) if conn == 'Y' else V
        self.R1, self.X1, self.R2, self.X2, self.Rfe, self.Pfw = R1, X1, R2, X2, Rfe, Pfw
        self.Z1 = mpc(R1, X1)
        self.Zm = 1 / ((1 / Rfe if Rfe is not None else 0) + 1 / mpc(0, Xm))
        self.ns = 120 * f / poles
        self.ws = 2 * pi * f / (poles / 2)

    def solve(self, s):
        V, Z1, Zm = self.V, self.Z1, self.Zm
        if s == 0:
            I2 = mpc(0)
            if self.exact:
                I1 = V / (Z1 + Zm); E1 = V - Z1 * I1
            else:
                E1 = V; I1 = V / Zm
        else:
            Z2 = mpc(self.R2 / s, self.X2)
            if self.exact:
                I1 = V / (Z1 + Zm * Z2 / (Zm + Z2)); E1 = V - Z1 * I1; I2 = E1 / Z2
            else:
                E1 = V; I2 = V / (Z1 + Z2); I1 = I2 + V / Zm
        return I1, I2, E1

    def torque(self, s):
        _, I2, _ = self.solve(s)
        return 3 * abs(I2) ** 2 * self.R2 / s / self.ws

    def extreme(self, sign):
        """Numerical extremum of T(s) for s > 0 (sign=+1) or s < 0 (sign=−1): coarse scan, then root of dT/ds."""
        grid = [sign * mpf(10) ** (mpf(k) / 10 - 6) for k in range(0, 81)]
        vals = [sign * self.torque(s) for s in grid]
        i = max(range(1, len(grid) - 1), key=lambda k: vals[k])
        s = findroot(lambda x: mdiff(self.torque, x), (grid[i - 1], grid[i + 1]), solver='anderson', tol=mpf(10) ** -70)
        return s, self.torque(s)

    def point(self, s):
        I1, I2, E1 = self.solve(s)
        o = {}
        Sin = 3 * self.V * I1.conjugate()
        Pcu2 = 3 * abs(I2) ** 2 * self.R2
        Pag = mpf(0) if s == 0 else Pcu2 / s
        Pmec = Pag * (1 - s); Pout = Pmec - self.Pfw
        o['s'] = s; o['n'] = self.ns * (1 - s)
        o['I1'] = I1 if self.conn == 'Y' else sqrt(3) * I1
        if abs(Sin) != 0:
            o['PF'] = fabs(Sin.real) / abs(Sin); o['phi'] = degrees(arg(Sin))
        o['Pin'] = Sin.real; o['Qin'] = Sin.imag
        o['Pcu1'] = 3 * abs(I1 if self.exact else I2) ** 2 * self.R1
        if self.Rfe is not None: o['Pfe'] = 3 * abs(E1) ** 2 / self.Rfe
        o['Pag'] = Pag; o['Pcu2'] = Pcu2; o['Pmec'] = Pmec; o['Pout'] = Pout; o['Tem'] = Pag / self.ws
        if s != 1: o['Tsh'] = Pout / (self.ws * (1 - s))
        if Sin.real > 0 and Pout > 0: o['eta'] = 100 * Pout / Sin.real
        elif Sin.real < 0 and Pout < 0: o['eta'] = 100 * Sin.real / Pout
        o['I2'] = abs(I2)
        return o

    def target_slip(self, mode, target, sTmax):
        """Lowest positive slip below s_Tmax where the shaft power / load torque equals the target."""
        if target == 0 and self.Pfw == 0: return mpf(0)
        def g(s):
            p = self.point(s)
            return (p['Tsh'] if mode == 'T' else p['Pout']) - target
        hi = min(sTmax, 1 - mpf(10) ** -12)
        prev = mpf(0)
        for k in range(0, 241):
            s = hi * mpf(10) ** (mpf(k) / 20 - 12)
            if g(s) >= 0:
                return findroot(g, (prev, s), solver='anderson', tol=mpf(10) ** -75)
            prev = s
        return None

    def machine(self):
        o = {}
        Vth = self.V * self.Zm / (self.Z1 + self.Zm) if self.exact else self.V
        Zth = self.Z1 * self.Zm / (self.Z1 + self.Zm) if self.exact else self.Z1
        sT, Tm = self.extreme(+1)
        o['ns'] = self.ns; o['Vth'] = abs(Vth); o['Zth'] = Zth; o['sTmax'] = sT; o['Tmax'] = Tm
        o['nTmax'] = self.ns * (1 - sT)
        st = self.point(mpf(1))
        o['Tst'] = st['Tem']; o['Ist'] = abs(st['I1'])
        _, Tg = self.extreme(-1)
        o['Tgen'] = Tg
        return o, sT


def ref_imop(t):
    g = lambda k: num(t[k]) if t.get(k) else None
    m = Machine(t['conn'], t['model'], g('V'), g('f'), g('poles'), g('R1'), g('X1'), g('R2'), g('X2'), g('Xm'), g('Rfe'),
                g('Pfw') or mpf(0))
    mach, sT = m.machine()
    out = {}
    given = [k for k in ('s', 'n', 'Pout', 'Tl') if t.get(k)]
    if given:
        k = given[0]
        if k == 's': s = g('s')
        elif k == 'n': s = (m.ns - g('n')) / m.ns
        else:
            s = m.target_slip('T' if k == 'Tl' else 'P', g(k), sT)
            if s is None: return None
        out.update(m.point(s))
    out.update(mach)
    if t.get('tbl'):
        for j, x in enumerate(t['tbl'].split(';'), 1):
            p = m.point(num(x.strip()))
            out[f's_t{j}'] = p['s']; out[f'n_t{j}'] = p['n']; out[f'T_t{j}'] = p['Tem']; out[f'I_t{j}'] = abs(p['I1'])
            if 'eta' in p: out[f'eta_t{j}'] = p['eta']
    return out


# ─── parameters from tests ───────────────────────────────────────────────────
def ref_imtest(t):
    g = lambda k: num(t[k]) if t.get(k) else None
    f = g('f'); R1 = g('R1') * (g('kR') or 1); k1, k2 = map(mpf, SPLIT[t['cls']])
    Vl, Il = ph(t['conn'], g('Vlr'), g('Ilr')); Pl = g('Plr'); flr = g('flr') or f
    Sl = 3 * Vl * Il
    if Pl > Sl: return None
    Zlr = mpc(Pl / 3, sqrt(Sl ** 2 - Pl ** 2) / 3) / Il ** 2          # complex power over I²
    Rlr, Xlr = Zlr.real, Zlr.imag * f / flr
    R2 = Rlr - R1
    if R2 <= 0 or Xlr <= 0: return None
    X1, X2 = k1 * Xlr, k2 * Xlr
    V0, I0 = ph(t['conn'], g('V0'), g('I0')); P0 = g('P0'); Pfw = g('Pfw') or mpf(0)
    S0 = 3 * V0 * I0
    if P0 > S0: return None
    S0c = mpc(P0, sqrt(S0 ** 2 - P0 ** 2))
    Pfe = P0 - 3 * I0 ** 2 * R1 - Pfw
    # approximate circuit: the magnetising branch is at the terminals, so I0 never flows through X1
    Qm = S0c.imag - 3 * I0 ** 2 * X1 if t['model'] == 'exact' else S0c.imag
    if Pfe < 0 or Qm <= 0: return None
    I0c = (S0c / 3 / V0).conjugate()
    E2 = abs(V0 - mpc(R1, X1) * I0c) ** 2 if t['model'] == 'exact' else V0 ** 2
    o = {'R1': R1, 'X1': X1, 'R2': R2, 'X2': X2}
    if Pfe != 0: o['Rfe'] = E2 / (Pfe / 3)
    o.update({'Xm': E2 / (Qm / 3), 'Pfe': Pfe, 'Pcu0': 3 * I0 ** 2 * R1, 'Rlr': Rlr, 'Xlr': Xlr})
    return o


# ─── synthesised machines and test data ──────────────────────────────────────
def rand_machine():
    V = rng.choice([230, 400, 460, 690, 3300, 6000, 10000]) * mpf(rng.uniform(0.9, 1.1))
    f = rng.choice([50, 60]); poles = rng.choice([2, 4, 6, 8, 12])
    zb = V ** 2 / (mpf(10) ** rng.uniform(3, 6.5))                     # base impedance of a 1 kW … 3 MW machine
    R1 = zb * mpf(rng.uniform(0.005, 0.06)); R2 = zb * mpf(rng.uniform(0.005, 0.08))
    Xl = zb * mpf(rng.uniform(0.08, 0.3)); X1 = Xl * mpf(rng.uniform(0.3, 0.6)); X2 = Xl - X1
    Xm = zb * mpf(rng.uniform(1.5, 5)); Rfe = zb * mpf(rng.uniform(20, 200))
    return V, f, poles, R1, X1, R2, X2, Xm, Rfe


def synth_tests(conn):
    V, f, poles, R1, X1, R2, X2, Xm, Rfe = rand_machine()
    flr = rng.choice([f, f / 4, mpf(15)])
    sc = flr / f
    Z1l, Zml, Z2l = mpc(R1, X1 * sc), 1 / (1 / Rfe + 1 / mpc(0, Xm * sc)), mpc(R2, X2 * sc)
    Vlr = V * mpf(rng.uniform(0.1, 0.25)); Vph = Vlr / sqrt(3) if conn == 'Y' else Vlr
    I1 = Vph / (Z1l + Zml * Z2l / (Zml + Z2l)); Plr = 3 * (Vph * I1.conjugate()).real
    Ilr = abs(I1) * (1 if conn == 'Y' else sqrt(3))
    Pfw = V ** 2 / (Xm * mpf(rng.uniform(40, 400)))
    s0 = mpf(rng.uniform(1e-4, 3e-3)); Vph0 = V / sqrt(3) if conn == 'Y' else V
    Zm = 1 / (1 / Rfe + 1 / mpc(0, Xm)); Z2 = mpc(R2 / s0, X2)
    I0 = Vph0 / (mpc(R1, X1) + Zm * Z2 / (Zm + Z2)); P0 = 3 * (Vph0 * I0.conjugate()).real + Pfw
    I0l = abs(I0) * (1 if conn == 'Y' else sqrt(3))
    t = {'conn': conn, 'model': rng.choice(['exact', 'approx']), 'cls': rng.choice(['AD', 'B', 'C']),
         'f': txt(f), 'R1': txt(R1), 'kR': rng.choice(['', '', txt(rng.uniform(1, 1.3), 4)]),
         'V0': txt(V), 'I0': txt(I0l), 'P0': txt(P0), 'Pfw': rng.choice(['', txt(Pfw)]),
         'Vlr': txt(Vlr), 'Ilr': txt(Ilr), 'Plr': txt(Plr), 'flr': '' if flr == f and rng.random() < 0.5 else txt(flr)}
    return t


def synth_op():
    V, f, poles, R1, X1, R2, X2, Xm, Rfe = rand_machine()
    conn = rng.choice(['Y', 'D']); Vph = V / sqrt(3) if conn == 'Y' else V
    t = {'conn': conn, 'model': rng.choice(['exact', 'approx']), 'V': txt(V), 'f': txt(f), 'poles': str(poles),
         'R1': txt(R1), 'X1': txt(X1), 'R2': txt(R2), 'X2': txt(X2), 'Xm': txt(Xm), 'Rfe': rng.choice(['', txt(Rfe)]),
         'Pfw': rng.choice(['', txt(Vph ** 2 / (Xm * mpf(rng.uniform(40, 400))))]), 's': '', 'n': '', 'Pout': '', 'Tl': '', 'tbl': ''}
    kind = rng.choice(['s', 's', 'n', 'Pout', 'Tl', 'none', 'edge'])
    ns = 120 * f / poles
    # nominal torque scale for choosing targets: 3·V²/(ω_s·R2) × s at 2 % slip
    Tn = 3 * Vph ** 2 * mpf('0.02') / (2 * pi * f / (poles / 2) * R2)
    if kind == 's': t['s'] = txt(rng.choice([rng.uniform(-0.3, 1.6), rng.uniform(0.001, 0.06)]))
    elif kind == 'n': t['n'] = txt(ns * (1 - mpf(rng.uniform(-0.2, 1.3))))
    elif kind == 'Pout': t['Pout'] = txt(Tn * 2 * pi * ns / 60 * mpf(rng.choice([rng.uniform(0.05, 1.5), rng.uniform(2, 20)])))
    elif kind == 'Tl': t['Tl'] = txt(Tn * mpf(rng.choice([rng.uniform(0.05, 1.5), rng.uniform(2, 20)])))
    elif kind == 'edge': t['s'] = rng.choice(['0', '1', '-1', '2'])
    if rng.random() < 0.25:
        t['tbl'] = ';'.join(txt(x, 4) for x in [rng.choice([0, 0.01, 0.03, 0.1, 0.5, 1, -0.05, 1.2]) for _ in range(rng.randint(1, 6))])
    return t


def pack(o):
    if o is None: return None
    r = {}
    for k, v in o.items():
        r[k] = [mp.nstr(v.real, 60), mp.nstr(v.imag, 60)] if isinstance(v, mpc) else mp.nstr(v, 60)
    return r


import sys
N_TEST, N_OP = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (600, 1400)
cases = []
# textbook cases (Chapman 4th ed., Ex. 6-3 / 6-5 and Ex. 6-8 test data)
chap = {'conn': 'Y', 'model': 'exact', 'V': '460', 'f': '60', 'poles': '4', 'R1': '0,641', 'X1': '1,106', 'R2': '0,332',
        'X2': '0,464', 'Xm': '26,3', 'Rfe': '', 'Pfw': '1100', 's': '0,022', 'n': '', 'Pout': '', 'Tl': '', 'tbl': ''}
cases.append(('imop', chap))
cases.append(('imtest', {'conn': 'Y', 'model': 'exact', 'cls': 'AD', 'f': '60', 'R1': '13,6/(2*28)', 'kR': '', 'V0': '208',
              'I0': '8,17', 'P0': '420', 'Pfw': '', 'Vlr': '25', 'Ilr': '27,9', 'Plr': '920', 'flr': '15'}))
for _ in range(N_TEST): cases.append(('imtest', synth_tests(rng.choice(['Y', 'D']))))
for _ in range(N_OP): cases.append(('imop', synth_op()))

out = []
for tid, t in cases:
    rt = {k: v for k, v in t.items()}
    if tid == 'imtest' and rt['R1'] == '13,6/(2*28)': rt['R1'] = mp.nstr(mpf('13.6') / 56, 70).replace('.', ',')
    r = ref_imtest(rt) if tid == 'imtest' else ref_imop(rt)
    out.append({'tool': tid, 'texts': t, 'ref': pack(r)})
json.dump(out, open('im_ref.json', 'w'), ensure_ascii=False)
print(len(out), 'cases;', sum(c['ref'] is not None for c in out), 'with results')
