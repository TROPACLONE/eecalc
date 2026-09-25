/*
 EE Calc — iPhone / iPad interface (shell, calculator, energy tools, variables, help).
 The Network and Chat screens are separate modules loaded the first time they are opened.

 Privacy: the calculator stores nothing (no cookies, localStorage, IndexedDB). History, variables and
 network cases live in memory and vanish when the app is closed; a case is kept only if you save it
 to a file yourself. The service worker caches only the app's own files for offline use. The chat (once
 opened, while the app is visible, to count unread messages) and the player (while something plays or a
 list is loaded) are the only features that use the network.
*/
import * as E from './engine.js';
import * as N from './energy.js';
import * as Pr from './profile.js';
import { $, h, Editor, activate, activeEditor, onTap, sheet, closeSheet, toast, copy, segmented } from './ui.js';
import { icon } from './icons.js';

const MAX_ITEMS = 200, MAX_INPUTS = 500;
const PREVIEW_MIN = 40, PREVIEW_MAX = 1200, SLOW_MS = 120, LONG_PRESS = 480;
const DIGITS = [6, 8, 10, 12, 15, 20, 30, 40];
const NOTATIONS = [['auto', 'Normal'], ['eng', 'Engineering'], ['sci', 'Scientific']];
const VIEWS = ['calc', 'energy', 'net', 'vars', 'focus', 'media', 'chat', 'profile', 'help'];
const NET_TITLES = { case: 'Case editor', pf: 'Power flow', sc: 'Short circuit', n1: 'Contingency (N-1)' };

const eng = new E.Engine();
const st = { unit: 'deg', digits: 10, notation: 'auto', view: 'calc', sub: null, fn: false };
const items = [], inputs = [];
let hpos = null, draft = '', nextId = 0;
let netMod = null, chatMod = null, focusMod = null, energy = null, mediaMod = null, mediaView = null;

// ═════════════════════════════════════════════════════════ shared context for the lazily loaded screens
const ctx = {
  eng, st, E, show: (v, s) => show(v, s), updatePad: () => updatePad(), setTitle: () => setTitle(),
  useValue(name, value) { eng.setVar(name, value); show('calc'); main.insert(name); toast(`Saved as ${name}`); },
  unread(n) { st.unread = n; $('dot').hidden = !n || st.view === 'chat'; },
  profile: Pr,
};

// ═════════════════════════════════════════════════════════ main editor, preview, run
const main = new Editor($('expr'), () => { hpos = null; schedulePreview(); });
activate(main);
const preview = $('preview');
let pvTimer = 0, pvDelay = PREVIEW_MIN, busy = false;

function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(updatePreview, pvDelay); }
function commandOf(t) { const l = t.toLowerCase(); return ['clear', 'cls', 'clearvars', 'help', 'vars'].includes(l) || l.startsWith('del ') ? l : null; }
const sigOf = rel => (rel ? Math.min(st.digits, rel) : st.digits);
const fmt = (v, rel) => E.formatValue(v, st.unit, sigOf(rel), st.notation);

function updatePreview() {
  clearTimeout(pvTimer);
  const t = main.text.trim();
  preview.className = '';
  if (!t || commandOf(t)) { preview.textContent = ''; return; }
  const t0 = performance.now();
  try {
    const r = eng.evaluate(t, false);
    const limited = r.reliable && r.reliable < st.digits;
    preview.textContent = (r.name ? r.name + ' ' : '') + (E.isM(r.value) ? `=  ${r.value.rows}×${r.value.cols} matrix`
      : (limited ? '≈  ' : '=  ') + fmt(r.value, r.reliable).map(x => x[0]).join('      '));
  } catch (ex) { preview.textContent = ex.msg || "This expression can't be evaluated"; }
  pvDelay = Math.round(Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, 3 * (performance.now() - t0))));
}
function run() {
  const t = main.text.trim();
  if (!t || busy) return;
  const cmd = commandOf(t);
  if (cmd) { runCommand(cmd, t); pushInput(t); main.clear(); return; }
  if (pvDelay > SLOW_MS) {                            // let "Calculating…" paint before a long computation
    preview.className = ''; preview.textContent = 'Calculating…';
    busy = true;
    requestAnimationFrame(() => setTimeout(() => { busy = false; commit(t); }, 0));
  } else commit(t);
}
function commit(t) {
  let r;
  try { r = eng.evaluate(t, true); }
  catch (ex) {
    preview.className = 'err';
    preview.textContent = '✕  ' + (ex.msg || "This expression can't be evaluated");
    if (ex.pos != null) { main.caret = Math.min(main.text.length, (main.text.length - main.text.trimStart().length) + ex.pos); main.render(); }
    return;
  }
  const it = { id: nextId++, input: t, name: r.name, value: r.value, reliable: r.reliable };
  items.push(it);
  if (items.length === 1) renderHistory();
  else {
    historyEl.appendChild(entryEl(it));
    while (items.length > MAX_ITEMS) {
      const old = items.shift(), el = historyEl.querySelector(`.entry[data-id="${old.id}"]`);
      if (el) el.remove();                              // may not be rendered yet (chunked render)
    }
  }
  historyEl.scrollTop = historyEl.scrollHeight;
  $('clear-hist').hidden = false;
  $('said').textContent = `${it.name ? it.name + ' = ' : ''}${E.isM(it.value) ? `${it.value.rows} by ${it.value.cols} matrix` : fmt(it.value, it.reliable)[0][0]}`;
  pushInput(t);
  main.clear();
  preview.textContent = '';
}
function runCommand(cmd, t) {
  if (cmd === 'clear' || cmd === 'cls') clearHistory();
  else if (cmd === 'clearvars') eng.clearVars();
  else if (cmd.startsWith('del ')) t.slice(4).replace(/;/g, ' ').split(/\s+/).filter(Boolean).forEach(n => eng.delVar(n));
  else if (cmd === 'help') show('help');
  else if (cmd === 'vars') show('vars');
}
function pushInput(t) { if (inputs[inputs.length - 1] !== t) { inputs.push(t); if (inputs.length > MAX_INPUTS) inputs.shift(); } hpos = null; }
function recall(d) {
  if (!inputs.length) return;
  if (hpos === null) { if (d > 0) return; draft = main.text; hpos = inputs.length; }
  hpos += d;
  if (hpos < 0) hpos = 0;
  if (hpos >= inputs.length) { hpos = null; main.set(draft); return; }
  const k = hpos; main.set(inputs[k]); hpos = k;
}

// ═════════════════════════════════════════════════════════ history
const historyEl = $('history');
const EMPTY = 'Type an expression and press =.\n\n<code>34,5∠98 - 63∠3 rad</code>\n<code>Z1 = 3 + j4</code>\n<code>Z1 // 10∠-30</code>\n\n' +
  'Tap a result to reuse it; touch and hold for more.\nMore tools: the ☰ menu.';
let renderGen = 0;
// runs fn after pending input and rendering, without setTimeout's 4 ms clamp on nested calls
const yieldCh = new MessageChannel(), yieldQ = [];
yieldCh.port1.onmessage = () => { const fn = yieldQ.shift(); if (fn) fn(); };
const yieldThen = fn => { yieldQ.push(fn); yieldCh.port2.postMessage(0); };
/** The entries on screen render at once; older ones follow in the background, so settings changes stay instant. */
function renderHistory() {
  const gen = ++renderGen;
  historyEl.replaceChildren();
  if (!items.length) { const d = h('div', 'hint'); d.innerHTML = EMPTY; historyEl.appendChild(d); $('clear-hist').hidden = true; return; }
  const pending = items.slice(0, -16), frag = document.createDocumentFragment();
  for (const it of items.slice(-16)) frag.appendChild(entryEl(it));        // more than a screenful, even on iPad
  historyEl.appendChild(frag);
  historyEl.scrollTop = historyEl.scrollHeight;
  // older entries are built off the page in slices of ~25 ms (under the 50 ms of a long task) and inserted about every
  // 150 ms: each insertion costs a layout of the whole list (to keep the scroll position), so few insertions keep it fast
  let built = [], since = performance.now();
  const older = () => {
    if (gen !== renderGen) return;
    const t0 = performance.now();
    while (pending.length && performance.now() - t0 < 25) { const it = pending.pop(); if (items.includes(it)) built.push(entryEl(it)); }
    if (built.length && (!pending.length || performance.now() - since > 150)) {
      const fromBottom = historyEl.scrollHeight - historyEl.scrollTop;
      historyEl.prepend(...built.reverse());
      historyEl.scrollTop = historyEl.scrollHeight - fromBottom;
      built = []; since = performance.now();
    }
    if (pending.length) yieldThen(older);
  };
  yieldThen(older);
}
function entryEl(it) {
  const d = h('div', 'entry'); d.dataset.id = it.id;
  d.appendChild(h('div', 'in', it.input));
  const lines = fmt(it.value, it.reliable), pre = it.name ? it.name + ' = ' : '';
  lines.forEach(([text, role], k) => {
    const o = h('div', 'out ' + role);
    if (pre) o.appendChild(h('span', 'name', k === 0 ? pre : ' '.repeat(pre.length)));
    o.appendChild(document.createTextNode(text));
    o.dataset.text = text;
    d.appendChild(o);
  });
  if (it.reliable && it.reliable < st.digits) d.appendChild(h('div', 'note', `≈ only ${it.reliable} digits could be verified`));
  return d;
}
function clearHistory() { items.length = 0; renderHistory(); }
const itemOf = el => { const e = el.closest('.entry'); return e ? items.find(x => x.id === Number(e.dataset.id)) : null; };
onTap(historyEl, target => {
  const it = itemOf(target);
  if (!it) return;
  if (target.closest('.in')) main.set(it.input);
  else if (target.closest('.out')) main.insert(E.isM(it.value) ? it.name || E.fullPrecision(it.value, st.unit, it.reliable) : target.closest('.out').dataset.text);
  activate(main);
}, target => {
  const it = itemOf(target);
  if (!it) return;
  const full = E.fullPrecision(it.value, st.unit, it.reliable), out = target.closest('.out');
  sheet(null, [
    out && !E.isM(it.value) && ['Copy', () => copy(out.dataset.text)],
    ['Copy full precision', () => copy(full)],
    ['Insert full precision', () => main.insert(full)],
    ['Edit expression', () => main.set(it.input)],
  ]);
});

// ═════════════════════════════════════════════════════════ keypad
const MAIN_KEYS = [
  [['fn', 'fn', 'muted'], ['abc', 'abc', 'muted'], ['◀', 'left', 'muted'], ['▶', 'right', 'muted'], ['⌫', 'back', 'muted']],
  [['(', '('], [')', ')'], ['∠', '∠', 'op'], ['j', 'j', 'op'], ['÷', '/', 'op']],
  [['7', '7'], ['8', '8'], ['9', '9'], ['°', '°', 'op'], ['×', '*', 'op']],
  [['4', '4'], ['5', '5'], ['6', '6'], ['^', '^', 'op'], ['−', '-', 'op']],
  [['1', '1'], ['2', '2'], ['3', '3'], ['//', ' // ', 'op'], ['+', '+', 'op']],
  [['0', '0'], [',', ','], ['EE', 'e', 'muted'], [';', ';'], ['=', 'exe', 'exe']],
];
const FN_KEYS = [
  [['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['log', 'log(']],
  [['asin', 'asin('], ['acos', 'acos('], ['atan', 'atan('], ['exp', 'exp('], ['√', '√(']],
  [['abs', 'abs('], ['ang', 'ang('], ['re', 're('], ['im', 'im('], ['conj', 'conj(']],
  [['π', 'π'], ['rad', ' rad'], ['x²', '²'], ['ans', 'ans'], ['var =', ' = ']],
  [['k', 'k'], ['M', 'M'], ['m', 'm'], ['µ', 'µ'], ['more…', 'more', 'muted']],
];
const pad = $('pad'), keyEls = [];
for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) { const b = h('button', 'k'); b.dataset.r = r; b.dataset.c = c; pad.appendChild(b); keyEls.push(b); }
function renderPad() {
  keyEls.forEach(b => {
    const r = +b.dataset.r, c = +b.dataset.c;
    const [label, act, cls = ''] = st.fn && r >= 1 ? FN_KEYS[r - 1][c] : MAIN_KEYS[r][c];
    b.textContent = label; b.dataset.act = act;
    b.className = 'k ' + cls + (st.fn && r >= 1 ? ' fnk' : '') + (act === 'fn' && st.fn ? ' on' : '');
    b.setAttribute('aria-label', { back: 'Delete', left: 'Cursor left', right: 'Cursor right', exe: 'Evaluate', fn: 'Functions', abc: 'Letters keyboard' }[act] || label);
  });
}
let lpTimer = 0, lpFired = false, downKey = null;
pad.addEventListener('pointerdown', e => {
  const b = e.target.closest('.k'); if (!b) return;
  e.preventDefault();
  downKey = b; b.classList.add('down'); lpFired = false;
  if (b.dataset.act === 'back') lpTimer = setTimeout(() => { lpFired = true; const a = activeEditor(); if (a) a.clear(); }, LONG_PRESS);
});
const release = e => {
  clearTimeout(lpTimer);
  const b = downKey; downKey = null;
  if (!b) return;
  b.classList.remove('down');
  if (e.type === 'pointerup' && !lpFired && b.contains(document.elementFromPoint(e.clientX, e.clientY))) key(b.dataset.act);
};
pad.addEventListener('pointerup', release);
pad.addEventListener('pointercancel', release);
pad.addEventListener('contextmenu', e => e.preventDefault());

function key(act) {
  const ed = activeEditor();
  const wasFn = st.fn && !['fn', 'abc', 'left', 'right', 'back', 'exe', 'more'].includes(act);
  switch (act) {
    case 'fn': st.fn = !st.fn; renderPad(); return;
    case 'abc': openSystemKeyboard(); return;
    case 'more': st.fn = false; renderPad(); functionsSheet(); return;
    case 'exe': enter(); return;
  }
  if (!ed) return;
  if (act === 'left') ed.move(-1);
  else if (act === 'right') ed.move(1);
  else if (act === 'back') ed.back();
  else ed.insert(act);
  if (wasFn) { st.fn = false; renderPad(); }                  // the functions page is one-shot, like Shift
}
function enter() {
  const ed = activeEditor();
  if (ed === main) run();
  else if (energy && energy.fields.includes(ed)) energy.next(ed);
  else if (netMod && st.view === 'net') netMod.enter(ed);
}
function wantsPad() {
  if (st.view === 'calc') return true;
  if (st.view === 'energy') return !!(energy && energy.tool);
  if (st.view === 'net') return !!(netMod && netMod.wantsPad());
  return false;
}
function updatePad() { pad.hidden = !wantsPad(); document.body.classList.toggle('nopad', pad.hidden); }   // iPad landscape: content takes the keypad's column
document.addEventListener('editor-change', updatePad);

// ═════════════════════════════════════════════════════════ letters keyboard (system) and hardware keyboard
const sysin = $('sysin'), SENT = '\u00a0';
function openSystemKeyboard() { sysin.value = SENT; sysin.focus(); sysin.setSelectionRange(1, 1); document.body.classList.add('kbd'); }
sysin.addEventListener('input', () => {
  const ed = activeEditor(), v = sysin.value;
  if (ed) {
    if (v === '') ed.back();
    else if (v.startsWith(SENT)) { const s = v.slice(1); if (s) ed.insert(mapChars(s)); }
    else ed.insert(mapChars(v));
  }
  sysin.value = SENT; sysin.setSelectionRange(1, 1);
});
sysin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sysin.blur(); enter(); } });
sysin.addEventListener('blur', () => document.body.classList.remove('kbd'));
const mapChars = s => s.replace(/[<@]/g, '∠');

document.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (document.activeElement === sysin || tag === 'INPUT' || tag === 'TEXTAREA' || !$('sheet').hidden) return;
  if (e.metaKey || e.ctrlKey || e.altKey || !wantsPad()) return;
  const ed = activeEditor(); if (!ed) return;
  const k = e.key;
  let done = true;
  if (k === 'Enter') enter();
  else if (k === 'Backspace') ed.back();
  else if (k === 'Delete') ed.del();
  else if (k === 'ArrowLeft') ed.move(-1);
  else if (k === 'ArrowRight') ed.move(1);
  else if (k === 'Home') ed.home();
  else if (k === 'End') ed.end();
  else if (k === 'ArrowUp' && ed === main) recall(-1);
  else if (k === 'ArrowDown' && ed === main) recall(1);
  else if (k === 'Escape') { if (st.view === 'energy' && energy && energy.tool) energy.close(); else if (netMod && st.view === 'net') netMod.escape(); else ed.clear(); }
  else if (k.length === 1) ed.insert(mapChars(k));
  else done = false;
  if (done) e.preventDefault();
});

const FUNC_GROUPS = [
  ['Syntax', ['[', ']', '|', ';', ' = ', '∠', '°', ' rad', '²', '³', '√', ' // ', '\\']],
  ['Complex', ['abs(', 'ang(', 're(', 'im(', 'conj(', 'fase(', 'polar(', 'rect(']],
  ['Powers and logs', ['sqrt(', 'root(', 'exp(', 'ln(', 'log(', 'log10(', 'log2(']],
  ['Trigonometry', ['sin(', 'cos(', 'tan(', 'asin(', 'acos(', 'atan(', 'atan2(', 'sinh(', 'cosh(', 'tanh(', 'asinh(', 'acosh(', 'atanh(']],
  ['Energy systems', ['s3(', 's1(', 'i3(', 'pf(', 'par(', 'zl(', 'zc(', 'omega(', 'db20(', 'db10(', 'zbase(', 'ybase(', 'ibase(', 'pu(', 'chbase(', 'y2d(', 'd2y(', 'seq(', 'abc(']],
  ['Matrices', ['inv(', 'det(', 'transp(', 'herm(', 'solve(', 'eye(', 'zeros(', 'diag(']],
  ['Constants and more', ['pi', 'e', 'a', 'c0', 'mu0', 'eps0', 'ans', 'round(', 'G', 'T', 'n', 'p', 'u']],
];
function functionsSheet() {
  sheet(null, [], box => {
    for (const [g, list] of FUNC_GROUPS) {
      box.appendChild(h('h4', null, g));
      const grid = h('div', 'grid');
      for (const f of list) {
        const b = h('button', null, f.trim() || f);
        b.addEventListener('click', () => { closeSheet(); const ed = activeEditor(); if (ed) ed.insert(f); });
        grid.appendChild(b);
      }
      box.appendChild(grid);
    }
  });
}

// ═════════════════════════════════════════════════════════ menu and navigation
const menuOpen = { net: false };
function titleOf() {
  if (st.view === 'energy') return energy && energy.tool ? energy.tool.title : 'Energy tools';
  if (st.view === 'net') return NET_TITLES[st.sub] || 'Network';
  return { calc: 'Calculator', vars: 'Variables', focus: 'Focus', media: 'Media', chat: 'Chat', profile: 'Profile', help: 'Help' }[st.view];
}
function setTitle() {
  $('title').textContent = titleOf();
  $('to-calc').hidden = st.view === 'calc';
}
function openMenu() {
  const online = navigator.onLine;
  sheet(null, [], box => {
    box.classList.add('menu');
    const item = (label, fn, cls, note, ic) => {
      const b = h('button', 'mi' + (cls ? ' ' + cls : ''));
      if (ic) b.appendChild(icon(ic));
      b.appendChild(h('span', 'ml', label));
      if (note) b.appendChild(h('small', null, note));
      b.addEventListener('click', fn);
      box.appendChild(b);
      return b;
    };
    const go = (v, s) => () => { closeSheet(); show(v, s); };
    const group = (k, label, ic) => {
      const b = item(label, () => { menuOpen[k] = !menuOpen[k]; closeSheet(); openMenu(); }, 'grp' + (menuOpen[k] ? ' open' : ''), null, ic);
      b.appendChild(icon(menuOpen[k] ? 'down' : 'right', 'chev')); b.setAttribute('aria-expanded', String(menuOpen[k]));
    };
    item('Calculator', go('calc'), st.view === 'calc' ? 'cur' : '', null, 'calc');
    item('Variables', go('vars'), st.view === 'vars' ? 'cur' : '', null, 'vars');
    item('Energy tools', go('energy', 'list'), st.view === 'energy' ? 'cur' : '', `${N.TOOLS.length} tools`, 'energy');
    group('net', 'Network', 'net');
    if (menuOpen.net) for (const [k, t] of Object.entries(NET_TITLES)) item(t, go('net', k), 'sub' + (st.view === 'net' && st.sub === k ? ' cur' : ''));
    box.appendChild(h('div', 'sep'));
    const r = Pr.get() && Pr.get().run, left = Pr.remaining();
    item('Focus', go('focus'), st.view === 'focus' ? 'cur' : '', left != null ? Pr.fmtTime(left) : r && r.pending ? 'Next session ready' : 'Pomodoro timer', 'focus');
    const p = mediaMod && mediaMod.player;
    item('Media', go('media'), st.view === 'media' ? 'cur' : '', p && p.active ? `${p.playing ? 'Playing' : 'Paused'}: ${p.item.title}` : 'Radio · lofi · audiobooks', 'phones');
    const chat = item('Chat', online ? go('chat') : () => toast('The chat needs an internet connection'),
      (online ? '' : 'locked') + (st.view === 'chat' ? ' cur' : ''), online ? 'Global room' : 'Offline', online ? 'chat' : 'lock');
    if (online && st.unread) chat.querySelector('.ml').appendChild(h('span', 'badge', st.unread > 9 ? '9+' : String(st.unread)));
    box.appendChild(h('div', 'sep'));
    if (Pr.get()) item('Profile', go('profile'), st.view === 'profile' ? 'cur' : '', `Level ${Pr.levelOf(Pr.get().xp)}`, 'profile');
    item('Help', go('help'), st.view === 'help' ? 'cur' : '', null, 'help');
  });
}
$('menu-btn').addEventListener('click', openMenu);
$('to-calc').addEventListener('click', () => show('calc'));

/** Imports a screen's module, showing "Loading…"; if it can't be fetched (offline, or the app was just updated and
 *  the old file is gone) the screen says so and offers a reload. -> the module, or null. */
async function lazy(id, imp) {
  $(id).replaceChildren(h('div', 'hint pad16', 'Loading…'));
  try { return await imp(); } catch {
    const box = h('div', 'hint pad16', navigator.onLine ? 'This screen could not be loaded: the app has just been updated.' : 'This screen needs an internet connection the first time it is opened.');
    const b = h('button', 'btn accent', 'Reload'); b.addEventListener('click', () => location.reload());
    if (navigator.onLine) box.append(document.createElement('br'), b);
    $(id).replaceChildren(box);
    return null;
  }
}
async function show(view, sub = null) {
  if (view === 'chat' && !navigator.onLine) { toast('The chat needs an internet connection'); return; }
  st.view = view; st.sub = sub;
  for (const v of VIEWS) $('v-' + v).hidden = v !== view;
  if (view === 'calc') activate(main);
  if (view === 'energy') {
    if (!energy) energy = new EnergyView($('v-energy'));
    if (sub && N.TOOL_BY_ID[sub]) energy.open(N.TOOL_BY_ID[sub]); else if (sub === 'list' || !energy.tool) energy.list(); else energy.focus();
  }
  if (view === 'vars') renderVars();
  if (view === 'help') renderHelp(sub);
  // a screen loaded on first use: after the await the user may already be elsewhere, so each step re-checks
  const moved = () => st.view !== view || st.sub !== sub;
  if (view === 'net') {
    if (!netMod) { const m = await lazy('v-net', () => import('./netui.js')); if (!m) return; if (!netMod) netMod = m.init(ctx, $('v-net')); if (moved()) return; }
    netMod.show(sub || 'case');
  } else if (netMod) netMod.hide();
  if (view === 'focus') {
    if (!focusMod) { const m = await lazy('v-focus', () => import('./focusui.js')); if (!m) return; if (!focusMod) focusMod = m.init(ctx, $('v-focus')); if (moved()) return; }
    focusMod.show();
  } else if (focusMod) focusMod.hide();
  if (view === 'media') {
    if (!mediaView) { const m = await lazy('v-media', loadMedia); if (!m) return; if (!mediaView) mediaView = m.ui.screen($('v-media')); if (moved()) return; }
    mediaView.show();
  } else if (mediaView) mediaView.hide();
  if (view === 'profile') renderProfile();
  if (view === 'chat') {
    if (!chatMod) { const m = await lazy('v-chat', () => import('./chatui.js')); if (!m) return; if (!chatMod) chatMod = m.init(ctx, $('v-chat')); if (moved()) return; }
    chatMod.show();
    $('dot').hidden = true;
  } else if (chatMod) chatMod.hide();
  if (!['calc', 'energy', 'net'].includes(view)) activate(null);
  setTitle();
  updatePad();
  updateMini();
}

// ═════════════════════════════════════════════════════════ player bubble (top right, outside Media)
async function loadMedia() {
  if (!mediaMod) {
    const [m, ui] = await Promise.all([import('./media.js'), import('./mediaui.js')]);
    mediaMod = { player: m.player, ui }; m.player.on(updateMini);
  }
  return mediaMod;
}
let miniKey = '';
function updateMini() {
  const b = $('mini'), p = mediaMod && mediaMod.player;
  b.hidden = !p || !p.active || st.view === 'media';
  if (b.hidden) return;
  const key = `${p.item.kind}:${p.item.id}:${p.item.logo}`;
  if (key !== miniKey) { miniKey = key; b.replaceChildren(mediaMod.ui.art(p.item)); }
  b.classList.toggle('playing', p.playing);
  b.setAttribute('aria-label', `${p.playing ? 'Playing' : 'Paused'}: ${p.item.title}`);
}
$('mini').addEventListener('click', () => loadMedia().then(m => m.ui.openPlayer(() => show('media')), () => toast('The player could not be loaded')));

function refreshBar() {
  $('s-unit').textContent = st.unit === 'deg' ? 'Degrees' : 'Radians';
  $('s-digits').textContent = `${st.digits} digits`;
  $('s-nota').textContent = Object.fromEntries(NOTATIONS)[st.notation];
}
function settingsChanged() {
  refreshBar(); renderHistory(); updatePreview();
  if (energy && energy.tool) energy.compute();
  if (netMod) netMod.onSettings();
}
$('s-unit').addEventListener('click', () => { st.unit = st.unit === 'deg' ? 'rad' : 'deg'; eng.angleUnit = st.unit; settingsChanged(); });
$('s-digits').addEventListener('click', () => { st.digits = DIGITS[(DIGITS.indexOf(st.digits) + 1) % DIGITS.length]; settingsChanged(); });
$('s-nota').addEventListener('click', () => { const k = NOTATIONS.map(x => x[0]); st.notation = k[(k.indexOf(st.notation) + 1) % k.length]; settingsChanged(); });
$('clear-hist').addEventListener('click', () => sheet(null, [['Clear history', clearHistory]]));

// ═════════════════════════════════════════════════════════ energy tools
class EnergyView {
  constructor(root) { this.root = root; this.tool = null; this.fields = []; this.texts = {}; this.outs = {}; this.reliable = null; this.timer = 0; this.delay = PREVIEW_MIN; }
  list() {
    this.tool = null; this.pending = null; this.fields = [];
    const box = h('div', 'list');
    const GI = { Power: 'sine', 'Per unit': 'pu', 'Circuits and lines': 'resistor', Machines: 'motor', Faults: 'fault' };
    for (const [g, tools] of N.GROUPS) {
      const gh = h('div', 'group'); if (GI[g]) gh.appendChild(icon(GI[g])); gh.appendChild(h('span', null, g));
      box.appendChild(gh);
      for (const t of tools) {
        const b = h('button', 'tool'); b.append(h('b', null, t.title), h('span', null, t.desc));
        b.addEventListener('click', () => show('energy', t.id));
        box.appendChild(b);
      }
    }
    const ref = h('button', 'tool'); ref.append(h('b', null, 'Typeable functions'), h('span', null, 's3, pf, zbase, pu, y2d, seq… — the same formulas, typed in the calculator.'));
    ref.addEventListener('click', () => show('help', 'energy'));
    const rh = h('div', 'group'); rh.append(icon('help'), h('span', null, 'Reference'));
    box.append(rh, ref);
    this.root.replaceChildren(box); this.root.scrollTop = 0;
    activate(null); setTitle(); updatePad();
  }
  open(tool) {
    if (!tool.fn) {                                    // formula module not loaded yet: load, then reopen
      this.pending = tool;
      this.root.replaceChildren(h('div', 'hint pad16', 'Loading…'));
      N.ready(tool).then(() => { if (this.pending === tool) this.open(tool); },
        () => { if (this.pending === tool) this.root.replaceChildren(h('div', 'hint pad16', "This tool couldn't be loaded. Open the app once while online.")); });
      return;
    }
    this.pending = null; this.tool = tool;
    const page = h('div', 'page');
    const back = h('button', 'back'); back.append(icon('left'), h('span', null, 'Energy tools')); back.addEventListener('click', () => this.close());
    const desc = h('p', 'desc', tool.desc);
    page.append(back, h('h2', null, tool.title), desc);
    if (tool.desc.length > 150) {                      // long descriptions: two lines, so the inputs stay above the keypad
      desc.classList.add('clamp');
      const more = h('button', 'more', 'More'); more.addEventListener('click', () => { const c = desc.classList.toggle('clamp'); more.textContent = c ? 'More' : 'Less'; });
      page.appendChild(more);
    }
    const grid = h('div', 'fields'), saved = this.texts[tool.id] || {};
    this.fields = []; this.sel = {};
    for (const f of tool.fields) {
      if (f.choice) {
        const v = f.options.some(o => o[0] === saved[f.key]) ? saved[f.key] : f.default;
        this.sel[f.key] = v;
        grid.append(h('label', null, f.label), segmented(f.options, v, x => { this.sel[f.key] = x; this.compute(); }));
        continue;
      }
      const lab = h('label', null, f.label); if (f.optional && !f.list) lab.appendChild(h('small', null, 'optional'));
      const ed = new Editor(h('div'), () => this.schedule());
      ed.key = f.key; ed.set(saved[f.key] ?? f.default);
      grid.append(lab, ed.el, h('span', 'unit', f.unit));
      this.fields.push(ed);
    }
    this.res = h('div', 'results');
    onTap(this.res, t => { const o = this.outAt(t); if (o) ctx.useValue(o.key, o.value); }, t => {
      const o = this.outAt(t); if (!o) return;
      const shown = N.formatOut(o, st.unit, st.digits, st.notation)[0];
      sheet(o.label, [[`Use in calculator as ${o.key}`, () => ctx.useValue(o.key, o.value)], ['Copy', () => copy(shown)],
        ['Copy full precision', () => copy(E.fullPrecision(o.value, st.unit, this.reliable))]]);
    });
    page.append(grid, this.res);
    this.root.replaceChildren(page); this.root.scrollTop = 0;
    activate(this.fields.find(e => !e.text) || this.fields[0]);
    setTitle();
    this.compute();
  }
  close() { clearTimeout(this.timer); this.list(); }
  focus() { if (this.tool) activate(this.fields.includes(activeEditor()) ? activeEditor() : this.fields[0]); }
  next(ed) { const i = this.fields.indexOf(ed); activate(this.fields[(i + 1) % this.fields.length]); this.compute(); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.compute(), this.delay); }
  compute() {
    clearTimeout(this.timer);
    if (!this.tool) return;
    const texts = { ...this.sel, ...Object.fromEntries(this.fields.map(e => [e.key, e.text])) };
    this.texts[this.tool.id] = texts;
    const box = this.res, t0 = performance.now();
    box.replaceChildren(); this.outs = {};
    try {
      const { outs, reliable } = N.compute(eng, this.tool, texts);
      this.reliable = reliable;
      const sig = sigOf(reliable), cells = [];
      for (const o of outs) {
        this.outs[o.key] = o;
        if (o.row) { cells.push(o); continue; }
        if (o.head) box.appendChild(h('div', 'rh', o.head));
        const row = h('div', 'res'); row.dataset.key = o.key;
        const v = h('div', 'v');
        N.formatOut(o, st.unit, sig, st.notation).forEach((line, k) => {
          const dd = h('div', k ? 'alt' : null, line);
          if (!k && o.note) dd.appendChild(h('span', 'note', o.note));
          v.appendChild(dd);
        });
        row.append(h('div', 'rk', o.label), v);
        box.appendChild(row);
      }
      if (cells.length) box.appendChild(this.table(cells, Math.min(sig, 6)));
      if (reliable && reliable < st.digits) box.appendChild(h('div', 'msg', `≈ only ${reliable} digits could be verified`));
      box.appendChild(h('div', 'msg', 'Tap a result to use it in the calculator.'));
    } catch (ex) {
      if (ex instanceof N.Incomplete) box.appendChild(h('div', 'msg', 'Enter ' + ex.labels.join(', ') + '.'));
      else box.appendChild(h('div', 'msg err', ex.msg || "These values can't be evaluated."));
    }
    this.delay = Math.round(Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, 3 * (performance.now() - t0))));
  }
  outAt(t) { const el = t.closest('[data-key]'); return el ? this.outs[el.dataset.key] : null; }
  /** Table outputs: one row per `row` index, columns in first-seen order; a missing cell shows —. */
  table(cells, sig) {
    const cols = [], rows = new Map();
    for (const o of cells) {
      if (!cols.some(c => c.label === o.label)) cols.push(o);
      if (!rows.has(o.row)) rows.set(o.row, {});
      rows.get(o.row)[o.label] = o;
    }
    const tb = h('table'), hr = h('tr');
    for (const c of cols) { const th = h('th', null, c.label); if (c.unit) th.appendChild(h('small', null, c.unit)); hr.appendChild(th); }
    tb.appendChild(hr);
    for (const r of rows.values()) {
      const tr = h('tr');
      for (const c of cols) {
        const o = r[c.label], td = h('td', null, o ? N.formatOut({ ...o, unit: '' }, st.unit, sig, st.notation)[0] : '—');
        if (o) td.dataset.key = o.key;
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    const wrap = h('div', 'rtab'); wrap.appendChild(tb);
    return wrap;
  }
}

// ═════════════════════════════════════════════════════════ profile, onboarding, Focus countdown
function nameInput(value) {
  const i = h('input', 'ninput'); i.type = 'text'; i.maxLength = 20; i.value = value || '';
  i.autocomplete = 'off'; i.setAttribute('autocorrect', 'off'); i.spellcheck = false; i.enterKeyHint = 'done';
  return i;
}
function renderProfile() {
  const p = Pr.get(), root = $('v-profile');
  if (!p) { root.replaceChildren(); return; }
  const L = Pr.levelOf(p.xp), a = Pr.levelStart(L), b = Pr.levelStart(L + 1);
  const box = h('div', 'prof'), bar = h('div', 'fbar'), fill = h('div'); fill.style.transform = `scaleX(${(p.xp - a) / (b - a)})`; bar.appendChild(fill);
  const who = h('div', 'pname'); who.append(document.createTextNode(p.name), h('span', 'ptag', ` #${p.tag}`));
  const inp = nameInput(p.name), err = h('div', 'mini perr');
  const saveName = () => { const e = Pr.rename(inp.value); err.textContent = e || ''; if (!e) { inp.blur(); toast('Name saved'); renderProfile(); } };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } });
  const sv = h('button', 'btn accent', 'Save name'); sv.addEventListener('click', saveName);
  const row = h('div', 'nrow'); row.append(inp, sv);
  const rs = h('button', 'btn wide2 dangerb', 'Reset profile');
  rs.addEventListener('click', () => sheet('Delete your name, tag and XP from this device?', [['Reset profile', () => { Pr.reset(); onboard(); }]]));
  box.append(who, h('div', 'plevel', `Level ${L}`), bar, h('div', 'mini', `${p.xp - a} / ${b - a} XP to level ${L + 1} · ${p.xp} XP in total`),
    h('div', 'fh', 'Name'), row, err, h('div', 'mini', `${Pr.NAME_RULE}. Shown in the chat with your tag and level.`), rs);
  root.replaceChildren(box);
}
function onboard() {
  const ov = h('div', 'onb'), card = h('div', 'onbcard');
  const inp = nameInput(''), err = h('div', 'mini perr'), go = h('button', 'btn accent big', 'Continue');
  inp.placeholder = 'Your name';
  card.append(h('h2', null, 'Welcome to EE Calc'), h('p', 'mini', 'Choose a name. It is shown in the chat and kept only on this device.'), inp, err, go,
    h('p', 'mini', Pr.NAME_RULE + '.'));
  ov.appendChild(card); document.body.appendChild(ov);
  const done = () => {
    const e = Pr.create(inp.value); err.textContent = e || '';
    if (e) return;
    inp.blur(); ov.remove(); toast(`Welcome, ${Pr.get().name}`);
    if (st.view === 'profile') renderProfile();
  };
  go.addEventListener('click', done);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
  setTimeout(() => inp.focus(), 50);
}
let chimeCtx = null;
function chime() {                                   // two soft sine tones; silent if audio isn't unlocked yet
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (mediaMod && mediaMod.player.ctx) || chimeCtx || (chimeCtx = new AC());
    // the player suspends its context when nothing plays: wake it (allowed once it has been unlocked by a tap)
    if (c.state !== 'running') { c.resume().then(() => { if (c.state === 'running') { tones(c); if (mediaMod && c === mediaMod.player.ctx) mediaMod.player.idle(); } }, () => {}); return; }
    tones(c);
  } catch { /* no audio: the toast is enough */ }
}
function tones(c) {
  try {
    [[660, 0], [880, 0.18]].forEach(([f, t]) => {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + t;
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5); o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 0.55);
    });
  } catch { /* no audio: the toast is enough */ }
}
function updatePomo() {
  const left = Pr.remaining(), b = $('pomo'), r = Pr.get() && Pr.get().run;
  b.hidden = left == null && !(r && r.pending);
  if (!b.hidden) {
    const t = left != null ? Pr.fmtTime(left) + (r.left != null ? ' ❚❚' : '') : 'Next';
    if (b.textContent !== t) b.textContent = t;
    b.classList.toggle('brk', !!r && r.ph !== 'focus');
    b.setAttribute('aria-label', left != null ? `Focus timer: ${Pr.fmtTime(left)}${r.left != null ? ', paused' : ''}` : 'Focus timer: start the next phase');
  }
}
Pr.onChange(w => {
  if (w === 'tick' || w === 'run' || w === 'reset' || w === 'profile' || (w && w.done)) updatePomo();
  if (w && w.done) {
    const was = w.done === 'focus' ? 'Focus session complete' : 'Break over';
    if (document.visibilityState === 'visible') chime();
    toast(was);
  }
  if (w && w.xp && w.why !== 'use') setTimeout(() => toast(`+${w.xp} XP` + (w.up ? ` · Level ${w.level}!` : '')), 1600);
  else if (w && w.up) toast(`Level ${w.level}!`);
  if (w && (w.xp || w === 'profile') && st.view === 'profile') renderProfile();
});
$('pomo').addEventListener('click', () => show('focus'));

// ═════════════════════════════════════════════════════════ variables and help
function renderVars() {
  const root = $('v-vars'), box = h('div', 'vars');
  const names = [...eng.vars.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (!names.length) { const d = h('div', 'hint'); d.innerHTML = 'No variables yet.\n\nAssign one in the calculator:\n<code>Z1 = 3 + j4</code>'; box.appendChild(d); }
  for (const n of names) {
    const v = eng.vars.get(n), d = h('div', 'var'); d.dataset.name = n;
    d.appendChild(h('b', null, n));
    let lines = fmt(v);
    if (E.isM(v)) lines = [[`${v.rows}×${v.cols} matrix`, 'main'], ...lines.filter(l => l[1] === 'main').slice(0, 12)];
    for (const [t, role] of lines) d.appendChild(h('div', role === 'alt' ? 'alt' : null, t));
    box.appendChild(d);
  }
  if (names.length) {
    const b = h('button', 'wide', 'Clear all variables');
    b.addEventListener('click', () => sheet(null, [['Clear all variables', () => { eng.clearVars(); renderVars(); }]]));
    box.appendChild(b);
  }
  root.replaceChildren(box);
  onTap(box, t => { const d = t.closest('.var'); if (d) { show('calc'); main.insert(d.dataset.name); } }, t => {
    const d = t.closest('.var'); if (!d) return;
    const n = d.dataset.name;
    sheet(n, [['Insert', () => { show('calc'); main.insert(n); }], ['Copy full precision', () => copy(E.fullPrecision(eng.vars.get(n), st.unit))],
      [`Delete ${n}`, () => { eng.delVar(n); renderVars(); }]]);
  });
}
const HELP = [
  ['calc', 'Keypad', `=        evaluate (in a tool: next field)
⌫        delete · hold to clear the line
◀ ▶      move the cursor · or tap in the line
fn       one-shot page of functions and SI prefixes
more…    every function and symbol
abc      letters keyboard (variable names)
☰        menu: calculator, energy tools, network, chat…
Settings: tap Degrees · digits · Normal`],
  ['', 'Numbers', `34,5   0,5   1.5      decimal comma (a point also works)
1,5e-3  (EE key)      exponent
4,7k  100n  10µ  3M   SI prefixes  p n µ(u) m k M G T
4k7   2M2             RKM code: 4k7 = 4,7k
j4   4j   3+j4        imaginary unit j`],
  ['', 'Phasors', `34,5∠98              polar (∠ key)
34,5 fase(98°)       same: fase(θ) = 1∠θ
63∠3 rad   10∠-30°   an explicit unit overrides the default
10∠(2π/3)            an angle expression needs parentheses`],
  ['', 'Operators (low → high)', `+ -    //  (parallel: Z1·Z2/(Z1+Z2))    * /  \\ (A\\b solves A·x = b)
implicit product (2π, 3(1+j), jZ1)    -x    ∠    ^    ² ³ ° rad
1/2π = 1/(2π)     10∠30/2 = (10∠30)/2
A line starting with * / ^ // continues from ans.`],
  ['', 'Names', `Z1 = 3 + j4          assign (names are case-sensitive)
ans                  last result
pi π e j a           a = 1∠120° (Fortescue)
c0 mu0 eps0          CODATA 2022
Commands: clear · clearvars · del Z1 · vars · help`],
  ['', 'Functions', `abs ang re im conj fase polar(r;θ) rect(x;y)
sqrt √ root(x;n) exp ln log(base 10) log(x;b) log2
sin cos tan (angle-aware; complex args in rad) asin acos atan atan2(y;x)
sinh cosh tanh asinh acosh atanh     round(x;n)
Separate arguments with ;  — the comma is decimal.`],
  ['energy', 'Energy systems (typeable)', N.REFERENCE.split('\n').map(l => l.replace(/^ {2}/, '')).join('\n')],
  ['', 'Matrices', `[1 | 2 ; 3 | 4]      | columns, ; rows
Y(2;3)  Y(2)         element / row
inv det transp herm solve(A;b) eye(n) zeros(m;n) diag(…)   up to 30×30`],
  ['net', 'Network (power systems)', `Case editor: tables of buses, generators and branches (up to 50 buses),
MATPOWER conventions: impedances in pu on the system base, B = total line
charging, tap and phase shift on the "from" side, loads in MW / Mvar.
Cells accept numbers, expressions or calculator variables.
Open imports EE Calc case files and MATPOWER .m cases.
A case is not kept unless you save it (Save → Save to Files).

Power flow: Newton-Raphson, fast decoupled (XB), Gauss-Seidel or DC,
following MATPOWER's formulation (iteration log for hand checks). Q limits:
a PV bus whose generators reach a limit becomes PQ (the slack is not
switched; a slack outside its limits is reported). Results are refined and
verified at 50 and 80 digits like every other result.

Short circuit: three-phase, SLG (phase a), LL and LLG (phases b–c) at any
bus, with fault impedance. Generators: X″d, X2 (default X″d), X0 and
neutral (Xn, 0 = solid), pu on the system base. Zero sequence of branches:
line (R0, X0, B0), YNyn (series), YNd (shunt at the from bus), Dyn (shunt at
the to bus), Yd / Dy / Dd / Yy (open). Prefault: flat 1,0 pu (classical:
no loads, no charging) or from the power flow (loads as constant impedance,
positive and negative sequence only). Across Δ–Y transformers the phase
voltages include the ±30° shift (clock 11: Dyn11, YNd11), unless the
branch has its own phase shift.

Contingency (N-1): every branch and generator outage is solved and
verified, then ranked by islanding, divergence, violations and loading.
Examples: MATPOWER test cases (BSD licence).`],
  ['', 'Focus', `A Pomodoro timer: focus sessions (25 min), short breaks (5 min) and a long
break (15 min) after 4 sessions; all adjustable. XP: 2 per focus minute and
1 per break minute when a session completes (stopping or skipping earns
nothing), +25 per full set, and 1 per 2 minutes using the app. Level L → L+1
needs 100·L XP. The timer keeps running if you leave the app.
Durations: below the timer, when no phase is running.`],
  ['', 'Media', `☰ → Media: radio stations from several countries (filter by country),
lofi streams and LibriVox audiobooks (public domain, streamed from the
Internet Archive; browse by category or search by title or author).
Everything needs internet. Playing is independent of Focus: it continues
until you pause or stop it. On the other screens, the round button at the
top right opens the player. Audiobooks remember the chapter and position
where you stopped. If a station doesn't allow volume control, use the
device buttons.`],
  ['', 'Chat', `A global public room: anyone using EE Calc can read and write. Text and
emoji only: no files, images or links. Messages are relayed by a free
public MQTT server and exist only while delivered. Your name, device tag
(#…) and level are shown with each message; anyone can pick any name, so
the tag tells devices apart. The chat is locked when you are offline and
disconnects when the app is closed.`],
  ['', 'Precision', `Every result is computed at 50 and at 80 significant digits and
shown only when both agree to 42 digits. If they don't, precision
rises automatically to 140, 260 and 500 digits. Display: 6–40
digits, rounded half up (2,5 → 3).`],
  ['', 'Privacy', `Only your profile is kept on this device: name, tag, XP, Focus settings,
a running Focus session, the player's volume and last station, and your
audiobook position. Profile → Reset deletes it.
No cookies. History, variables and cases are erased when you close the
app. Only the app's own files and station logos are cached, so it works
offline. Only the chat and the player use the network.`],
];
let helpBuilt = false;
/** Help text -> paragraphs, and two-column lines ("syntax   meaning") -> a definition grid that wraps cleanly. */
function helpBlocks(body) {
  const out = []; let dl = null, para = [];
  const flush = () => { if (para.length) { out.push(h('p', null, para.join('\n'))); para = []; } };
  for (const line of body.split('\n')) {
    const m = /^(\S.*?)\s{3,}(\S.*)$/.exec(line);
    if (m) { flush(); if (!dl) { dl = h('dl'); out.push(dl); } dl.append(h('dt', null, m[1]), h('dd', null, m[2])); }
    else { dl = null; if (line.trim()) para.push(line.trim()); else flush(); }
  }
  flush();
  return out;
}
function renderHelp(anchor) {
  const root = $('v-help');
  if (!helpBuilt) {
    const box = h('div', 'help');
    for (const [id, title, body] of HELP) { const t = h('h3', null, title); if (id) t.id = 'help-' + id; box.append(t, ...helpBlocks(body)); }
    root.appendChild(box);
    helpBuilt = true;
  }
  const target = anchor && document.getElementById('help-' + anchor);
  root.scrollTop = target ? target.offsetTop - 8 : 0;
}

// ═════════════════════════════════════════════════════════ start
renderPad();
refreshBar();
renderHistory();
main.render();
setTitle();
if (!Pr.load()) onboard();
Pr.init(); updatePomo();
if (!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) {
  $('install').hidden = false;
  $('install-x').addEventListener('click', () => { $('install').hidden = true; });
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js');
window.__eecalc = { E, N, eng, main, key, show, st, items, ctx, get energy() { return energy; }, get net() { return netMod; }, get chat() { return chatMod; }, get focus() { return focusMod; }, get media() { return mediaMod; } };
