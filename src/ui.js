/* EE Calc — shared interface helpers (used by the calculator, network and chat screens). */
export const $ = id => document.getElementById(id);
export const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
export const LONG_PRESS = 480;

// ═════════════════════════════════════════════════════════ editor (custom caret, no system keyboard)
let active = null;
export const activeEditor = () => active;
export function activate(ed) {
  if (active === ed) return;
  if (active) active.el.classList.remove('active');
  active = ed;
  if (ed) ed.el.classList.add('active');
  document.dispatchEvent(new CustomEvent('editor-change'));
}
export class Editor {
  constructor(el, onChange) {
    this.el = el; this.text = ''; this.caret = 0; this.onChange = onChange;
    this.pre = document.createTextNode(''); this.cur = h('span', 'caret'); this.post = document.createTextNode('');
    el.classList.add('editor');
    el.replaceChildren(this.pre, this.cur, this.post);
    el.addEventListener('pointerdown', e => { e.preventDefault(); activate(this); this.caretFromPoint(e.clientX, e.clientY); });
  }
  set(text, caret = text.length) { this.text = text; this.caret = Math.max(0, Math.min(caret, text.length)); this.render(); this.changed(); }
  insert(s) { this.text = this.text.slice(0, this.caret) + s + this.text.slice(this.caret); this.caret += s.length; this.render(); this.changed(); }
  back() { if (this.caret > 0) { this.text = this.text.slice(0, this.caret - 1) + this.text.slice(this.caret); this.caret--; this.render(); this.changed(); } }
  del() { if (this.caret < this.text.length) { this.text = this.text.slice(0, this.caret) + this.text.slice(this.caret + 1); this.render(); this.changed(); } }
  move(d) { this.caret = Math.max(0, Math.min(this.text.length, this.caret + d)); this.render(); }
  home() { this.caret = 0; this.render(); }
  end() { this.caret = this.text.length; this.render(); }
  clear() { this.set(''); }
  changed() { if (this.onChange) this.onChange(this); }
  render() {
    this.pre.data = this.text.slice(0, this.caret);
    this.post.data = this.text.slice(this.caret);
    // restart the short blink: a new animation name restarts it without forcing a layout (blink and blink2 are identical)
    this.cur.style.animationName = (this.blinkB = !this.blinkB) ? 'blink2' : 'blink';
    // keep the caret in view: measured once per frame, in the frame's own layout, not right after every edit
    if (!this.inView) { this.inView = true; requestAnimationFrame(() => { this.inView = false; this.scrollToCaret(); }); }
  }
  scrollToCaret() {
    const el = this.el, w = el.clientWidth;
    if (!w || (el.scrollLeft === 0 && el.scrollWidth <= w)) return;            // hidden, or everything fits
    const x = this.cur.offsetLeft;
    if (x < el.scrollLeft + 8) el.scrollLeft = Math.max(0, x - 24);
    else if (x > el.scrollLeft + w - 16) el.scrollLeft = x - w + 32;
  }
  caretFromPoint(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    let pos = this.text.length;
    if (r && r.startContainer === this.pre) pos = r.startOffset;
    else if (r && r.startContainer === this.post) pos = this.pre.data.length + r.startOffset;
    else { const rc = this.el.getBoundingClientRect(); pos = x < rc.left + 16 && this.el.scrollLeft === 0 ? 0 : this.text.length; }
    this.caret = Math.max(0, Math.min(pos, this.text.length));
    this.render();
  }
}

// ═════════════════════════════════════════════════════════ gestures, sheets, toast, clipboard
export function onTap(el, tap, hold) {
  let timer = 0, start = null, held = false;
  el.addEventListener('pointerdown', e => {
    start = { x: e.clientX, y: e.clientY, t: e.target }; held = false;
    timer = setTimeout(() => { held = true; if (hold) hold(start.t); }, LONG_PRESS);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { clearTimeout(timer); start = null; } });
  el.addEventListener('pointerup', () => { clearTimeout(timer); if (start && !held) tap(start.t); start = null; });
  el.addEventListener('pointercancel', () => { clearTimeout(timer); start = null; });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
/** Bottom sheet: optional title, custom content builder, actions [label, fn, cls?]. */
export function sheet(title, actions, build) {
  const s = $('sheet'), box = h('div', 'box');
  if (title) box.appendChild(h('h4', null, title));
  if (build) build(box);
  for (const a of actions.filter(Boolean)) {
    const b = h('button', 'act' + (a[2] ? ' ' + a[2] : ''), a[0]);
    b.addEventListener('click', () => { closeSheet(); a[1](); });
    box.appendChild(b);
  }
  const cancel = h('button', 'act muted', actions.length || !build ? 'Cancel' : 'Close');
  cancel.addEventListener('click', closeSheet); box.appendChild(cancel);
  s.replaceChildren(box); s.hidden = false;
  return box;
}
export function closeSheet() { $('sheet').hidden = true; $('sheet').replaceChildren(); }
let toastTimer = 0;
export function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1600); }
export function copy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy not allowed'));
  else toast('Copy not available');
}
/** Segmented control: options [[value, label]], current value, onChange. */
export function segmented(options, value, onChange) {
  const box = h('div', 'seg');
  for (const [v, label] of options) {
    const b = h('button', v === value ? 'on' : null, label);
    b.addEventListener('click', () => { box.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); });
    box.appendChild(b);
  }
  return box;
}

// ═════════════════════════════════════════════════════════ files: save through the share sheet, open from Files
export async function saveFile(name, text, type = 'application/json') {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file), a = h('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
export function openFile(accept) {
  return new Promise(resolve => {
    const inp = h('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.addEventListener('cancel', () => { inp.remove(); resolve(null); });     // picker dismissed: nothing left behind
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) { resolve(null); return; }
      if (f.size > 2e6) { toast('File too large'); resolve(null); return; }
      f.text().then(text => resolve({ name: f.name, text }), () => resolve(null));
    });
    document.body.appendChild(inp); inp.click();
  });
}
