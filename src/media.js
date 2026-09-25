/*
 EE Calc — media player: internet radio, lofi streams and LibriVox audiobooks (loaded on first use).
 Plays independently of Focus, until it is paused or stopped.

 Volume on iOS only works through Web Audio (HTMLMediaElement.volume is ignored there), and Web Audio needs
 the stream to allow cross-origin access (CORS) — otherwise WebKit plays silence. So each source is first tried
 through a GainNode; if it fails to load, or stays digitally silent for 4 s, it is reopened directly (device
 volume buttons only) for the rest of the session.

 Resources: one <audio> element at a time, created on play and fully released (pause, unload, disconnect) on
 stop. Pausing a live stream releases it too (no download in the background); play reopens it at the live edge.
 An audiobook keeps its element while paused, and its position is saved in the profile on pause, on a chapter
 change, when the app is hidden and at most every 30 s while playing. The lock screen gets the title,
 artwork and play / pause / next / previous through the Media Session API.
*/
import * as Pr from './profile.js';
import { CATALOG, COUNTRIES } from './catalog.js';

export { CATALOG, COUNTRIES };
export const flag = cc => String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0)));   // 'PT' → 🇵🇹

// ═════════════════════════════════════════════════════════ LibriVox (public domain) through archive.org
const IA = 'https://archive.org';
const clean = s => String(s == null ? '' : Array.isArray(s) ? s[0] : s).replace(/\s+/g, ' ').trim().slice(0, 140);
async function getJSON(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** Search LibriVox recordings by title or author. -> [{ id, title, author }] (most downloaded first). */
export async function searchBooks(q) {
  const words = q.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const t = words.map(w => `${w}*`).join(' AND ');
  const query = `collection:(librivoxaudio) AND mediatype:(audio) AND (title:(${t}) OR creator:(${t}))`;
  const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator` +
    '&sort[]=downloads+desc&rows=40&page=1&output=json';
  const j = await getJSON(url);
  return (j.response && j.response.docs || []).filter(d => /^[A-Za-z0-9._-]{1,100}$/.test(d.identifier))
    .map(d => ({ id: d.identifier, title: clean(d.title).replace(/\s*\(version \d+\)|\s*-?\s*LibriVox.*$/i, ''), author: clean(d.creator) }));
}
const bookCache = new Map();
/** Chapters of a LibriVox item: its 64 kbit/s MP3 files in track order. -> { id, title, author, chapters: [{ title, url, secs }] } */
export async function loadBook(id) {
  if (bookCache.has(id)) return bookCache.get(id);
  const j = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const files = (j.files || []).filter(f => /\.mp3$/i.test(f.name) && /64kb/i.test(f.name + ' ' + (f.format || '')));
  const track = f => parseInt(String(f.track || '').split('/')[0], 10);
  files.sort((a, b) => (track(a) || 0) - (track(b) || 0) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!files.length) throw new Error('no chapters');
  const md = j.metadata || {};
  const book = { id, title: clean(md.title).replace(/\s*\(version \d+\)|\s*-?\s*LibriVox.*$/i, ''), author: clean(md.creator),
    chapters: files.slice(0, 400).map((f, i) => ({ title: clean(f.title) || `Chapter ${i + 1}`,
      url: `${IA}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`, secs: Math.round(Number(f.length)) || 0 })) };
  if (bookCache.size > 20) bookCache.delete(bookCache.keys().next().value);
  bookCache.set(id, book);
  return book;
}
export const cover = id => `${IA}/services/img/${encodeURIComponent(id)}`;

// ═════════════════════════════════════════════════════════ the player
/** An item is { kind: 'radio' | 'lofi' | 'book', id, title, sub, logo, url, live }; a book item also has book and ch. */
class Player {
  constructor() {
    this.ctx = null; this.el = null; this.gain = null; this.an = null; this.nodes = null;
    this.noGain = new Set(); this.gen = 0; this.item = null; this.list = null; this.state = 'off'; this.why = '';
    this.vol = Pr.get() ? Pr.get().media.vol : 60; this.saved = 0; this.subs = new Set();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.savePos(); });
    const ms = navigator.mediaSession;
    if (ms) {
      const on = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* action not supported */ } };
      on('play', () => this.resume()); on('pause', () => this.pause()); on('stop', () => this.stop());
      on('nexttrack', () => this.skip(1)); on('previoustrack', () => this.skip(-1));
      on('seekbackward', () => this.seek(-15)); on('seekforward', () => this.seek(30));
    }
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(state, why = '') {
    this.state = state; this.why = why;
    for (const fn of this.subs) { try { fn(this); } catch (e) { console.error(e); } }
    const ms = navigator.mediaSession;
    if (ms) ms.playbackState = state === 'playing' || state === 'direct' || state === 'buffering' ? 'playing' : this.item ? 'paused' : 'none';
  }
  get active() { return !!this.item; }
  get playing() { return this.state === 'playing' || this.state === 'direct' || this.state === 'buffering'; }
  get gainOK() { return !!this.gain; }
  level(v) { return (v / 100) ** 2; }                     // perceptual (≈ power) taper
  setVolume(v) {
    this.vol = v = Math.max(0, Math.min(100, Math.round(v)));
    if (this.gain) this.gain.gain.setTargetAtTime(this.level(v), this.ctx.currentTime, 0.05);
    else if (this.el) this.el.volume = v / 100;             // honoured on desktop, ignored on iOS
    Pr.setMedia({ vol: v }, true);
  }
  unlock() {                                              // call inside a tap: creates / resumes the audio context
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) this.ctx = new AC();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  /** Plays an item (inside a tap); list = the items that next / previous step through. */
  play(item, list) {
    this.unlock();
    this.savePos(); this.release(false);
    this.item = item; if (list) this.list = list;
    this.metadata();
    if (item.kind !== 'book') Pr.setMedia({ last: `${item.kind}:${item.id}` }, true);
    this.open(!!this.ctx && !this.noGain.has(item.url), item.at || 0);
  }
  /** Plays chapter ch of a loaded book from t seconds. */
  playBook(book, ch = 0, t = 0) {
    ch = Math.max(0, Math.min(book.chapters.length - 1, ch));
    const c = book.chapters[ch];
    this.play({ kind: 'book', id: book.id, title: book.title, sub: `${book.author ? book.author + ' · ' : ''}${ch + 1}/${book.chapters.length} · ${c.title}`,
      logo: cover(book.id), url: c.url, live: false, book, ch, at: t });
    Pr.setMedia({ book: { id: book.id, ch, t: Math.floor(t) } }, true);
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
  release(fade) {
    const had = !!this.el, g = this.gain, ctx = this.ctx; this.gen++;
    const kill = this.detach();
    if (!had) return;
    if (fade && g) { g.gain.setTargetAtTime(0, ctx.currentTime, 0.25); setTimeout(kill, 900); } else kill();
  }
  open(withGain, at = 0) {
    this.detach()();                                        // a failed previous attempt (fallback) is released first
    const gen = ++this.gen, item = this.item, el = new Audio();
    el.preload = item.live ? 'none' : 'auto';
    if (withGain) el.crossOrigin = 'anonymous';
    this.el = el; this.gain = null;
    const mine = () => gen === this.gen;
    const fallback = why => { if (!mine()) return; if (withGain) { this.noGain.add(item.url); this.open(false, el.currentTime || at); } else this.emit('error', why); };
    el.addEventListener('error', () => fallback('load'));
    el.addEventListener('playing', () => {
      if (!mine()) return;
      this.emit(withGain ? 'playing' : 'direct');
      if (withGain) this.watchSilence(gen, fallback);
    });
    el.addEventListener('waiting', () => { if (mine()) this.emit('buffering'); });
    if (!item.live) {
      if (at > 0) el.addEventListener('loadedmetadata', () => { if (mine() && at < (el.duration || Infinity)) el.currentTime = at; }, { once: true });
      el.addEventListener('timeupdate', () => { if (mine() && Date.now() - this.saved > 30000) this.savePos(); });
      el.addEventListener('ended', () => { if (!mine()) return; if (!this.skip(1)) { this.savePos(true); this.emit('paused', 'end'); } });
    }
    if (withGain) {
      const src = this.ctx.createMediaElementSource(el);
      this.gain = this.ctx.createGain(); this.gain.gain.value = this.level(this.vol);
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 512;
      src.connect(this.gain).connect(this.an).connect(this.ctx.destination);
      this.nodes = [src, this.gain, this.an];
    } else el.volume = this.vol / 100;
    el.src = item.url;
    this.emit('buffering');
    el.play().catch(e => { if (!mine()) return; if (e && e.name === 'NotAllowedError') this.emit('tap'); else if (e && e.name !== 'AbortError') fallback('play'); });
  }
  watchSilence(gen, fallback) {
    const buf = new Uint8Array(this.an.fftSize); let n = 0;
    const t = setInterval(() => {
      if (gen !== this.gen || !this.an) { clearInterval(t); return; }
      if (!this.el || this.el.paused || this.el.readyState < 3) return;    // paused or stalled is not silence
      this.an.getByteTimeDomainData(buf);
      if (buf.some(x => x !== 128)) { clearInterval(t); return; }       // real audio: the gain path works
      if (++n >= 8) { clearInterval(t); fallback('silent'); }          // 4 s of digital silence: no CORS
    }, 500);
  }
  pause() {
    if (!this.item) return;
    if (this.item.live) this.release(true);                 // live: stop downloading; play reopens at the live edge
    else if (this.el) { this.el.pause(); this.savePos(); }
    this.emit('paused');
  }
  resume() {
    if (!this.item) return;
    this.unlock();
    if (this.el && !this.item.live) { this.el.play().catch(() => this.emit('tap')); return; }   // its 'playing' event reports the state
    this.open(!!this.ctx && !this.noGain.has(this.item.url), this.item.at || 0);
  }
  toggle() { if (this.playing) this.pause(); else this.resume(); }
  stop() { this.savePos(); this.release(true); this.item = null; this.metadata(); this.emit('off'); }
  /** Next / previous chapter (books) or item in the list it was chosen from. -> false at the end. */
  skip(d) {
    const it = this.item; if (!it) return false;
    if (it.kind === 'book') {
      const ch = it.ch + d; if (ch < 0 || ch >= it.book.chapters.length) return false;
      this.playBook(it.book, ch, 0); return true;
    }
    const l = this.list || [], i = l.findIndex(x => x.id === it.id);
    if (l.length < 2 || i < 0) return false;
    this.play(l[(i + d + l.length) % l.length]); return true;
  }
  seek(ds) { if (this.el && this.item && !this.item.live && Number.isFinite(this.el.duration)) this.el.currentTime = Math.max(0, Math.min(this.el.duration - 1, this.el.currentTime + ds)); }
  get pos() { return this.el && this.item && !this.item.live ? { t: this.el.currentTime || 0, d: this.el.duration || 0 } : null; }
  savePos(ended) {
    const it = this.item; if (!it || it.kind !== 'book' || !this.el) return;
    this.saved = Date.now();
    it.at = this.el.currentTime || it.at || 0;
    Pr.setMedia({ book: { id: it.id, ch: ended ? Math.min(it.ch + 1, it.book.chapters.length - 1) : it.ch, t: ended ? 0 : Math.floor(it.at) } }, true);
  }
  metadata() {
    const ms = navigator.mediaSession; if (!ms || !window.MediaMetadata) return;
    const it = this.item;
    ms.metadata = it ? new MediaMetadata({ title: it.title, artist: it.sub || '', album: 'EE Calc',
      artwork: it.logo ? [{ src: new URL(it.logo, location.href).href, sizes: '128x128' }] : [] }) : null;
  }
}
export const player = new Player();
