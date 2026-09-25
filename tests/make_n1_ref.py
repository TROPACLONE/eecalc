import json, copy, re, numpy as np
from pypower.api import runpf, ppoption
exec(re.search(r"def load_m.*?\n(?=base = )", open('make_pf_ref.py').read(), re.S).group(0))
base = load_m('case14'); out = {}
for kind, row in [('branch', 0), ('branch', 5), ('branch', 10), ('gen', 3)]:
    p = copy.deepcopy(base)
    if kind == 'branch': p['branch'][row, 10] = 0
    else: p['gen'][row, 7] = 0
    r, ok = runpf(p, ppoption(VERBOSE=0, OUT_ALL=0, PF_TOL=1e-13))
    out[f'{kind}{row}'] = {'ok': bool(ok), 'vm': r['bus'][:, 7].tolist(), 'va': r['bus'][:, 8].tolist()}
json.dump(out, open('n1_ref.json', 'w')); print(list(out))
