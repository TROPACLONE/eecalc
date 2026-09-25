/*
 EE Calc — media player: internet radio, lofi streams and LibriVox audiobooks (loaded on first use).
 Plays independently of Focus, until it is paused or stopped.

 Volume on iOS only works through Web Audio (HTMLMediaElement.volume is ignored there), and Web Audio needs
 the stream to allow cross-origin access (CORS) — otherwise WebKit plays silence. So each source is first tried
 through a GainNode; if it fails to load, or stays digitally silent for 4 s, it is reopened directly (device
 volume buttons only) for the rest of the session. Streams the catalog marks cors: false open directly at once.

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
// 'Pride and Prejudice (version 3)', 'Alice's Adventures in Wonderland, by Lewis Carroll' -> the bare title
const cleanTitle = s => clean(s).replace(/\s*\(version \d+\)|\s*-?\s*LibriVox.*$|,\s+by\s+[^,]+$/gi, '');
async function getJSON(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** Search LibriVox recordings by title or author. -> [{ id, title, author }] (most downloaded first). */
export async function searchBooks(q) {
  // words (letters, digits, inner ' or -), each in the title or the author: "stoker dracula" finds Dracula
  const words = q.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map(w => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const t = words.map(w => `(title:(${w}*) OR creator:(${w}*))`).join(' AND ');
  const query = `collection:(librivoxaudio) AND mediatype:(audio) AND ${t}`;
  const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator` +
    '&sort[]=downloads+desc&rows=40&page=1&output=json';
  const j = await getJSON(url);
  if (j.error) throw new Error(String(j.error));                  // archive.org answers a bad query with 200 + error
  return (j.response && j.response.docs || []).filter(d => /^[A-Za-z0-9._-]{1,100}$/.test(d.identifier))
    .map(d => ({ id: d.identifier, title: cleanTitle(d.title), author: clean(d.creator) }));
}
const bookCache = new Map();
// '1133.07', '18:52' or '1:02:03' -> seconds
const secsOf = s => String(s || '').split(':').reduce((a, x) => a * 60 + Number(x), 0) || 0;
/** Chapters of a LibriVox item: its 64 kbit/s MP3 files in track order. -> { id, title, author, chapters: [{ title, url, secs }] } */
export async function loadBook(id) {
  if (bookCache.has(id)) return bookCache.get(id);
  const j = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const all = j.files || [], byName = new Map(all.map(f => [f.name, f]));
  // the 64 kbit/s copies are derivatives: their track number (and a length in seconds) is on the original file
  const files = all.filter(f => /\.mp3$/i.test(f.name) && /64kb/i.test(f.name + ' ' + (f.format || '')))
    .map(f => ({ f, o: byName.get(f.original) || f }));
  const track = x => parseInt(String(x.f.track || x.o.track || '').split('/')[0], 10) || 0;
  files.sort((a, b) => track(a) - track(b) || a.f.name.localeCompare(b.f.name, 'en', { numeric: true }));
  if (!files.length) throw new Error('no chapters');
  const md = j.metadata || {};
  const book = { id, title: cleanTitle(md.title), author: clean(md.creator),
    chapters: files.slice(0, 400).map(({ f, o }, i) => ({ title: clean(f.title || o.title) || `Chapter ${i + 1}`,
      url: `${IA}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`, secs: Math.round(secsOf(o.length || f.length)) })) };
  if (bookCache.size > 20) bookCache.delete(bookCache.keys().next().value);
  bookCache.set(id, book);
  return book;
}
export const cover = id => `${IA}/services/img/${encodeURIComponent(id)}`;

// ═════════════════════════════════════════════════════════ the player
/** An item is { kind: 'radio' | 'lofi' | 'book', id, title, sub, logo, url, live }; a book item also has book and ch. */
class Player {
  constructor() {
    this.ctx = null; this.paths = {}; this.cur = null; this.el = null; this.gain = null; this.an = null;
    this.noGain = new Set(); this.gen = 0; this.item = null; this.list = null; this.state = 'off'; this.why = '';
    this.vol = Pr.get() ? Pr.get().media.vol : 60; this.saved = 0; this.subs = new Set();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.savePos(); });
    const ms = navigator.mediaSession;
    if (ms) {
      this.onAction = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* action not supported */ } };
      this.onAction('play', () => this.resume()); this.onAction('pause', () => this.pause()); this.onAction('stop', () => this.stop());
      this.onAction('nexttrack', () => this.skip(1)); this.onAction('previoustrack', () => this.skip(-1));
    }
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(state, why = '') {
    this.state = state; this.why = why;
    for (const fn of this.subs) { try { fn(this); } catch (e) { console.error(e); } }
    const ms = navigator.mediaSession;
    if (ms) ms.playbackState = state === 'playing' || state === 'direct' || state === 'buffering' ? 'playing' : this.item ? 'paused' : 'none';
    this.position();
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
    if (!this.ctx && AC) {
      this.ctx = new AC();
      // iOS suspends ('interrupted') the context for a call or Siri: the gain path then plays silence, so say so
      this.ctx.onstatechange = () => { if (this.gain && this.state === 'playing' && this.ctx.state !== 'running') this.emit('tap'); };
    }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  /** Suspends the audio context once nothing plays (it keeps iOS's audio thread awake otherwise). */
  idle() { setTimeout(() => { if (!this.cur && this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }, 1000); }
  /** Through the gain path unless the stream is known not to allow CORS (catalog cors: false) or already failed it.
   *  HLS (.m3u8) always plays directly: WebKit can't route HLS through Web Audio (it gives silence). */
  useGain(item) { return !!this.ctx && item.cors !== false && !/\.m3u8(\?|$)/i.test(item.url) && !this.noGain.has(item.url); }
  /** Plays an item (inside a tap); list = the items that next / previous step through. */
  play(item, list) {
    this.unlock();
    this.savePos(); this.release(false);
    this.item = item; if (list) this.list = list;
    this.metadata();
    if (item.kind !== 'book') Pr.setMedia({ last: `${item.kind}:${item.id}` }, true);
    this.open(this.useGain(item), item.at || 0);
  }
  /** Plays chapter ch of a loaded book from t seconds. */
  playBook(book, ch = 0, t = 0) {
    ch = Math.max(0, Math.min(book.chapters.length - 1, ch));
    const c = book.chapters[ch];
    this.play({ kind: 'book', id: book.id, title: book.title, sub: `${book.author ? book.author + ' · ' : ''}${ch + 1}/${book.chapters.length} · ${c.title}`,
      logo: cover(book.id), url: c.url, live: false, book, ch, at: t });
    Pr.setMedia({ book: { id: book.id, ch, t: Math.floor(t) } }, true);
  }
  /** One <audio> element per path (Web Audio gain / direct), kept for the session: a chapter or station change only
   *  swaps its source, so the next chapter can start without a tap (iOS may refuse play() on a new element then).
   *  Its events go to the handlers of the item it currently plays (path.on, replaced on every open). */
  path(withGain) {
    const key = withGain ? 'gain' : 'direct';
    if (this.paths[key]) return this.paths[key];
    const el = new Audio(), p = { el, on: {} };
    if (withGain) {
      el.crossOrigin = 'anonymous';
      const src = this.ctx.createMediaElementSource(el);              // once per element, as Web Audio requires
      p.gain = this.ctx.createGain(); p.an = this.ctx.createAnalyser(); p.an.fftSize = 512;
      src.connect(p.gain).connect(p.an).connect(this.ctx.destination);
    }
    for (const ev of ['error', 'playing', 'waiting', 'pause', 'timeupdate', 'ended', 'loadedmetadata']) el.addEventListener(ev, e => { const f = p.on[ev]; if (f) f(e); });
    return (this.paths[key] = p);
  }
  /** Stops an element and its download (the element itself is kept). */
  silence(p) { p.on = {}; p.el.pause(); p.el.removeAttribute('src'); p.el.load(); }
  release(fade) {
    const p = this.cur, ctx = this.ctx; this.gen++;
    this.cur = this.el = this.gain = this.an = null;
    if (!p) return;
    p.on = {};                                              // its late events belong to nobody
    if (fade && p.gain) { p.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25); setTimeout(() => { if (this.cur !== p) this.silence(p); }, 900); }
    else this.silence(p);
  }
  open(withGain, at = 0) {
    if (this.cur) this.silence(this.cur);                   // a failed previous attempt (fallback) is stopped first
    const gen = ++this.gen, item = this.item, p = this.path(withGain), el = p.el;
    this.cur = p; this.el = el; this.gain = p.gain || null; this.an = p.an || null;
    el.preload = item.live ? 'none' : 'auto';
    const mine = () => gen === this.gen;
    const fallback = why => {
      if (!mine()) return;
      // a network error is not a CORS problem: only a failure with the network up sends the URL to the direct path,
      // and if the direct path fails too the URL gets its gain path back for the next try
      if (withGain) { if (navigator.onLine) this.noGain.add(item.url); this.open(false, el.currentTime || at); }
      else { this.noGain.delete(item.url); this.emit('error', why); }
    };
    p.on = {
      error: () => fallback('load'),
      playing: () => { if (!mine()) return; this.emit(withGain ? 'playing' : 'direct'); if (withGain) this.watchSilence(gen, fallback); },
      waiting: () => { if (mine()) this.emit('buffering'); },
      // paused by the system (a call, headphones unplugged): the state follows, so the next tap plays again
      pause: () => { if (mine() && !el.ended && (this.state === 'playing' || this.state === 'direct')) { this.savePos(); this.emit('paused'); } },
    };
    if (!item.live) {
      p.on.loadedmetadata = () => { if (mine() && at > 0 && at < (el.duration || Infinity)) el.currentTime = at; };
      p.on.timeupdate = () => { if (mine() && Date.now() - this.saved > 30000) this.savePos(); };
      p.on.ended = () => { if (!mine()) return; if (!this.skip(1)) { this.savePos(true); this.emit('paused', 'end'); } };
    }
    if (withGain) { const g = p.gain.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(this.level(this.vol), this.ctx.currentTime); }
    else el.volume = this.vol / 100;
    el.src = item.url;
    this.emit('buffering');
    el.play().catch(e => { if (!mine()) return; if (e && e.name === 'NotAllowedError') this.emit('tap'); else if (e && e.name !== 'AbortError') fallback('play'); });
  }
  watchSilence(gen, fallback) {
    const an = this.an, buf = new Uint8Array(an.fftSize); let n = 0;
    const t = setInterval(() => {
      if (gen !== this.gen || !this.an) { clearInterval(t); return; }
      if (!this.el || this.el.paused || this.el.readyState < 3) return;    // paused or stalled is not silence
      if (this.ctx.state !== 'running') return;                            // nor is a suspended context
      an.getByteTimeDomainData(buf);
      if (buf.some(x => x !== 128)) { clearInterval(t); return; }       // real audio: the gain path works
      if (++n >= 8) { clearInterval(t); fallback('silent'); }          // 4 s of digital silence: no CORS
    }, 500);
  }
  pause() {
    if (!this.item) return;
    if (this.item.live) { this.release(true); this.idle(); }   // live: stop downloading; play reopens at the live edge
    else if (this.el) { this.el.pause(); this.savePos(); }
    this.emit('paused');
  }
  resume() {
    if (!this.item) return;
    this.unlock();
    const el = this.el;
    // a paused book continues on its element; after an error (or with no source) it is opened again
    if (el && !this.item.live && !el.error && this.state !== 'error' && el.getAttribute('src')) { el.play().catch(() => this.emit('tap')); return; }
    this.open(this.useGain(this.item), this.item.at || 0);
  }
  toggle() { if (this.playing) this.pause(); else this.resume(); }
  stop() { this.savePos(); this.release(true); this.item = null; this.metadata(); this.emit('off'); this.idle(); }
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
  seek(ds) { if (this.el && this.item && !this.item.live && Number.isFinite(this.el.duration)) { this.el.currentTime = Math.max(0, Math.min(this.el.duration - 1, this.el.currentTime + ds)); this.position(); } }
  get pos() { return this.el && this.item && !this.item.live ? { t: this.el.currentTime || 0, d: this.el.duration || 0 } : null; }
  savePos(ended) {
    const it = this.item; if (!it || it.kind !== 'book' || !this.el) return;
    this.saved = Date.now();
    it.at = this.el.currentTime || it.at || 0;
    const last = it.ch >= it.book.chapters.length - 1;
    // the whole book finished: nothing to continue ("Continue listening" would restart the last chapter)
    if (ended && last) { Pr.setMedia({ book: null }, true); return; }
    Pr.setMedia({ book: { id: it.id, ch: ended ? it.ch + 1 : it.ch, t: ended ? 0 : Math.floor(it.at) } }, true);
  }
  /** Lock-screen position of a book (seek bar). */
  position() {
    const ms = navigator.mediaSession, p = this.pos;
    if (!ms || !ms.setPositionState || !p || !Number.isFinite(p.d) || !p.d) return;
    try { ms.setPositionState({ duration: p.d, position: Math.min(p.t, p.d), playbackRate: 1 }); } catch { /* ignore */ }
  }
  metadata() {
    const ms = navigator.mediaSession; if (!ms) return;
    const it = this.item, book = !!it && it.kind === 'book';
    // seek buttons only for books: iOS shows them instead of previous / next, which change the station
    if (this.onAction) {
      this.onAction('seekbackward', book ? () => this.seek(-15) : null); this.onAction('seekforward', book ? () => this.seek(30) : null);
      this.onAction('seekto', book ? e => { if (this.el && Number.isFinite(e.seekTime)) { this.el.currentTime = e.seekTime; this.position(); } } : null);
    }
    if (!window.MediaMetadata) return;
    ms.metadata = it ? new MediaMetadata({ title: it.title, artist: it.sub || '', album: 'EE Calc',
      artwork: it.logo ? [{ src: new URL(it.logo, location.href).href, sizes: '128x128' }] : [] }) : null;
  }
}
export const player = new Player();
