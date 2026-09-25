/* EE Calc — Network screens: case editor, power flow, short circuit, N-1 contingency. */
import * as E from './engine.js';
import * as NW from './network.js';
import { EXAMPLES } from './examples.js';
import { h, Editor, activate, activeEditor, onTap, sheet, toast, copy, segmented, saveFile, openFile } from './ui.js';
import { icon } from './icons.js';

const TABLE_DIGITS = [4, 6, 8, 10, 12];
const PF_METHODS = [['nr', 'Newton'], ['fd', 'Fast dec.'], ['gs', 'Gauss-S.'], ['dc', 'DC']];
const FAULTS = [['3ph', '3φ'], ['slg', 'SLG'], ['ll', 'LL'], ['llg', 'LLG']];

export function init(ctx, root) {
  const { eng } = ctx;
  let kase = NW.fromMatpower(EXAMPLES.case9.text, EXAMPLES.case9.title);   // starts with an example, unsaved
  let dirty = false, tab = 'buses', current = 'case', digits = 6;
  let cell = null;                                  // cell being edited: {table, row, key, td, ed}
  const pf = { method: 'nr', qlim: true, start: 'flat', res: null, title: '', tab: 'summary', err: null, busy: false };
  const sc = { bus: null, type: '3ph', zf: '0', prefault: 'flat', res: null, err: null };
  const n1 = { res: null, running: false, cancel: false, done: 0, total: 0, branches: true, gens: true, run: 0, snapshot: null, qlim: false };
  const dropN1 = () => { n1.res = null; n1.snapshot = null; n1.eng = null; if (n1.running) { n1.running = false; n1.run++; } };   // results no longer match the case
  let zfEd = null;

  const scroll = h('div', 'scroll nscroll'), bar = h('div', 'celledit');
  bar.hidden = true;
  root.replaceChildren(scroll, bar);
  const num = x => (x == null ? '' : E.fmtReal(x, digits));
  const cplx = z => E.formatValue(z, 'deg', digits, 'auto').map(l => l[0]);

  // ═══════════════════════════════════════════════ helpers
  function compileCase() {
    try { return { model: NW.compile(kase, eng) }; }
    catch (ex) { return { issues: ex.issues || [ex.msg || String(ex)] }; }
  }
  function issuesBox(issues) {
    const b = h('div', 'issues');
    b.appendChild(h('b', null, 'Fix the case first:'));
    issues.slice(0, 12).forEach(t => b.appendChild(h('div', null, '• ' + t)));
    if (issues.length > 12) b.appendChild(h('div', null, `…and ${issues.length - 12} more`));
    return b;
  }
  function button(label, fn, cls = '', ic = null) {
    const b = h('button', 'btn ' + cls); if (ic) b.appendChild(icon(ic)); b.appendChild(h('span', null, label));
    b.addEventListener('click', fn); return b;
  }
  function chip(label, fn) { const b = h('button', 'chip', label); b.addEventListener('click', fn); return b; }
  function valueSheet(title, value, varName) {
    const full = E.fullPrecision(value, 'deg');
    sheet(title, [
      varName && [`Use in calculator as ${varName}`, () => ctx.useValue(varName, value)],
      ['Copy', () => copy(E.formatValue(value, 'deg', digits, 'auto')[0][0])],
      ['Copy full precision', () => copy(full)],
    ], box => box.appendChild(h('div', 'fullval', full)));
  }
  /** Table from rows of cells; a cell is text, or {t, v (value for the detail sheet), name, cls}. */
  function table(cols, rows, onRow) {
    const wrap = h('div', 'tw'), t = h('table', 'grid'), tr = h('tr');
    cols.forEach(c => tr.appendChild(h('th', null, c)));
    const thead = h('thead'); thead.appendChild(tr);
    const tb = h('tbody');
    rows.forEach((r, i) => {
      const row = h('tr'); row.dataset.i = i;
      r.forEach((c, j) => {
        const td = h('td', c && c.cls, c && typeof c === 'object' ? c.t : c);
        td.dataset.j = j;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.append(thead, tb); wrap.appendChild(t);
    onTap(tb, target => {
      const td = target.closest('td'); if (!td) return;
      const i = +td.parentElement.dataset.i, j = +td.dataset.j, c = rows[i][j];
      if (onRow) onRow(i, j, td);
      else if (c && typeof c === 'object' && c.v != null) valueSheet(`${cols[0]} ${rows[i][0].t ?? rows[i][0]} · ${cols[j]}`, c.v, c.name);
    });
    return wrap;
  }

  // ═══════════════════════════════════════════════ case editor
  let shownTab = null;
  function renderCase() {
    // a re-render (after an edit) keeps where the user was in the table and on the page
    const tw0 = scroll.querySelector('.tw'), keep = tw0 && shownTab === tab ? [tw0.scrollTop, tw0.scrollLeft, scroll.scrollTop] : null;
    shownTab = tab;
    const top = h('div', 'nhead');
    const name = h('button', 'casename', kase.name);
    name.addEventListener('click', () => { const v = prompt('Case name', kase.name); if (v && v.trim()) { kase.name = v.trim().slice(0, 60); dirty = true; renderCase(); } });
    const badge = h('span', dirty ? 'badge warn' : 'badge', dirty ? 'Not saved' : 'Saved to file');
    if (!dirty && !kase._fromFile) badge.textContent = 'Example';
    top.append(name, badge);
    const btns = h('div', 'btnrow');
    btns.append(button('New', () => discard(() => setCase(starter(), false)), '', 'filenew'), button('Examples', examples, '', 'book'),
      button('Open', openCase, '', 'folder'), button('Save', saveCase, 'accent', 'save'));
    const info = h('div', 'caseinfo');
    const act = kase.buses.filter(b => b.type !== 'Off').length;
    info.append(h('span', null, `${act} buses · ${kase.gens.length} generators · ${kase.branches.length} branches · base `));
    const base = h('button', 'link', `${kase.base} MVA`); base.addEventListener('click', () => editCell('base', 0, 'base', base));
    info.appendChild(base);
    const tabs = segmented([['buses', `Buses ${kase.buses.length}`], ['gens', `Generators ${kase.gens.length}`], ['branches', `Branches ${kase.branches.length}`]],
      tab, v => { commitCell(); tab = v; renderCase(); });
    const cols = NW.COLUMNS[tab];
    const rows = kase[tab].map(r => cols.map(c => {
      const v = r[c.key];
      if (c.type === 'bool') return { t: v === '1' ? '✓' : '—', cls: v === '1' ? 'on' : 'off' };
      return { t: v === '' || v == null ? '' : String(v), cls: c.type === 'num' || c.type === 'int' ? 'n' : '' };
    }));
    const grid = table(cols.map(c => c.label), rows, (i, j, td) => cellTap(i, cols[j], td));
    onTap(grid.querySelector('tbody'), () => {}, target => {
      const tr = target.closest('tr'); if (!tr) return;
      if (!commitCell()) return;                           // the open cell first: its row index must still be right
      const i = +tr.dataset.i;
      sheet(`${NW.TABLE_TITLES[tab]} row ${i + 1}`, [
        ['Insert a row below', () => { kase[tab].splice(i + 1, 0, NW.blankRow(tab, kase)); changed(); }],
        ['Duplicate row', () => { kase[tab].splice(i + 1, 0, { ...kase[tab][i], ...(tab === 'buses' ? { num: NW.blankRow('buses', kase).num } : {}) }); changed(); }],
        ['Delete row', () => { kase[tab].splice(i, 1); changed(); }, 'danger'],
      ]);
    });
    const add = button(`Add ${tab === 'buses' ? 'bus' : tab === 'gens' ? 'generator' : 'branch'}`, () => { commitCell(); kase[tab].push(NW.blankRow(tab, kase)); changed(); requestAnimationFrame(() => { const tw = scroll.querySelector('.tw'); if (tw) tw.scrollTop = tw.scrollHeight; }); }, 'wide2', 'plus');
    const hint = h('div', 'mini', 'Tap a cell to edit · touch and hold a row for more · long values scroll sideways');
    scroll.replaceChildren(top, btns, info, tabs, grid, add, hint);
    scroll.classList.add('casemode');
    if (keep) { grid.scrollTop = keep[0]; grid.scrollLeft = keep[1]; scroll.scrollTop = keep[2]; }
  }
  function changed() { dirty = true; pf.res = null; sc.res = null; dropN1(); renderCase(); }
  function starter() {
    const c = NW.newCase('New case');
    c.buses.push(Object.assign(NW.blankRow('buses', c), { num: '1', type: 'Slack', kv: '20', pd: '0', qd: '0' }));
    c.buses.push(Object.assign(NW.blankRow('buses', c), { num: '2', type: 'PQ', kv: '20', pd: '50', qd: '20' }));
    c.gens.push(Object.assign(NW.blankRow('gens', c), { bus: '1', pg: '0', vg: '1' }));
    c.branches.push(Object.assign(NW.blankRow('branches', c), { from: '1', to: '2', r: '0.01', x: '0.1', b: '0.02' }));
    return c;
  }
  function setCase(c, fromFile) { commitCell(); kase = c; kase._fromFile = fromFile; dirty = !fromFile && c.name === 'New case'; pf.res = null; sc.res = null; dropN1(); sc.bus = null; renderCase(); }
  function discard(then) {
    if (!dirty) { then(); return; }
    sheet('This case has unsaved changes', [['Discard changes', then, 'danger'], ['Save first', () => saveCase().then(ok => { if (ok) then(); })]]);
  }
  function examples() {
    sheet('Example cases (MATPOWER)', Object.values(EXAMPLES).map(ex => [ex.title, () => discard(() => setCase(NW.fromMatpower(ex.text, ex.title), false))]));
  }
  async function openCase() {
    discard(async () => {
      const f = await openFile('.json,.m,.txt,application/json,text/plain');
      if (!f) return;
      try { const c = NW.fromFile(f.text, f.name.replace(/\.(json|m|txt)$/i, '')); setCase(c, true); toast(`Opened ${c.name}`); }
      catch (ex) { toast(ex.msg || 'This file is not a case'); }
    });
  }
  /** -> true once the case is saved (false if the user cancelled or the save failed). */
  async function saveCase() {
    if (!commitCell()) return false;
    const clean = JSON.parse(JSON.stringify(kase)); delete clean._fromFile;
    const fname = (kase.name.replace(/[^\w\- .]+/g, '').trim() || 'case').slice(0, 40) + '.eecase.json';
    const ok = await saveFile(fname, NW.toFile(clean));
    if (ok) { dirty = false; kase._fromFile = true; toast('Saved'); if (current === 'case') renderCase(); }
    return !!ok;
  }
  function cellTap(i, col, td) {
    const row = kase[tab][i];
    if (col.type === 'bool') { commitCell(); row[col.key] = row[col.key] === '1' ? '0' : '1'; changed(); return; }
    if (col.type === 'enum') {
      commitCell();
      sheet(`${col.label}`, col.opts.map(o => [o + (row[col.key] === o ? '  ✓' : ''), () => { row[col.key] = o; changed(); }]));
      return;
    }
    editCell(tab, i, col.key, td);
  }
  function editCell(table, row, key, td) {
    commitCell();
    const col = table === 'base' ? { label: 'System base MVA', type: 'num' } : NW.COLUMNS[table].find(c => c.key === key);
    const text = table === 'base' ? kase.base : String(kase[table][row][key] ?? '');
    const label = table === 'base' ? col.label : `${{ buses: 'Bus', gens: 'Generator', branches: 'Branch' }[table]} row ${row + 1} · ${col.label}`;
    bar.replaceChildren();
    const lab = h('div', 'celllabel', label), edEl = h('div', 'cellval');
    const ok = h('button', 'cellbtn', '✓'), no = h('button', 'cellbtn muted', '✕');
    ok.addEventListener('click', () => commitCell()); no.addEventListener('click', () => cancelCell());
    const rowEl = h('div', 'cellrow'); rowEl.append(edEl, ok, no);
    bar.append(lab, rowEl); bar.hidden = false;
    const ed = new Editor(edEl, null);
    ed.set(text);
    cell = { table, row, key, td, ed, col, orig: text.trim() };
    if (td) { scroll.querySelectorAll('td.editing').forEach(x => x.classList.remove('editing')); td.classList.add('editing'); }
    activate(ed);
    ctx.updatePad();
  }
  function commitCell(moveDown) {
    if (!cell) return true;
    const { table, row, key, ed, col } = cell, text = ed.text.trim();
    if (text === cell.orig) {                              // nothing changed: not an edit (results and N-1 stay)
      if (cell.td) cell.td.classList.remove('editing');
      const next = moveDown && table !== 'base' && row + 1 < kase[table].length ? row + 1 : null;
      closeCell();
      if (next !== null) openBelow(table, next, key);
      return true;
    }
    if (text && col.type !== 'text') {
      try { if (col.type === 'int' && !/^-?\d+$/.test(text)) throw new E.CalcError('Must be a whole number'); E.parse(text); }
      catch (ex) { toast(ex.msg || 'Not a valid number'); return false; }
    }
    if (table === 'base') { if (text) kase.base = text; }
    else kase[table][row][key] = text;
    dirty = true; pf.res = null; sc.res = null; dropN1();
    const next = moveDown && table !== 'base' && row + 1 < kase[table].length ? row + 1 : null;
    closeCell();
    if (current === 'case') renderCase();
    if (next !== null) openBelow(table, next, key);
    return true;
  }
  function openBelow(table, row, key) {                    // Enter moves on to the same column in the next row
    const colIdx = NW.COLUMNS[table].findIndex(c => c.key === key);
    const td = scroll.querySelector(`tr[data-i="${row}"] td[data-j="${colIdx}"]`);
    editCell(table, row, key, td);
    if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function cancelCell() { closeCell(); if (current === 'case') renderCase(); }
  function closeCell() {
    const ed = cell && cell.ed;
    cell = null; bar.hidden = true; bar.replaceChildren();
    if (ed && activeEditor() === ed) activate(null);         // only its own editor: the calculator's may be active already
    ctx.updatePad();
  }

  // ═══════════════════════════════════════════════ power flow
  function renderPF() {
    const opts = h('div', 'opts');
    opts.appendChild(segmented(PF_METHODS, pf.method, v => { pf.method = v; }));
    const row = h('div', 'btnrow');
    row.append(chip(`Q limits: ${pf.qlim ? 'on' : 'off'}`, () => { pf.qlim = !pf.qlim; renderPF(); }),
      chip(`Start: ${pf.start === 'flat' ? 'flat' : 'from case'}`, () => { pf.start = pf.start === 'flat' ? 'case' : 'flat'; renderPF(); }),
      chip(`${digits} digits`, () => { digits = TABLE_DIGITS[(TABLE_DIGITS.indexOf(digits) + 1) % TABLE_DIGITS.length]; renderPF(); }));
    opts.appendChild(row);
    const solve = button(pf.busy ? 'Solving…' : `Solve ${kase.name}`, runPF, 'accent big');
    const parts = [h('div', 'mini', 'Case: ' + kase.name + (dirty ? ' (not saved)' : '')), opts, solve];
    if (pf.err) parts.push(pf.err);
    if (pf.res) parts.push(...pfResults());
    scroll.replaceChildren(...parts);
    scroll.classList.remove('casemode');
  }
  function runPF() {
    if (pf.busy) return;
    const c = compileCase();
    if (c.issues) { pf.err = issuesBox(c.issues); pf.res = null; renderPF(); return; }
    pf.busy = true; pf.err = null; renderPF();
    setTimeout(() => {
      try { pf.res = NW.powerFlow(c.model, { method: pf.method, qlim: pf.qlim, start: pf.start }); pf.res.model = c.model; pf.title = 'Base case'; pf.tab = 'summary'; }
      catch (ex) { pf.res = null; pf.err = h('div', 'issues', ex.msg || String(ex)); }
      pf.busy = false;
      if (current === 'pf') renderPF();
    }, 30);
  }
  function pfResults() {
    const r = pf.res, out = [];
    const status = r.method === 'dc' ? 'DC power flow (linear, lossless)'
      : `${NW.methodName(r.method)}: converged in ${r.iterations} iteration${r.iterations === 1 ? '' : 's'}`;
    out.push(h('div', 'status ok', `${pf.title} · ${status} · ${r.reliable ? `≈ ${r.reliable} digits verified` : 'verified (42 digits)'}`));
    const tabs = r.method === 'dc' ? [['summary', 'Summary'], ['buses', 'Buses'], ['branches', 'Branches']]
      : [['summary', 'Summary'], ['buses', 'Buses'], ['branches', 'Branches'], ['gens', 'Generators'], ['iter', 'Iterations']];
    out.push(segmented(tabs, pf.tab, v => { pf.tab = v; renderPF(); }));
    if (pf.tab === 'summary') {
      const kv = h('div', 'kv');
      const line = (k, v) => { kv.append(h('div', 'kk', k), h('div', 'vv', v)); };
      if (r.method === 'dc') {
        const s = r.bus.find(b => b.type === 'Slack');
        line('Slack generation', `${num(s.pg)} MW (bus ${s.n})`);
      } else {
        const t = r.totals;
        line('Generation', `${num(t.pg)} MW   ${num(t.qg)} Mvar`);
        line('Load', `${num(t.pd)} MW   ${num(t.qd)} Mvar`);
        line('Losses', `${num(t.pl)} MW   ${num(t.ql)} Mvar`);
        const vmin = r.bus.reduce((a, b) => (b.vm.lt(a.vm) ? b : a)), vmax = r.bus.reduce((a, b) => (b.vm.gt(a.vm) ? b : a));
        line('Lowest voltage', `${num(vmin.vm)} pu at bus ${vmin.n}`);
        line('Highest voltage', `${num(vmax.vm)} pu at bus ${vmax.n}`);
      }
      out.push(kv);
      const vio = [];
      for (const b of r.bus) if (b.vio) vio.push(`Bus ${b.n}: V = ${num(b.vm)} pu (${b.vio === 'low' ? 'below Vmin' : 'above Vmax'})`);
      for (const b of r.branches) if (b.over) vio.push(`Branch ${b.f}–${b.t}: ${num(b.loading)} % of rating`);
      for (const s of r.switched || []) vio.push(`Bus ${s.bus}: generator Q at its ${s.dir === 'max' ? 'upper' : 'lower'} limit → PQ`);
      for (const g of r.gens || []) if (g.atLimit === 'above' || g.atLimit === 'below') vio.push(`Generator at bus ${g.bus}: Q = ${num(g.q)} Mvar, ${g.atLimit} its limit`);
      for (const w of r.warnings || []) vio.push(w);
      const vb = h('div', vio.length ? 'issues warnbox' : 'mini');
      if (vio.length) { vb.appendChild(h('b', null, 'Limits and notes')); vio.forEach(t => vb.appendChild(h('div', null, '• ' + t))); }
      else vb.textContent = 'No voltage or loading violations.';
      out.push(vb);
      if (r.method !== 'dc') out.push(button('Send Vbus and Ybus to the calculator', () => sendToCalc(r), 'wide2'));
    } else if (pf.tab === 'buses') {
      if (r.method === 'dc') out.push(table(['Bus', 'Type', 'θ °', 'Pg MW', 'Pd MW'], r.bus.map(b => [
        { t: String(b.n) }, b.type, { t: num(b.va), v: b.va, cls: 'n' }, { t: num(b.pg), v: b.pg, cls: 'n' }, { t: num(b.pd), v: b.pd, cls: 'n' }])));
      else out.push(table(['Bus', 'Type', 'V pu', 'θ °', 'V kV', 'Pg MW', 'Qg Mvar', 'Pd MW', 'Qd Mvar'], r.bus.map((b, k) => {
        const V = r.V[k], cls = 'n' + (b.vio ? ' bad' : '');
        return [{ t: String(b.n) }, b.type, { t: num(b.vm), v: V, name: `V${b.n}`, cls }, { t: num(b.va), v: V, name: `V${b.n}`, cls: 'n' },
          { t: b.kv && !b.kv.isZero() ? num(b.kv) : '', v: b.kv, cls: 'n' }, { t: b.hasGen || b.type === 'Slack' ? num(b.pg) : '', v: b.pg, cls: 'n' },
          { t: b.hasGen || b.type === 'Slack' ? num(b.qg) : '', v: b.qg, cls: 'n' }, { t: num(b.pd), v: b.pd, cls: 'n' }, { t: num(b.qd), v: b.qd, cls: 'n' }];
      })));
    } else if (pf.tab === 'branches') {
      if (r.method === 'dc') out.push(table(['From', 'To', 'P MW', 'Loading %'], r.branches.map(b => [
        { t: String(b.f) }, String(b.t), { t: num(b.pf), v: b.pf, cls: 'n' }, { t: b.loading ? num(b.loading) : '', v: b.loading, cls: 'n' + (b.over ? ' bad' : '') }])));
      else out.push(table(['From', 'To', 'P from MW', 'Q from Mvar', 'P to MW', 'Q to Mvar', 'Loss MW', 'Loss Mvar', 'Loading %'], r.branches.map(b => {
        const Sf = E.norm(new E.Cx(b.pf, b.qf));
        return [{ t: String(b.f) }, String(b.t), { t: num(b.pf), v: Sf, name: `S${b.f}_${b.t}`, cls: 'n' }, { t: num(b.qf), v: Sf, name: `S${b.f}_${b.t}`, cls: 'n' },
          { t: num(b.pt), v: b.pt, cls: 'n' }, { t: num(b.qt), v: b.qt, cls: 'n' }, { t: num(b.pl), v: b.pl, cls: 'n' }, { t: num(b.ql), v: b.ql, cls: 'n' },
          { t: b.loading ? num(b.loading) : '', v: b.loading, cls: 'n' + (b.over ? ' bad' : '') }];
      })));
    } else if (pf.tab === 'gens') {
      out.push(table(['Bus', 'P MW', 'Q Mvar', 'Qmin', 'Qmax', 'Limit'], r.gens.map(g => [
        { t: String(g.bus) }, { t: num(g.p), v: g.p, cls: 'n' }, { t: num(g.q), v: g.q, cls: 'n' + (g.atLimit === 'above' || g.atLimit === 'below' ? ' bad' : '') },
        { t: g.qmin ? num(g.qmin) : '', cls: 'n' }, { t: g.qmax ? num(g.qmax) : '', cls: 'n' },
        g.atLimit === 'limit' ? 'at limit (PQ)' : g.atLimit ? `${g.atLimit} limit` : ''])));
    } else if (pf.tab === 'iter') {
      const log = r.log;
      out.push(h('div', 'mini', 'Iteration log in double precision (the final result is then refined and verified). Mismatches in pu on the system base.'));
      // Gauss-Seidel can take hundreds of iterations: the first 15 and the last 15 are shown
      const shown = log.length > 40 ? [...log.slice(0, 15), null, ...log.slice(-15)] : log, gap = `… ${log.length - 30} iterations …`;
      out.push(table(['Iteration', 'max |ΔP|', 'max |ΔQ|'], shown.map(e => (e ? [String(e.it), e.dP.toExponential(3).replace('.', ','), e.dQ.toExponential(3).replace('.', ',')] : [gap, '', '']))));
      if (log.length && log[0].V) {
        const f6 = x => x.toFixed(6).replace('.', ',');
        out.push(h('div', 'mini', 'Bus voltages at each iteration (|V| pu ∠ θ °):'));
        out.push(table(['Iteration', ...r.bus.map(b => `Bus ${b.n}`)], shown.map(e => (e ? [String(e.it), ...e.V.map((v, k) => `${f6(v)} ∠ ${f6(e.Va[k])}`)] : [gap, ...r.bus.map(() => '')]))));
      }
      if (log.length && log[0].J) {
        const m = log[0].Jn, J = log[0].J, rowsJ = [];
        for (let i = 0; i < m; i++) rowsJ.push([String(i + 1), ...Array.from({ length: m }, (_, j) => J[i * m + j].toPrecision(6).replace('.', ','))]);
        out.push(h('div', 'mini', 'Jacobian at the start (rows: ΔP of PV+PQ buses, then ΔQ of PQ buses; columns: θ, then |V|), MATPOWER ordering:'));
        out.push(table(['Row', ...Array.from({ length: m }, (_, j) => String(j + 1))], rowsJ));
      }
    }
    return out;
  }
  function sendToCalc(r) {
    const n = r.V.length, v = new E.Mat(n, 1, r.V.slice());
    eng.setVar('Vbus', v);
    const c = r.model ? { model: r.model } : compileCase();   // each result carries the model it was solved on
    if (c.model) {
      const Y = new E.Mat(n, n);
      E.internals.withDps(50, () => {
        const yrows = NW.ybusRows(c.model);
        yrows.forEach((row, i) => row.forEach(([j, y]) => Y.set(i, j, y)));
      });
      eng.setVar('Ybus', Y);
    }
    toast('Saved Vbus and Ybus');
    ctx.show('calc');
  }

  // ═══════════════════════════════════════════════ short circuit
  function renderSC() {
    const c = compileCase();
    const parts = [h('div', 'mini', 'Case: ' + kase.name)];
    if (c.issues) { scroll.replaceChildren(...parts, issuesBox(c.issues)); return; }
    const buses = c.model.buses.map(b => b.n);
    if (!buses.includes(sc.bus)) sc.bus = buses[Math.min(4, buses.length - 1)];
    const opts = h('div', 'opts');
    const busBtn = button(`Faulted bus: ${sc.bus}  ▾`, () => sheet('Faulted bus', [], box => {
      const g = h('div', 'grid');
      buses.forEach(n => { const b = h('button', n === sc.bus ? 'on' : null, String(n)); b.addEventListener('click', () => { sc.bus = n; sc.res = null; sheetClose(); renderSC(); }); g.appendChild(b); });
      box.appendChild(g);
    }), 'wide2');
    opts.append(busBtn, segmented(FAULTS, sc.type, v => { sc.type = v; sc.res = null; }));
    const zrow = h('div', 'fields');
    const zl = h('label', null, 'Fault impedance Zf'), zv = h('div'), zu = h('span', 'unit', 'pu');
    const wasActive = zfEd && activeEditor() === zfEd;      // a re-render must not strand the keypad on the old editor
    zfEd = new Editor(zv, ed => { sc.zf = ed.text; });
    zfEd.set(sc.zf);
    if (wasActive) activate(zfEd);
    zrow.append(zl, zv, zu);
    opts.append(zrow, segmented([['flat', 'Prefault 1,0 pu'], ['pf', 'Prefault from power flow']], sc.prefault, v => { sc.prefault = v; sc.res = null; }));
    parts.push(opts, button('Compute fault', runSC, 'accent big'));
    if (sc.err) parts.push(sc.err);
    if (sc.res) parts.push(...scResults(c.model));
    scroll.replaceChildren(...parts);
    scroll.classList.remove('casemode');
  }
  const sheetClose = () => { const s = document.getElementById('sheet'); s.hidden = true; s.replaceChildren(); };
  function runSC() {
    const c = compileCase();
    if (c.issues) { sc.err = issuesBox(c.issues); renderSC(); return; }
    let zf;
    try { zf = sc.zf.trim() ? E.norm(eng.evalValue(sc.zf)) : null; }
    catch (ex) { sc.err = h('div', 'issues', 'Fault impedance: ' + (ex.msg || 'invalid')); renderSC(); return; }
    sc.err = null;
    try { sc.res = NW.shortCircuit(c.model, { bus: sc.bus, type: sc.type, zf, prefault: sc.prefault, qlim: pf.qlim }); }
    catch (ex) { sc.res = null; sc.err = ex.issues ? issuesBox(ex.issues) : h('div', 'issues', ex.msg || String(ex)); }
    activate(null); ctx.updatePad();
    renderSC();
  }
  function scResults() {
    const r = sc.res, out = [], kv = h('div', 'kv');
    const line = (k, v, val, name) => {
      const a = h('div', 'kk', k), b = h('div', 'vv', v);
      if (val != null) { b.classList.add('tap'); b.addEventListener('click', () => valueSheet(k, val, name)); }
      kv.append(a, b);
    };
    const kind = { '3ph': 'Three-phase', slg: 'Single line-to-ground (phase a)', ll: 'Line-to-line (b–c)', llg: 'Double line-to-ground (b–c)' }[r.kind];
    out.push(h('div', 'status ok', `${kind} fault at bus ${r.busNum} · ${r.reliable ? `≈ ${r.reliable} digits verified` : 'verified (42 digits)'}`));
    if (r.z0inf) out.push(h('div', 'issues warnbox', 'No zero-sequence path to ground at this bus: Z0 is infinite.'));
    line('Fault current', `${num(r.Ifm)} pu${r.IfkA ? `   ${num(r.IfkA)} kA` : ''}`, r.If, 'If');
    if (r.Sk) line('Fault power', `${num(r.Sk)} MVA`, r.Sk, 'Sk');
    line('Z1 (Thévenin)', cplx(r.Z.z1)[0], r.Z.z1, 'Zth1');
    if (r.kind !== '3ph') line('Z2', cplx(r.Z.z2)[0], r.Z.z2, 'Zth2');
    if (r.Z.z0) line('Z0', cplx(r.Z.z0)[0], r.Z.z0, 'Zth0');
    ['I0', 'I1', 'I2'].forEach((n, i) => line(n, cplx(r.seq[i]).slice(-1)[0], r.seq[i], n));
    ['Ia', 'Ib', 'Ic'].forEach((n, i) => line(n, `${cplx(r.abc[i]).slice(-1)[0]}${r.abckA ? `   (${num(r.abckA[i])} kA)` : ''}`, r.abc[i], n));
    out.push(kv);
    out.push(h('div', 'mini', 'Phase voltages at every bus during the fault (magnitudes, pu):'));
    out.push(table(['Bus', '|Va|', '|Vb|', '|Vc|'], r.bus.map(b => [{ t: String(b.n) }, { t: num(b.vam), v: b.va, name: `Va${b.n}`, cls: 'n' },
      { t: num(b.vbm), v: b.vb, name: `Vb${b.n}`, cls: 'n' }, { t: num(b.vcm), v: b.vc, name: `Vc${b.n}`, cls: 'n' }])));
    return out;
  }

  // ═══════════════════════════════════════════════ N-1 contingency
  function renderN1() {
    const parts = [h('div', 'mini', 'Case: ' + kase.name)];
    const row = h('div', 'btnrow');
    row.append(chip(`Branches: ${n1.branches ? 'yes' : 'no'}`, () => { n1.branches = !n1.branches; renderN1(); }),
      chip(`Generators: ${n1.gens ? 'yes' : 'no'}`, () => { n1.gens = !n1.gens; renderN1(); }),
      chip(`Q limits: ${pf.qlim ? 'on' : 'off'}`, () => { pf.qlim = !pf.qlim; renderN1(); }),
      chip(`${digits} digits`, () => { digits = TABLE_DIGITS[(TABLE_DIGITS.indexOf(digits) + 1) % TABLE_DIGITS.length]; renderN1(); }));
    parts.push(row);
    if (n1.running) {
      parts.push(h('div', 'status', `Analysing outage ${n1.done + 1} of ${n1.total}…`), button('Cancel', () => { n1.cancel = true; }, 'wide2'));
    } else parts.push(button('Run N-1 analysis', runN1, 'accent big'));
    if (n1.err) parts.push(n1.err);
    if (n1.res) {
      const res = n1.res.slice().sort((a, b) => (b.severity || 0) - (a.severity || 0));
      parts.push(h('div', 'mini', `${res.length} outages, each solved and verified. Most severe first. Tap a row for its full results.`));
      const label = { ok: 'OK', violations: 'Violations', islanding: 'Islanding', diverged: 'No solution', invalid: 'Invalid' };
      parts.push(table(['Outage', 'Result', 'Max loading %', 'Min V pu', 'Max V pu', 'Violations'], res.map(x => [
        { t: x.outage.label }, { t: label[x.status] || x.status, cls: x.status === 'ok' ? 'good' : 'bad' },
        { t: x.worst ? `${num(x.worst.loading)} (${x.worst.f}–${x.worst.t})` : '', cls: 'n' + (x.worst && x.worst.over ? ' bad' : '') },
        { t: x.vmin ? `${num(x.vmin.vm)} (${x.vmin.n})` : '', cls: 'n' + (x.vmin && x.vmin.vio ? ' bad' : '') },
        { t: x.vmax ? `${num(x.vmax.vm)} (${x.vmax.n})` : '', cls: 'n' + (x.vmax && x.vmax.vio ? ' bad' : '') },
        { t: x.violations != null ? String(x.violations) : x.note || '', cls: 'n' }]), i => {
        const x = res[i];
        if (!x.solved) { toast(x.note || 'No results for this outage'); return; }
        let full;                                            // re-solved on demand: the list keeps only summaries
        try { full = NW.solveOutage(n1.snapshot, n1.eng, x.outage, { qlim: n1.qlim }); } catch (ex) { toast(ex.msg || String(ex)); return; }
        pf.res = full.result; pf.res.model = full.model; pf.title = `${x.outage.label} out`; pf.tab = 'summary'; pf.err = null;
        ctx.show('net', 'pf');
      }));
    }
    scroll.replaceChildren(...parts);
    scroll.classList.remove('casemode');
  }
  function runN1() {
    const c = compileCase();
    if (c.issues) { n1.err = issuesBox(c.issues); renderN1(); return; }
    // the base case only has to converge (checked in double precision; each outage is then solved and verified)
    try { const b = NW.floatPowerFlow(c.model, { qlim: pf.qlim, method: 'nr' }); if (!b.converged) throw new E.CalcError('Newton-Raphson did not converge'); }
    catch (ex) { n1.err = h('div', 'issues', 'Base case: ' + (ex.msg || ex)); renderN1(); return; }
    const list = NW.outages(c.model).filter(o => (o.kind === 'branch' ? n1.branches : n1.gens));
    // the case and the calculator variables it may use are frozen for the run (a row opened later re-solves the same)
    const frozen = new E.Engine(); frozen.angleUnit = eng.angleUnit; for (const [k, v] of eng.vars) frozen.vars.set(k, v);
    const snapshot = JSON.parse(JSON.stringify(kase)), qlim = pf.qlim, res = [], run = ++n1.run;
    Object.assign(n1, { running: true, cancel: false, done: 0, total: list.length, res, err: null, snapshot, qlim, eng: frozen });
    renderN1();
    const step = () => {
      if (run !== n1.run) return;                            // the case was edited (or a new run started): drop this one
      if (n1.cancel || n1.done >= list.length) { n1.running = false; if (n1.cancel) toast('Stopped'); if (current === 'n1') renderN1(); return; }
      res.push(NW.runOutage(snapshot, frozen, list[n1.done], { qlim }));
      n1.done++;
      if (current === 'n1') { const s = scroll.querySelector('.status'); if (s) s.textContent = `Analysing outage ${Math.min(n1.done + 1, n1.total)} of ${n1.total}…`; }
      setTimeout(step, 0);                                   // keep the interface responsive between outages
    };
    setTimeout(step, 30);
  }

  // ═══════════════════════════════════════════════ module interface
  function render() { ({ case: renderCase, pf: renderPF, sc: renderSC, n1: renderN1 })[current](); }
  return {
    show(sub) { if (sub !== current && !commitCell()) closeCell(); current = sub; render(); scroll.scrollTop = 0; },
    hide() { if (!commitCell()) closeCell(); },
    wantsPad() { const a = activeEditor(); return (current === 'case' && !!cell) || (current === 'sc' && a && a === zfEd); },
    enter(ed) { if (cell && ed === cell.ed) commitCell(true); else if (ed === zfEd) runSC(); },
    escape() { if (cell) cancelCell(); },
    onSettings() {},
  };
}
