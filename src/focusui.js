/*
 EE Calc — Focus screen (Pomodoro) with the player (loaded on first use).
 The timer and the player are independent: media keeps playing across phases until it is paused or stopped.
 The player bar is docked at the bottom of this screen; elsewhere the top-right bubble opens the same controls.
*/
import * as Pr from './profile.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';
import { player } from './media.js';
import { browser, bar } from './mediaui.js';

export function init(ctx, root) {
  const P = Pr.get;
  const clock = h('div', 'fclock'), phase = h('div', 'fphase'), pbar = h('div', 'fbar'), fill = h('div');
  pbar.appendChild(fill);
  const acts = h('div', 'facts'), xp = h('div', 'mini fxp'), media = h('div', 'fmedia');
  const setBtn = h('button', 'iconbtn fsetbtn'); setBtn.appendChild(icon('sliders')); setBtn.setAttribute('aria-label', 'Timer settings');
  setBtn.addEventListener('click', openSettings);
  const timer = h('div', 'ftimer'); timer.append(setBtn, clock, phase, pbar);
  const wrap = h('div', 'fwrap'); wrap.append(timer, acts, xp, h('div', 'fh', 'Listen'), media);
  const scroll = h('div', 'fscroll scroll'); scroll.appendChild(wrap);
  const dock = h('div', 'fdock'); dock.appendChild(bar());
  root.replaceChildren(scroll, dock);
  browser(media);

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
  function renderClock() {
    const r = P().run, left = Pr.remaining();
    const total = r && !r.pending ? r.mins * 60000 : Pr.phaseMins(r ? r.ph : 'focus') * 60000;
    clock.textContent = Pr.fmtTime(left ?? total);
    const name = !r || r.ph === 'focus' ? 'Focus' : r.ph === 'long' ? 'Long break' : 'Break';
    const n = P().set + (r && r.ph === 'focus' && !r.pending ? 1 : 0);
    phase.textContent = `${name} · ${r && r.ph !== 'focus' ? 'rest' : `session ${Math.max(1, n)} of ${P().pomo.every}`}${r && r.left != null ? ' · paused' : ''}`;
    fill.style.width = `${left == null ? 0 : 100 * (1 - left / total)}%`;
    clock.classList.toggle('run', !!(r && !r.pending && r.end != null));
  }
  function renderXP() {
    const p = P(), L = Pr.levelOf(p.xp), a = Pr.levelStart(L), b = Pr.levelStart(L + 1);
    xp.textContent = `Level ${L} · ${p.xp - a} / ${b - a} XP to level ${L + 1}`;
  }
  // durations: in a sheet, so the screen stays calm; they can't change while a phase runs
  let sets = null;
  function openSettings() {
    sheet('Timer', [], box => {
      sets = h('div', 'fsets'); box.appendChild(sets); renderSets();
      box.appendChild(h('div', 'mini fxp', `${Pr.XP.focusMin} XP per focus minute, ${Pr.XP.breakMin} per break minute, ` +
        `+${Pr.XP.setBonus} per full set, 1 per 2 minutes in the app.`));
    });
  }
  function renderSets() {
    if (!sets || !sets.isConnected) { sets = null; return; }
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
  Pr.onChange(w => {
    if (w === 'tick') { if (visible) renderClock(); return; }
    if (w === 'reset') { player.stop(); return; }
    if (w === 'media') return;
    if (visible) all(); else renderSets();
  });
  let visible = false;
  return {
    show() { visible = true; all(); },
    hide() { visible = false; },
    player,
  };
}
