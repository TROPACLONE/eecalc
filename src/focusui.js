/*
 EE Calc — Focus screen (Pomodoro) and radio (loaded on first use).
 The radio plays during focus only. Volume on iOS only works through Web Audio (HTMLMediaElement.volume is
 ignored there), and Web Audio needs the stream to allow cross-origin access (CORS) — otherwise WebKit plays
 silence. So each station is first tried through a GainNode; if it fails to load, or stays silent for 4 s,
 it is reopened directly (device volume buttons only) for the rest of the session.
*/
import * as Pr from './profile.js';
import { h, toast, segmented, sheet } from './ui.js';

export const STATIONS = globalThis.__EECALC_STATIONS || [
  { id: 'observador', name: 'Observador', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/OBSERVADORAAC.aac?dist=web-popup&devicename=aac' },
  { id: 'rfm', name: 'RFM', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RFMAAC.aac' },
  { id: 'comercial', name: 'Comercial', url: 'https://stream-hls.bauermedia.pt/comercial.aac/playlist.m3u8' },
];

class Radio {
  constructor(onState) { this.onState = onState; this.ctx = null; this.el = null; this.gain = null; this.noGain = new Set(); this.vol = 60; this.gen = 0; }
  level(v) { return (v / 100) ** 2; }                     // perceptual (≈ power) taper
  setVolume(v) {
    this.vol = v;
    if (this.gain) this.gain.gain.setTargetAtTime(this.level(v), this.ctx.currentTime, 0.05);
    else if (this.el) this.el.volume = v / 100;             // honoured on desktop, ignored on iOS
  }
  unlock() {                                              // call inside a tap: creates / resumes the audio context
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) this.ctx = new AC();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  play(st) {
    this.stop(false);
    if (!st || !st.url) { this.onState(st ? 'nourl' : 'off'); return; }
    this.st = st; this.open(!!this.ctx && !this.noGain.has(st.id));
  }
  /** Detaches the current element and nodes; -> a function that fully releases them (pause, unload, disconnect). */
  detach() {
    const el = this.el, nodes = this.nodes || [];
    this.el = null; this.gain = null; this.an = null; this.nodes = null;
    return () => {
      if (el) { el.pause(); el.removeAttribute('src'); el.load(); }       // also stops the download
      for (const nd of nodes) { try { nd.disconnect(); } catch { /* already disconnected */ } }
    };
  }
  open(withGain) {
    this.detach()();                                        // a failed previous attempt (fallback) is released first
    const gen = ++this.gen, st = this.st, el = new Audio();
    el.preload = 'none';
    if (withGain) el.crossOrigin = 'anonymous';
    this.el = el; this.gain = null; this.mode = withGain ? 'gain' : 'direct';
    const fallback = why => { if (gen !== this.gen) return; if (withGain) { this.noGain.add(st.id); this.open(false); } else this.onState('error', why); };
    el.addEventListener('error', () => fallback('load'));
    el.addEventListener('playing', () => {
      if (gen !== this.gen) return;
      this.onState(withGain ? 'playing' : 'direct');
      if (withGain) this.watchSilence(gen, fallback);
    });
    el.addEventListener('waiting', () => { if (gen === this.gen) this.onState('buffering'); });
    if (withGain) {
      const src = this.ctx.createMediaElementSource(el);
      this.gain = this.ctx.createGain(); this.gain.gain.value = this.level(this.vol);
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 512;
      src.connect(this.gain).connect(this.an).connect(this.ctx.destination);
      this.nodes = [src, this.gain, this.an];
    } else el.volume = this.vol / 100;
    el.src = st.url;
    this.onState('buffering');
    el.play().catch(e => { if (gen !== this.gen) return; if (e && e.name === 'NotAllowedError') this.onState('tap'); else fallback('play'); });
  }
  watchSilence(gen, fallback) {
    const buf = new Uint8Array(this.an.fftSize); let n = 0;
    const t = setInterval(() => {
      if (gen !== this.gen) { clearInterval(t); return; }
      this.an.getByteTimeDomainData(buf);
      if (buf.some(x => x !== 128)) { clearInterval(t); return; }       // real audio: the gain path works
      if (++n >= 8) { clearInterval(t); fallback('silent'); }          // 4 s of digital silence: no CORS
    }, 500);
  }
  stop(fade = true) {
    const had = !!this.el, g = this.gain, ctx = this.ctx; this.gen++;
    const kill = this.detach();
    if (!had) return;
    if (fade && g) { g.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(kill, 1500); } else kill();
    this.onState('off');
  }
}

export function init(ctx, root) {
  const P = Pr.get;
  const clock = h('div', 'fclock'), phase = h('div', 'fphase'), bar = h('div', 'fbar'), fill = h('div');
  bar.appendChild(fill);
  const acts = h('div', 'facts'), rbox = h('div', 'fradio'), rstat = h('div', 'mini fstat'), sets = h('div', 'fsets'), xp = h('div', 'mini fxp');
  const volTxt = h('span', 'fvol');
  root.replaceChildren(h('div', 'fwrap', null));
  const wrap = root.firstChild;
  wrap.append(clock, phase, bar, acts, h('div', 'fh', 'Radio during focus'), rbox, rstat, h('div', 'fh', 'Durations'), sets, xp);

  let rstate = 'off', rwhy = '';
  const radio = new Radio((s, why) => { rstate = s; rwhy = why || ''; renderRadio(); });
  radio.vol = P().radio.vol;
  const station = () => STATIONS.find(s => s.id === P().radio.st) || null;
  const focusing = () => { const r = P().run; return r && r.ph === 'focus' && !r.pending && r.end != null; };
  const syncRadio = () => { if (focusing()) { if (!radio.el && P().radio.st !== 'off') radio.play(station()); } else if (radio.el) radio.stop(); };

  const btn = (label, fn, cls = 'btn') => { const b = h('button', cls, label); b.addEventListener('click', fn); return b; };
  function renderActs() {
    const r = P().run, a = [];
    if (!r) a.push(btn('Start focus', () => { radio.unlock(); Pr.start('focus'); }, 'btn accent big'));
    else if (r.pending) {
      const m = Pr.phaseMins(r.ph);
      a.push(btn(r.ph === 'focus' ? `Start focus (${m} min)` : `Start ${r.ph === 'long' ? 'long ' : ''}break (${m} min)`,
        () => { radio.unlock(); Pr.start(r.ph); }, 'btn accent big'), btn('Skip', () => Pr.skip(), 'btn wide2'));
    } else if (r.end != null) a.push(btn('Pause', () => Pr.pause(), 'btn big'), btn('Stop (no XP)', confirmStop, 'btn wide2'));
    else a.push(btn('Resume', () => { radio.unlock(); Pr.resume(); }, 'btn accent big'), btn('Stop (no XP)', confirmStop, 'btn wide2'));
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
  function renderRadio() {
    const seg = segmented([['off', 'Off'], ...STATIONS.map(s => [s.id, s.name])], P().radio.st, v => {
      Pr.setRadio({ st: v }); radio.unlock();
      if (focusing()) radio.play(v === 'off' ? null : station()); else renderRadio();
    });
    const vol = h('div', 'fvolrow');
    volTxt.textContent = `${P().radio.vol} %`;
    const step = d => () => { const v = Math.max(0, Math.min(100, P().radio.vol + d)); Pr.setRadio({ vol: v }); radio.setVolume(v); volTxt.textContent = `${v} %`; };
    const direct = radio.mode === 'direct' && radio.el;
    vol.append(btn('−', step(-10), 'btn fv'), volTxt, btn('+', step(10), 'btn fv'));
    rbox.replaceChildren(seg, vol);
    for (const b of vol.querySelectorAll('button')) b.disabled = direct;
    const st = station();
    rstat.textContent = P().radio.st === 'off' ? 'Radio off.'
      : !st.url ? `${st.name}: the stream address isn't available yet.`
      : !navigator.onLine ? 'The radio needs an internet connection.'
      : rstate === 'playing' ? `Playing ${st.name}.`
      : rstate === 'direct' ? `Playing ${st.name}. This station doesn't allow app volume control: use the device buttons.`
      : rstate === 'buffering' ? `Connecting to ${st.name}…`
      : rstate === 'tap' ? 'Tap Resume or a station to start the radio.'
      : rstate === 'error' ? `${st.name} can't be played right now.`
      : `${st.name} plays while you focus.`;
  }
  function renderSets() {
    const r = P().run, busy = r && !r.pending;
    const row = (k, label, unit) => {
      const v = h('span', 'fval', `${P().pomo[k]} ${unit}`);
      const b1 = btn('−', () => Pr.setPomo(k, P().pomo[k] - (k === 'every' ? 1 : k === 'short' ? 1 : 5)), 'btn fv');
      const b2 = btn('+', () => Pr.setPomo(k, P().pomo[k] + (k === 'every' ? 1 : k === 'short' ? 1 : 5)), 'btn fv');
      b1.disabled = b2.disabled = busy;
      const d = h('div', 'fset'); d.append(h('span', null, label), b1, v, b2); return d;
    };
    sets.replaceChildren(row('focus', 'Focus', 'min'), row('short', 'Break', 'min'), row('long', 'Long break', 'min'), row('every', 'Long break after', 'sessions'));
    const p = P(), L = Pr.levelOf(p.xp), a = Pr.levelStart(L), b = Pr.levelStart(L + 1);
    xp.textContent = `Level ${L} · ${p.xp - a} / ${b - a} XP to level ${L + 1}\n` +
      `${Pr.XP.focusMin} XP per focus minute, ${Pr.XP.breakMin} per break minute, +${Pr.XP.setBonus} per full set, 1 per 2 minutes in the app.`;
  }
  const all = () => { renderClock(); renderActs(); renderRadio(); renderSets(); };
  Pr.onChange(w => {
    if (w === 'tick') { if (visible) renderClock(); return; }
    if (w === 'run' || (w && w.done)) syncRadio();
    if (w === 'reset') { radio.stop(false); return; }
    if (visible) all();
  });
  window.addEventListener('online', () => visible && renderRadio());
  window.addEventListener('offline', () => visible && renderRadio());
  let visible = false;
  return {
    show() { visible = true; all(); },
    hide() { visible = false; },
    radio,
  };
}
