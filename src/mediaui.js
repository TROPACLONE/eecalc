/*
 EE Calc — player interface (loaded with the player): the browser (radio logos by country, lofi, audiobooks),
 the player bar (docked at the bottom of Focus, and in the sheet the top-right bubble opens).
 Parts that live in a sheet unsubscribe themselves once they are no longer in the page.
*/
import { player, CATALOG, COUNTRIES, flag, searchBooks, loadBook, cover } from './media.js';
import * as Pr from './profile.js';
import { h, toast, sheet, closeSheet } from './ui.js';
import { icon } from './icons.js';

const CC = Object.fromEntries(COUNTRIES);
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), x = String(s % 60).padStart(2, '0'); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const mono = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const ibtn = (cls, ic, label, fn) => { const b = h('button', cls); b.appendChild(icon(ic)); b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
/** Keeps fn subscribed to the player while el is in the page. */
function live(el, fn) { const off = player.on(p => { if (el.isConnected) fn(p); else off(); }); }

// items: built once, so next / previous can step through the list an item was chosen from
const ITEMS = {
  radio: CATALOG.radio.map(s => ({ kind: 'radio', id: s.id, title: s.name, sub: CC[s.cc] || '', cc: s.cc, logo: s.logo, url: s.url, live: true })),
  lofi: CATALOG.lofi.map(s => ({ kind: 'lofi', id: s.id, title: s.name, sub: s.note || 'Lofi', logo: s.logo, url: s.url, live: true })),
};
export const lastItem = () => {
  const l = Pr.get() && Pr.get().media.last; if (!l) return null;
  const [k, id] = [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)];
  return (ITEMS[k] || []).find(x => x.id === id) || null;
};

/** Artwork: the logo (or book cover), falling back to initials if it can't be loaded. */
export function art(item, cls) {
  const box = h('span', 'art' + (cls ? ' ' + cls : ''));
  if (item && item.logo) {
    const img = new Image(); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    img.addEventListener('error', () => { img.remove(); box.classList.add('mono'); box.textContent = mono(item.title); }, { once: true });
    img.src = item.logo; box.appendChild(img);
  } else box.appendChild(icon(item && item.kind === 'book' ? 'book' : item && item.kind === 'lofi' ? 'music' : 'radio'));
  return box;
}

// ═════════════════════════════════════════════════════════ player bar
export function bar() {
  const el = h('div', 'pbar');
  const top = h('div', 'pb-top'), txt = h('div', 'pb-txt'), title = h('div', 'pb-title'), sub = h('div', 'pb-sub');
  let artEl = h('span', 'art'), artKey = null;
  txt.append(title, sub);
  const prev = ibtn('pb-b', 'prev', 'Previous', () => player.skip(-1));
  const play = ibtn('pb-b pb-play', 'play', 'Play', () => { if (player.item) player.toggle(); else { const l = lastItem(); if (l) player.play(l, ITEMS[l.kind]); } });
  const next = ibtn('pb-b', 'next', 'Next', () => player.skip(1));
  top.append(artEl, txt, prev, play, next);
  // audiobook progress
  const prog = h('div', 'pb-prog'), tNow = h('span', 'pb-t'), tEnd = h('span', 'pb-t'), seek = h('input', 'pb-range');
  seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.step = 1; seek.setAttribute('aria-label', 'Position');
  let dragging = false;
  seek.addEventListener('input', () => { dragging = true; const p = player.pos; if (p && p.d) tNow.textContent = fmt(p.d * seek.value / 1000); });
  seek.addEventListener('change', () => { dragging = false; const p = player.pos; if (p && p.d && player.el) player.el.currentTime = p.d * seek.value / 1000; });
  prog.append(ibtn('pb-b sm', 'back15', 'Back 15 seconds', () => player.seek(-15)), tNow, seek, tEnd, ibtn('pb-b sm', 'fwd30', 'Forward 30 seconds', () => player.seek(30)));
  // volume + stop
  const vrow = h('div', 'pb-vol'), vol = h('input', 'pb-range'), vtxt = h('span', 'pb-t');
  vol.type = 'range'; vol.min = 0; vol.max = 100; vol.step = 5; vol.setAttribute('aria-label', 'Volume');
  vol.addEventListener('input', () => { player.setVolume(+vol.value); vtxt.textContent = `${vol.value} %`; });
  vrow.append(icon('vol'), vol, vtxt, ibtn('pb-b sm', 'stop', 'Stop', () => player.stop()));
  el.append(top, prog, vrow);

  let timer = 0;
  const tick = () => {
    const p = player.pos;
    if (!p) return;
    if (!dragging) { tNow.textContent = fmt(p.t); seek.value = p.d ? Math.round(1000 * p.t / p.d) : 0; }
    tEnd.textContent = p.d ? fmt(p.d) : '–:––';
  };
  function update() {
    const it = player.item || lastItem(), s = player.state, on = !!player.item;
    const key = it ? `${it.kind}:${it.id}:${it.logo}` : '';
    if (key !== artKey) { artKey = key; const a = art(it); artEl.replaceWith(a); artEl = a; }     // no image request per state change
    title.textContent = it ? it.title : 'Nothing playing';
    const offline = !navigator.onLine;
    sub.textContent = !it ? 'Choose a station, a lofi stream or an audiobook.'
      : !on ? (offline ? 'Needs an internet connection' : 'Tap play to listen')
      : s === 'buffering' ? 'Connecting…'
      : s === 'tap' ? 'Tap play to start'
      : s === 'error' ? (offline ? 'Needs an internet connection' : "Can't be played right now")
      : s === 'paused' ? (player.why === 'end' ? 'Finished' : 'Paused')
      : s === 'direct' ? `${it.sub} · use the device volume buttons` : it.sub;
    sub.classList.toggle('err', on && s === 'error');
    const playing = player.playing;
    play.replaceChildren(icon(playing ? 'pause' : 'play')); play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.disabled = !it;
    prev.disabled = next.disabled = !on;
    const book = on && it.kind === 'book';
    prog.hidden = !book;
    vrow.querySelector('.pb-b').disabled = !on;
    vol.value = player.vol; vtxt.textContent = `${player.vol} %`;
    vol.disabled = on && s === 'direct';
    el.classList.toggle('on', on); el.classList.toggle('playing', playing);
    clearInterval(timer); timer = 0;
    if (book) { tick(); if (playing) timer = setInterval(() => { if (!el.isConnected) { clearInterval(timer); return; } if (document.visibilityState === 'visible') tick(); }, 1000); }
  }
  live(el, update);
  update();
  return el;
}

// ═════════════════════════════════════════════════════════ browser
const S = { tab: 'radio', cc: null, q: '', results: null, busy: false };
export function browser(root) {
  const tabs = h('div', 'mtabs'), body = h('div', 'mbody');
  const TABS = [['radio', 'radio', 'Radio'], ['lofi', 'music', 'Lofi'], ['book', 'book', 'Audiobooks']];
  for (const [k, ic, label] of TABS) {
    const b = h('button', 'mtab'); b.dataset.k = k; b.append(icon(ic), h('span', null, label));
    b.addEventListener('click', () => { S.tab = k; render(); });
    tabs.appendChild(b);
  }
  root.replaceChildren(tabs, body);
  const mark = () => {
    const it = player.item;
    for (const t of body.querySelectorAll('.tile')) {
      const cur = !!it && t.dataset.id === `${it.kind}:${it.id}`;
      t.classList.toggle('on', cur); t.classList.toggle('playing', cur && player.playing);
    }
  };
  function grid(items) {
    const g = h('div', 'tiles');
    for (const it of items) {
      const t = h('button', 'tile'); t.dataset.id = `${it.kind}:${it.id}`;
      t.setAttribute('aria-label', it.sub ? `${it.title}, ${it.sub}` : it.title);
      t.appendChild(art(it));
      t.addEventListener('click', () => {
        const cur = player.item && player.item.kind === it.kind && player.item.id === it.id;
        if (cur) player.toggle(); else player.play(it, items);
      });
      g.appendChild(t);
    }
    return g;
  }
  function radio() {
    const chips = h('div', 'chips'), used = COUNTRIES.filter(([c]) => ITEMS.radio.some(s => s.cc === c));
    const chip = (cc, label, ic) => {
      const b = h('button', 'cchip' + (S.cc === cc ? ' on' : ''));
      if (ic) b.appendChild(icon(ic)); else b.appendChild(h('span', 'flag', flag(cc)));
      b.appendChild(h('span', null, label));
      b.addEventListener('click', () => { S.cc = cc; render(); });
      return b;
    };
    chips.appendChild(chip(null, 'All', 'globe'));
    for (const [cc, name] of used) chips.appendChild(chip(cc, name));
    const list = S.cc ? ITEMS.radio.filter(s => s.cc === S.cc) : ITEMS.radio;
    body.append(chips, grid(list));
    requestAnimationFrame(() => { const on = chips.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  }
  function books() {
    const saved = Pr.get() && Pr.get().media.book;
    if (saved) {
      const c = h('button', 'bookrow cont'), t = h('b', null, 'Continue listening'), s = h('span', null, 'Loading…');
      const txt = h('span', 'bk-txt'); txt.append(t, s);
      c.append(art({ kind: 'book', logo: cover(saved.id), title: 'Book' }, 'sm'), txt, icon('play'));
      c.addEventListener('click', () => resumeBook(saved));
      body.appendChild(c);
      // loaded now (cached), so the tap below can start playback at once: iOS only allows audio inside the tap
      loadBook(saved.id).then(b => { s.textContent = `${b.title} · chapter ${saved.ch + 1} · ${fmt(saved.t)}`; }, () => { s.textContent = `Chapter ${saved.ch + 1} · ${fmt(saved.t)}`; });
    }
    const form = h('form', 'bsearch'), inp = h('input', 'ninput');
    inp.type = 'search'; inp.placeholder = 'Search LibriVox: title or author'; inp.value = S.q; inp.enterKeyHint = 'search';
    inp.autocomplete = 'off'; inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false;
    const go = h('button', 'btn'); go.type = 'submit'; go.appendChild(icon('search')); go.setAttribute('aria-label', 'Search');
    form.append(inp, go);
    form.addEventListener('submit', e => {
      e.preventDefault(); inp.blur();
      S.q = inp.value.trim(); if (!S.q) { S.results = null; render(); return; }
      if (!navigator.onLine) { toast('Search needs an internet connection'); return; }
      S.busy = true; render();
      searchBooks(S.q).then(r => { S.results = r; }, () => { S.results = []; toast("LibriVox can't be reached right now"); })
        .finally(() => { S.busy = false; if (root.isConnected) render(); });
    });
    body.appendChild(form);
    const list = (head, items) => {
      body.appendChild(h('div', 'fh', head));
      for (const b of items) {
        const r = h('button', 'bookrow'), txt = h('span', 'bk-txt');
        txt.append(h('b', null, b.title), h('span', null, b.author || ''));
        r.append(txt, icon('right'));
        r.addEventListener('click', () => openBook(b.id));
        body.appendChild(r);
      }
    };
    if (S.busy) body.appendChild(h('div', 'mini', 'Searching…'));
    else if (S.results) { if (S.results.length) list(`Results for “${S.q}”`, S.results); else body.appendChild(h('div', 'mini', `Nothing found for “${S.q}”.`)); }
    if (!S.results || !S.results.length) list('Popular classics', CATALOG.books);
    body.appendChild(h('div', 'mini', 'LibriVox recordings are public domain, read by volunteers, and streamed from the Internet Archive.'));
  }
  function render() {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === S.tab);
    body.replaceChildren();
    if (!navigator.onLine) body.appendChild(h('div', 'mini warnline', 'Offline: listening needs an internet connection.'));
    if (S.tab === 'radio') radio();
    else if (S.tab === 'lofi') { body.appendChild(grid(ITEMS.lofi)); body.appendChild(h('div', 'mini', 'Calm, mostly instrumental streams for focusing.')); }
    else books();
    mark();
  }
  live(root, mark);
  render();
  return { render };
}

async function resumeBook(saved) {
  player.unlock();                                   // inside the tap, before any await
  try { const b = await loadBook(saved.id); player.playBook(b, saved.ch, saved.t); }
  catch { toast(navigator.onLine ? "This audiobook can't be loaded right now" : 'Needs an internet connection'); }
}
function openBook(id) {
  const box = sheet(null, [], () => {});
  box.classList.add('booksheet');
  const head = h('div', 'bk-head'), listEl = h('div', 'bk-list');
  head.append(art({ kind: 'book', logo: cover(id), title: 'Book' }, 'lg'), h('div', 'bk-txt', 'Loading…'));
  box.prepend(head, listEl);
  loadBook(id).then(b => {
    if (!box.isConnected) return;
    const txt = h('div', 'bk-txt'); txt.append(h('b', null, b.title), h('span', null, `${b.author} · ${b.chapters.length} chapters`));
    head.lastChild.replaceWith(txt);
    const saved = Pr.get() && Pr.get().media.book;
    b.chapters.forEach((c, i) => {
      const r = h('button', 'chap'), here = saved && saved.id === id && saved.ch === i;
      r.append(h('span', 'n', String(i + 1)), h('span', 'ct', c.title), h('span', 'd', here && saved.t ? `${fmt(saved.t)} / ${fmt(c.secs)}` : c.secs ? fmt(c.secs) : ''));
      if (here) r.classList.add('on');
      r.addEventListener('click', () => { player.playBook(b, i, here ? saved.t : 0); closeSheet(); });
      listEl.appendChild(r);
    });
  }, () => { if (box.isConnected) head.lastChild.textContent = navigator.onLine ? "This audiobook can't be loaded right now." : 'Needs an internet connection.'; });
}

/** The sheet the top-right bubble opens: the player bar and a way to the browser. */
export function openPlayer(browse) {
  sheet(null, [], box => {
    box.classList.add('playersheet');
    box.appendChild(bar());
    if (browse) { const b = h('button', 'btn wide2'); b.append(icon('list'), h('span', null, 'Browse stations and audiobooks')); b.addEventListener('click', () => { closeSheet(); browse(); }); box.appendChild(b); }
  });
}
