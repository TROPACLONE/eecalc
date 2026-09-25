/*
 EE Calc — Focus screen (Pomodoro), loaded on first use: the timer, its controls, XP and the durations.
 The player has its own screen (Media, in the menu); the two are independent.
*/
import * as Pr from './profile.js';
import { h, sheet } from './ui.js';

export function init(ctx, root) {
  const P = Pr.get;
  const clock = h('div', 'fclock'), phase = h('div', 'fphase'), pbar = h('div', 'fbar'), fill = h('div');
  pbar.appendChild(fill);
  const timer = h('div', 'ftimer'); timer.append(clock, phase, pbar);
  const acts = h('div', 'facts'), xp = h('div', 'mini fxp'), sets = h('div', 'fsets');
  const rules = h('div', 'mini fxp', `${Pr.XP.focusMin} XP per focus minute and ${Pr.XP.breakMin} per break minute when a phase ` +
    `completes, +${Pr.XP.setBonus} per full set, and 1 per 2 minutes in the app. Stopping or skipping earns nothing.`);
  const wrap = h('div', 'fwrap'); wrap.append(timer, acts, xp, h('div', 'fh', 'Timer'), sets, rules);
  const scroll = h('div', 'fscroll scroll'); scroll.appendChild(wrap);
  root.replaceChildren(scroll);

  const btn = (label, fn, cls = 'btn') => { const b = h('button', cls, label); b.addEventListener('click', fn); return b; };
  function renderActs() {
    const r = P().run, a = [];
    if (!r) a.push(btn('Start focus', () => Pr.start('focus'), 'btn accent big'));
    else if (r.pending) {
      const m = Pr.phaseMins(r.ph);
      a.push(btn(r.ph === 'focus' ? `Start focus (${m} min)` : `Start ${r.ph === 'long' ? 'long ' : ''}break (${m} min)`,
        () => Pr.start(r.ph), 'btn accent big'), btn('Skip', () => Pr.skip(), 'btn wide2'));
    } else if (r.end != null) a.push(btn('Pause', () => Pr.pause(), 'btn big'), btn('Stop (no XP)', confirmStop, 'btn wide2'));
    else a.push(btn('Resume', () => Pr.resume(), 'btn accent big'), btn('Stop (no XP)', confirmStop, 'btn wide2'));
    acts.replaceChildren(...a);
  }
  const confirmStop = () => sheet('Stop this session? It earns no XP.', [['Stop session', () => Pr.stop()]]);
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };   // the 1 Hz tick: no layout when nothing changed
  function renderClock() {
    const r = P().run, left = Pr.remaining();
    const total = r && !r.pending ? r.mins * 60000 : Pr.phaseMins(r ? r.ph : 'focus') * 60000;
    setText(clock, Pr.fmtTime(left ?? total));
    const name = !r || r.ph === 'focus' ? 'Focus' : r.ph === 'long' ? 'Long break' : 'Break';
    const n = Math.min(P().set + 1, P().pomo.every);      // the focus session that is running or comes next
    setText(phase, `${name} · ${r && r.ph !== 'focus' ? 'rest' : `session ${n} of ${P().pomo.every}`}${r && r.left != null ? ' · paused' : ''}`);
    fill.style.transform = `scaleX(${left == null ? 0 : (1 - left / total).toFixed(4)})`;
    clock.classList.toggle('run', !!(r && !r.pending && r.end != null));
  }
  function renderXP() {
    const p = P(), L = Pr.levelOf(p.xp), a = Pr.levelStart(L), b = Pr.levelStart(L + 1);
    xp.textContent = `Level ${L} · ${p.xp - a} / ${b - a} XP to level ${L + 1}`;
  }
  // durations: they can't change while a phase runs
  function renderSets() {
    const r = P().run, busy = r && !r.pending;
    const row = (k, label, unit) => {
      const d = k === 'every' || k === 'short' ? 1 : 5;
      const v = h('span', 'fval', `${P().pomo[k]} ${unit}`);
      const b1 = btn('−', () => Pr.setPomo(k, P().pomo[k] - d), 'btn fv'), b2 = btn('+', () => Pr.setPomo(k, P().pomo[k] + d), 'btn fv');
      b1.disabled = b2.disabled = busy;
      b1.setAttribute('aria-label', `${label} shorter`); b2.setAttribute('aria-label', `${label} longer`);
      const e = h('div', 'fset'); e.append(h('span', null, label), b1, v, b2); return e;
    };
    sets.replaceChildren(row('focus', 'Focus', 'min'), row('short', 'Break', 'min'), row('long', 'Long break', 'min'), row('every', 'Long break after', 'sessions'));
    if (busy) sets.appendChild(h('div', 'mini', 'Durations can be changed when no phase is running.'));
  }
  const all = () => { renderClock(); renderActs(); renderXP(); renderSets(); };
  let visible = false;
  Pr.onChange(w => {
    if (!visible || !P() || w === 'media') return;           // hidden: show() redraws everything; no profile: onboarding
    if (w === 'tick') renderClock(); else all();
  });
  return {
    show() { visible = true; if (P()) all(); },
    hide() { visible = false; },
  };
}
