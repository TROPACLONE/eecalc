import json, copy, numpy as np
from pypower.api import runpf, rundcpf, ppoption, loadcase
from pypower.idx_bus import VM, VA
from pypower.idx_gen import PG, QG
from pypower.idx_brch import PF, QF, PT, QT
def variants():
    for name in ['case9', 'case14', 'case30']:
        yield name, name, loadcase(f'cases/{name}.m') if False else None
cases = {}
import re
def load_m(name):                      # same MATPOWER .m files the app imports
    txt = re.sub(r'%.*', '', open(f'cases/{name}.m').read())
    blk = lambda k: np.array([[float(x) for x in r.split()] for r in re.search(r'mpc\.' + k + r'\s*=\s*\[(.*?)\]\s*;', txt, re.S).group(1).replace(';', '\n').split('\n') if r.strip()])
    return {'version': '2', 'baseMVA': float(re.search(r'mpc\.baseMVA\s*=\s*([0-9.]+)', txt).group(1)), 'bus': blk('bus'), 'gen': blk('gen'), 'branch': blk('branch')}
base = {k: load_m(k) for k in ['case9', 'case14', 'case30']}
# variants: phase shifter + slack angle; tight Q limit forcing PV->PQ
v1 = copy.deepcopy(base['case9']); v1['branch'][0, 9] = 3.0; v1['bus'][0, 8] = 10.0
v2 = copy.deepcopy(base['case14']); v2['gen'][1, 3] = 20.0; v2['gen'][0, 3] = 999; v2['gen'][0, 4] = -999   # gen at bus 2 binds; slack free
out = {}
for key, ppc, qlim in [('case9', base['case9'], 0), ('case14', base['case14'], 0), ('case30', base['case30'], 0),
                       ('case9_shift', v1, 0), ('case14_qlim', v2, 1)]:
    opt = ppoption(VERBOSE=0, OUT_ALL=0, PF_TOL=1e-13, ENFORCE_Q_LIMS=qlim, PF_MAX_IT=30)
    r, ok = runpf(copy.deepcopy(ppc), opt)
    rd, okd = rundcpf(copy.deepcopy(ppc), ppoption(VERBOSE=0, OUT_ALL=0))
    out[key] = {'ok': bool(ok), 'vm': r['bus'][:, VM].tolist(), 'va': r['bus'][:, VA].tolist(),
                'pg': r['gen'][:, PG].tolist(), 'qg': r['gen'][:, QG].tolist(),
                'pf': r['branch'][:, PF].tolist(), 'qf': r['branch'][:, QF].tolist(), 'pt': r['branch'][:, PT].tolist(), 'qt': r['branch'][:, QT].tolist(),
                'dc_va': rd['bus'][:, VA].tolist(), 'dc_pf': rd['branch'][:, PF].tolist(), 'dc_pg': rd['gen'][:, PG].tolist(), 'qlim': qlim}
json.dump(out, open('pf_ref.json', 'w'))
print({k: v['ok'] for k, v in out.items()})
