"""Reference results from the Python engine (the validated original) for the JS port to reproduce."""
import json, random, sys
sys.path.insert(0, '/home/claude/eecalc')
import engine as E

SETUP = ["Z = 3+j4", "M = [1|2;3|4]", "Y = [2-j5 | -1+j2 ; -1+j2 | 3-j6]", "Im = 2", "th = 30°", "V = 400"]
HAND = """34,5 fase(98º) - 63 fase(3 rad)|34,5∠98 - 63∠3rad|34,5<98° - 63@3 rad|cos(90)|sin(180°)|cos(270°)|sin(360)
|cos(60)|10∠90|10∠-90|5∠180|1∠30 * 1∠-30|1+a+a²|a^3|exp(j pi)|sqrt(-4)|0,1+0,2|1/3*3|sqrt(2)^2|(1+j)(1-j)|√3²
|4,7k|4k7|2M2|100n|10µ|1,5e-3k|3+j4|-j0,5|4j|j4|2 ^ 3 ^ 2|-2^2|2^-2|1/2π|2(3+1)|10 // 10|par(10;10;10)
|4,7k // 10k|zbase(15k;100M)|chbase(0,1;15k;50M;15k;100M)|ibase(15k;100M)|zl(50;100m)|zc(50;10u)|db20(0,1)
|db10(100)|log(1000)|log(8;2)|ln(e)|root(-8;3)|round(pi;3)|round(2,5)|round(-2,5)|round(2,675;2)|round(1234;-2)
|abs(3+j4)|re(3+j4)|im(3+j4)|conj(3+j4)|pf(1∠60)|rect(3;4)|polar(2;90)|1/(mu0*c0^2)|ang(3+j4)|ang(-1)|30° + 15
|atan2(1;1)|asin(0,5)|asin(2)|asin(-2)|acos(2)|acos(-2)|acosh(0,5)|acosh(-2)|atanh(2)|atanh(-2)|atanh(0,5)
|asinh(2)|atan(3)|sin(pi)|cos(1+j)|sin(2-j3)|tan(1+j)|sinh(1+j)|cosh(0,1+j0,5)|tanh(j)|asin(1+j)|acos(1-j)
|atan(2+j)|asinh(1+j)|acosh(1+j)|atanh(0,5+j)|ln(-1)|ln(3+j4)|exp(1+j)|(1+j)^0,5|(-8)^(1/3)|j^2|(1+j)^10
|2^0,5|10^-3|log2(8)|log10(-100)|sqrt(3+j4)|sqrt(-3-j4)|seq(1∠0; 1∠-120; 1∠120)|seq(1∠0; 1∠120; 1∠-120)
|abc(0;1;0)|abc(seq(10∠5; 7∠-100; 12∠130))|inv(Y)|det(Y)|Y\\[1;0]|Y(1;2)|Y*[1;1]|inv(Y)*Y|M^2|M^-1|transp(M)
|herm(Y)|eye(3)|diag(1;2;3)|Y(1)|zeros(2;3)|solve(Y;[1;2])|M*M-M^2|[1/3|-j/7;1∠45|1e-20]|Z1 = 3 + j4|Z // 10∠-30
|jZ|jIm|Im*2|Z²|th*2|10∠th|sin(th)|round(ang(3+j4);2)|abs(-30°)|(1+1e-60)-1|1/((1+1e-60)-1)|ln((1+1e-55)-1)
|sin(10^60)|(1e30+1)-1e30|sin(10^100)|s3(400; 100∠-36,87)|i3(s3(400; 100∠-36,87); 400)|s1(230;10∠-20)
|y2d(10;10;10)|d2y(30;30;30)|d2y(y2d(1;2;3))|y2d(5+j2;7-j1;3+j4)|omega(50)|1/0|tan(90)|10∠30∠20|a = 5
|sin 30|[1|2;3]|3,,|fasee(3)|1 000|Sin(30)|inv([1|2;2|4])|[1|2;2|4]\\[1;1]|zeros(1e9)|eye(0)|eye(31)
|1e1000000000000000|round(1;99)|eye(2,5)|10^10^10^10|exp(10^10^10)|cos(10^600)|(((((1|1)|2^[1|2]
|[1|2]+[1;2]|[1|2]*[1|2]|ln(0)|db20(0)|10∠(1+j)|30 rad °|j = 1|sin = 2|()|[]|Y(3;1)|3 +|x|* 2|ans
|1e-300*1e-300|1e300*1e300|999999,99999|0,125|1,005|-2,5|2,5|123456789,123456789|1e15|1e-15|0,0000123""".replace("\n", "").split("|")

rng = random.Random(2026)
def atom():
    k = rng.random(); x = f"{rng.uniform(0.01, 999):.{rng.randint(0,4)}f}".replace(".", ",")
    if k < 0.25: return x
    if k < 0.45: return f"{x}∠{rng.randint(-360, 360)}"
    if k < 0.6: return f"({x}+j{rng.randint(1, 99)})"
    if k < 0.7: return f"{x} fase({rng.uniform(-3, 3):.3f} rad)".replace(".", ",")
    if k < 0.8: return rng.choice(["Z", "Im", "V", "th", "pi", "a", "e", "j"])
    if k < 0.9: return f"{rng.choice(['sqrt','exp','ln','sin','cos','abs','conj','ang','sinh','atan','cosh','log','asin','acos','tanh'])}({x})"
    return rng.choice(["4k7", "2M2", "10µ", "100n", "1e-3", "3,3k"])
def expr(d=0):
    if d > 2 or rng.random() < 0.3: return atom()
    return f"({expr(d+1)} {rng.choice(['+','-','*','/','//','^'])} {expr(d+1)})" if rng.random() < 0.9 else f"{rng.choice(['par','s3','log','root','atan2'])}({expr(d+1)};{expr(d+1)})"
STRUCT = [expr() for _ in range(2500)]
TOK = ["1", "2,5", "0", "1e-60", "4k7", "10µ", "j", "j4", "3+j4", "∠", "<", "°", "rad", "(", ")", "[", "]", ";", "|",
       "+", "-", "*", "/", "//", "\\", "^", "²", "√", "pi", "a", "e", "ans", "Z", "M", "=", "sin(", "cos(", "tan(",
       "ln(", "log(", "sqrt(", "abs(", "ang(", "inv(", "det(", "seq(", "abc(", "s3(", "i3(", "y2d(", "par(",
       "round(", "root(", "exp(", "atan2(", "eye(", "zeros(", "fase(", "zc(", "chbase(", "10^", "1e308", ",", " ", "@", "x"]
SOUP = ["".join(rng.choice(TOK) for _ in range(rng.randint(1, 9))) for _ in range(2500)]

def run(text, unit):
    eng = E.Engine(); eng.angle_unit = unit
    for s in SETUP: eng.evaluate(s)
    eng.evaluate("7∠10")                                   # ans
    try:
        r = eng.evaluate(text)
        v = r.value
        return {"ok": True, "reliable": r.reliable,
                "f12": [t for t, _ in E.format_value(v, unit, 12, "auto")],
                "e12": [t for t, _ in E.format_value(v, unit, 12, "eng")],
                "s30": [t for t, _ in E.format_value(v, unit, 30, "sci")],
                "full": E.full_precision(v, unit, r.reliable)}
    except E.CalcError as ex:
        return {"ok": False, "msg": ex.msg}

cases = []
for group, lst in (("hand", HAND), ("struct", STRUCT), ("soup", SOUP)):
    for t in lst:
        for unit in (("deg", "rad") if group != "soup" else ("deg",)):
            cases.append({"group": group, "text": t, "unit": unit, "py": run(t, unit)})
json.dump({"setup": SETUP, "cases": cases}, open("/home/claude/webapp/tests/golden.json", "w"), ensure_ascii=False)
print(len(cases), "reference cases;", sum(c["py"]["ok"] for c in cases), "with values,",
      sum(not c["py"]["ok"] for c in cases), "errors")
