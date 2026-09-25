import json, random, sys
sys.path.insert(0, '/home/claude/eecalc')
import engine as E, energy as N
rng = random.Random(7)
TEXTBOOK = {
 "power3": dict(V="400", I="100∠-36,87"), "current": dict(P="100k", Q="75k", V="400"),
 "pfc": dict(P="100k", pf1="0,7", pf2="0,95", V="400", f="50"), "pu": dict(S="100M", V="15k", Z="4,5+j9", I="1k"),
 "chbase": dict(z="0,1", Vo="15k", So="50M", Vn="15k", Sn="100M"),
 "vdrop": dict(R="0,1", X="0,08", P="200k", Q="100k", V="400"),
 "line": dict(z="0,05+j0,4", y="j3u", l="100", VR="220k", SR="100M+j20M"),
 "y2d": dict(Za="10", Zb="10", Zc="10"), "d2y": dict(Zab="5+j2", Zbc="7-j1", Zca="3+j4"),
 "seq": dict(Va="1∠0", Vb="0,9∠-115", Vc="1,05∠122"),
 "trafo": dict(Sn="1M", Vn="10k", uk="6", Pk="10k", i0="1", P0="1,5k"),
 "im": dict(f="50", poles="4", n="1450"), "sc": dict(Un="20k", Sk="500M", c="1,1", RX="0,1")}
VALS = ["", "0", "-1", "1e-60", "1e300", "400", "100∠-30", "j3u", "0,8", "1,1", "x", "(", "Z", "30°", "1/0", "4k7",
        "0,95", "2", "50", "15k", "3+j4", "1e6", "-j0,4", "6", "120"]
cases = [(tid, t) for tid, t in TEXTBOOK.items()]
for _ in range(1500):
    tool = rng.choice(N.TOOLS)
    cases.append((tool.id, {f.key: rng.choice(VALS) for f in tool.fields}))
out = []
for tid, texts in cases:
    eng = E.Engine(); eng.evaluate("Z = 3+j4")
    try:
        outs, rel = N.compute(eng, N.TOOL_BY_ID[tid], texts)
        res = {"ok": True, "reliable": rel,
               "e12": [[o.key, N.format_out(o, "deg", 12, "auto"), o.note] for o in outs],
               "s30": [N.format_out(o, "rad", 30, "sci") for o in outs]}
    except N.Incomplete as inc:
        res = {"ok": False, "incomplete": inc.labels}
    except E.CalcError as ex:
        res = {"ok": False, "msg": ex.msg}
    out.append({"tool": tid, "texts": texts, "py": res})
json.dump(out, open("/home/claude/webapp/tests/golden_energy.json", "w"), ensure_ascii=False)
print(len(out), "tool cases;", sum(c["py"]["ok"] for c in out), "with results")
