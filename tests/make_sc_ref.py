"""Independent short-circuit reference: dense sequence Ybus, Zbus = inv(Ybus), textbook fault formulas."""
import json, re, copy, numpy as np
from pypower.api import runpf, ppoption
exec(open('make_pf_ref.py').read().split("base = {k:")[0].split("import re")[1].join(["import re", ""]) if False else "")
def load_m(name):
    txt = re.sub(r'%.*', '', open(f'cases/{name}.m').read())
    blk = lambda k: np.array([[float(x) for x in r.split()] for r in re.search(r'mpc\.' + k + r'\s*=\s*\[(.*?)\]\s*;', txt, re.S).group(1).replace(';', '\n').split('\n') if r.strip()])
    return {'version': '2', 'baseMVA': float(re.search(r'mpc\.baseMVA\s*=\s*([0-9.]+)', txt).group(1)), 'bus': blk('bus'), 'gen': blk('gen'), 'branch': blk('branch')}
ppc = load_m('case9'); n = 9
GEN = {1: dict(x1=0.0608, x2=0.0608, x0=0.03, xn=0.0, gnd=True), 2: dict(x1=0.1198, x2=0.13, x0=0.05, xn=0.02, gnd=True),
       3: dict(x1=0.1813, x2=0.19, x0=0.08, xn=0.0, gnd=False)}
CONN = {(1, 4): 'Dyn', (3, 6): 'YNd', (8, 2): 'YNyn'}              # other branches: lines
def seqY(seq, Vpre=None, full=False):
    Y = np.zeros((n, n), complex)
    for br in ppc['branch']:
        f, t = int(br[0]) - 1, int(br[1]) - 1
        r, x, b = br[2], br[3], br[4]
        conn = CONN.get((f + 1, t + 1), 'line')
        if seq == 0:
            if conn in ('line', 'YNyn'):
                z0 = complex(3 * r, 3 * x); y = 1 / z0
                Y[f, f] += y; Y[t, t] += y; Y[f, t] -= y; Y[t, f] -= y
                if conn == 'line': Y[f, f] += 1j * 0.6 * b / 2; Y[t, t] += 1j * 0.6 * b / 2
            elif conn == 'YNd': Y[f, f] += 1 / complex(3 * r, 3 * x)
            elif conn == 'Dyn': Y[t, t] += 1 / complex(3 * r, 3 * x)
            continue
        y = 1 / complex(r, x)
        Y[f, f] += y; Y[t, t] += y; Y[f, t] -= y; Y[t, f] -= y
        if full: Y[f, f] += 1j * b / 2; Y[t, t] += 1j * b / 2
    if full and seq != 0:                       # loads (and bus shunts) in positive and negative sequence only
        for k, bus in enumerate(ppc['bus']):
            Y[k, k] += complex(bus[4], bus[5]) / 100
            if bus[2] or bus[3]: Y[k, k] += complex(bus[2], -bus[3]) / 100 / abs(Vpre[k]) ** 2
    for bnum, g in GEN.items():
        k = bnum - 1
        if seq == 1: Y[k, k] += 1 / (1j * g['x1'])
        if seq == 2: Y[k, k] += 1 / (1j * g['x2'])
        if seq == 0 and g['gnd']: Y[k, k] += 1 / (1j * (g['x0'] + 3 * g['xn']))
    return Y
a = np.exp(2j * np.pi / 3); A = np.array([[1, 1, 1], [1, a * a, a], [1, a, a * a]])
def fault(kind, k, zf, Vpre, full):
    Z1 = np.linalg.inv(seqY(1, Vpre, full)); Z2 = np.linalg.inv(seqY(2, Vpre, full)); Z0 = np.linalg.inv(seqY(0, Vpre, full))
    Vf = Vpre[k]
    if kind == '3ph': I1 = Vf / (Z1[k, k] + zf); I2 = I0 = 0
    elif kind == 'slg': I1 = I2 = I0 = Vf / (Z0[k, k] + Z1[k, k] + Z2[k, k] + 3 * zf)
    elif kind == 'll': I1 = Vf / (Z1[k, k] + Z2[k, k] + zf); I2 = -I1; I0 = 0
    else:
        z03 = Z0[k, k] + 3 * zf; I1 = Vf / (Z1[k, k] + Z2[k, k] * z03 / (Z2[k, k] + z03)); I2 = -I1 * z03 / (z03 + Z2[k, k]); I0 = -I1 * Z2[k, k] / (z03 + Z2[k, k])
    Iabc = A @ np.array([I0, I1, I2])
    V1 = Vpre - Z1[:, k] * I1; V2 = -Z2[:, k] * I2; V0 = -Z0[:, k] * I0
    Vabc = (A @ np.vstack([V0, V1, V2])).T
    return {'Iabc': [abs(x) for x in Iabc], 'seq': [abs(I0), abs(I1), abs(I2)], 'V': np.abs(Vabc).tolist()}
r, ok = runpf(copy.deepcopy(ppc), ppoption(VERBOSE=0, OUT_ALL=0, PF_TOL=1e-13))
Vpf = r['bus'][:, 7] * np.exp(1j * np.radians(r['bus'][:, 8]))
out = []
for pre in ('flat', 'pf'):
    Vpre = np.ones(n, complex) if pre == 'flat' else Vpf
    for kind in ('3ph', 'slg', 'll', 'llg'):
        for bus, zf in ((5, 0), (4, 0.05j), (7, 0.02 + 0.03j)):
            out.append({'pre': pre, 'kind': kind, 'bus': bus, 'zf': [zf.real, zf.imag], **fault(kind, bus - 1, zf, Vpre, pre == 'pf')})
json.dump({'gen': GEN, 'conn': [[f, t, c] for (f, t), c in CONN.items()], 'faults': out}, open('sc_ref.json', 'w'))
print(len(out), 'reference faults')
