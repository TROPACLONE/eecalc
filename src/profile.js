/*
 EE Calc — profile, XP / levels and the Pomodoro engine.
 The profile is the ONLY thing the app keeps on the device (one localStorage entry, KEY below): name,
 device tag, XP, Focus settings, radio choice and a running Focus/break session (so it survives iOS
 closing the app in the background). Everything else stays in RAM. "Reset profile" deletes the entry.

 XP: 2 per focused minute and 1 per break minute, credited when a session completes (a stopped or skipped
 session earns nothing); +25 for completing a full set of focus sessions; 1 per 2 minutes of foreground use.
 Level L → L+1 needs 100·L XP, i.e. level L starts at 50·L·(L − 1) XP.
*/
const KEY = 'eecalc.profile';
export const NAME_RULE = '3–20 letters, digits, _ or -';
const NAME_OK = /^[\p{L}\p{N}_-]{3,20}$/u;
export const LIMITS = { focus: [5, 90], short: [1, 30], long: [5, 60], every: [2, 8] };
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4 };
export const XP = { focusMin: 2, breakMin: 1, setBonus: 25, useSec: 120 };

export const checkName = n => (NAME_OK.test(n.trim()) ? null : `Name: ${NAME_RULE}`);
export const levelOf = xp => {                  // largest L with 50·L·(L − 1) ≤ xp (closed form, then exact integer fix-up)
  let L = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  while (L > 1 && 50 * L * (L - 1) > xp) L--;
  while (50 * (L + 1) * L <= xp) L++;
  return L;
};
export const levelStart = L => 50 * L * (L - 1);

let P = null;                                   // the profile (null until the user picks a name)
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = what => { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } };

const int = (v, [lo, hi], d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
function sanitize(o) {                          // never trust what is on disk
  if (!o || typeof o !== 'object' || checkName(String(o.name || '')) || !/^[0-9a-f]{4}$/.test(o.tag)) return null;
  const s = o.pomo || {};
  const run = o.run && ['focus', 'short', 'long'].includes(o.run.ph) ? {
    ph: o.run.ph, mins: int(o.run.mins, [1, 90], 25),
    end: Number.isFinite(o.run.end) ? o.run.end : null, left: Number.isFinite(o.run.left) ? o.run.left : null,
    pending: !!o.run.pending } : null;
  return { v: 1, name: o.name.trim(), tag: o.tag, xp: int(o.xp, [0, 1e9], 0),
    pomo: Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, int(s[k], LIMITS[k], DEFAULTS[k])])),
    set: int(o.set, [0, 7], 0), radio: { st: ['off', 'observador', 'rfm', 'comercial'].includes(o.radio?.st) ? o.radio.st : 'rfm',
      vol: int(o.radio?.vol, [0, 100], 60) }, run };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* storage full or disabled: keep going in RAM */ } }

export function load() {
  try { P = sanitize(JSON.parse(localStorage.getItem(KEY))); } catch { P = null; }
  return P;
}
export const get = () => P;
export function create(name) {
  const e = checkName(name); if (e) return e;
  const b = crypto.getRandomValues(new Uint8Array(2));
  P = sanitize({ name, tag: [...b].map(x => x.toString(16).padStart(2, '0')).join(''), xp: 0 });
  save(); emit('profile'); return null;
}
export function rename(name) { const e = checkName(name); if (e) return e; P.name = name.trim(); save(); emit('profile'); return null; }
export function reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } P = null; emit('reset'); }
export function setPomo(k, v) { P.pomo[k] = int(v, LIMITS[k], P.pomo[k]); save(); emit('pomo'); }
export function setRadio(r) { Object.assign(P.radio, r); save(); emit('radio'); }

export function addXP(n, why) {
  if (!P || !(n > 0)) return;
  const before = levelOf(P.xp);
  P.xp += n; save();
  emit({ xp: n, why, level: levelOf(P.xp), up: levelOf(P.xp) > before });
}

// ── foreground use: 1 XP per 2 minutes the app is visible ────────────────────────────────────────
let useMs = 0, since = 0, useTimer = 0;
function useTick() {
  const now = performance.now(); useMs += now - since; since = now;
  const n = Math.floor(useMs / (XP.useSec * 1000));
  if (n > 0) { useMs -= n * XP.useSec * 1000; addXP(n, 'use'); }
}
function useVisibility() {
  if (document.visibilityState === 'visible') { since = performance.now(); clearInterval(useTimer); useTimer = setInterval(useTick, 30000); }
  else { if (since) useTick(); clearInterval(useTimer); useTimer = 0; since = 0; }
}

// ── Pomodoro: a phase is running (end), paused (left) or waiting to be started (pending) ────────────
export const phaseMins = ph => P.pomo[ph === 'focus' ? 'focus' : ph];
export function start(ph = P.run?.ph || 'focus') {
  const mins = phaseMins(ph);
  P.run = { ph, mins, end: Date.now() + mins * 60000, left: null, pending: false };
  save(); emit('run');
}
export function pause() { const r = P.run; if (!r || !r.end) return; r.left = Math.max(0, r.end - Date.now()); r.end = null; save(); emit('run'); }
export function resume() { const r = P.run; if (!r || r.left == null) return; r.end = Date.now() + r.left; r.left = null; save(); emit('run'); }
/** Stop (no XP). A stopped focus session keeps the set count; the next phase offered is focus. */
export function stop() { P.run = null; save(); emit('run'); }
/** Skip the current phase without XP and offer the next one. */
export function skip() { if (P.run) { P.run = { ph: P.run.ph === 'focus' ? 'short' : 'focus', pending: true }; save(); emit('run'); } }
export function remaining() {
  const r = P && P.run; if (!r || r.pending) return null;
  return r.end != null ? Math.max(0, r.end - Date.now()) : r.left;
}
/** Completes a phase whose end time has passed (also after the app was closed). -> the finished phase or null. */
export function check() {
  const r = P && P.run;
  if (!r || r.pending || r.end == null || Date.now() < r.end) return null;
  if (r.ph === 'focus') {
    P.set += 1;
    const full = P.set >= P.pomo.every;
    addXP(XP.focusMin * r.mins + (full ? XP.setBonus : 0), full ? 'set' : 'focus');
    P.run = { ph: full ? 'long' : 'short', pending: true };
    if (full) P.set = 0;
  } else {
    addXP(XP.breakMin * r.mins, 'break');
    P.run = { ph: 'focus', pending: true };
  }
  save(); emit({ done: r.ph });
  return r.ph;
}

let tick = 0, endTimer = 0;
function pomoTimer() {
  clearInterval(tick); clearTimeout(endTimer); tick = endTimer = 0;
  const r = P && P.run;
  if (!r || r.pending || r.end == null) return;
  // one-shot at the phase end: also fires in the background whenever iOS runs JS (e.g. while the radio plays),
  // so the radio stops on time; the 1-Hz display tick runs only while the app is visible
  endTimer = setTimeout(() => { check(); pomoTimer(); }, Math.max(0, r.end - Date.now()) + 50);
  if (document.visibilityState === 'visible') tick = setInterval(() => { check(); emit('tick'); }, 1000);
}
onChange(w => { if (w === 'run' || w === 'reset' || (w && w.done)) pomoTimer(); });

export function init() {
  document.addEventListener('visibilitychange', () => { useVisibility(); if (document.visibilityState === 'visible') check(); pomoTimer(); });
  useVisibility(); check(); pomoTimer();
}
export const fmtTime = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const label = () => (P ? `${P.name} #${P.tag}` : '');
