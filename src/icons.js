/* EE Calc — outline icons (24 × 24, drawn with currentColor to match the outlined keys; no icon font, no requests). */
const I = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 6.5h7v3h-7zM8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',
  vars: '<path d="M4 7l6 9M10 7l-6 9M14 10h6M14 14h6"/>',
  energy: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  net: '<circle cx="5.5" cy="6" r="2.2"/><circle cx="18.5" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.7 6h8.6M6.7 8l4.2 8M17.3 8l-4.2 8"/>',
  focus: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 2M9.5 2.5h5M12 2.5V6M19 6.5l1.5-1.5"/>',
  chat: '<path d="M20 15a2 2 0 0 1-2 2H8.5L4 20.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  play: '<path class="f" d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>',
  pause: '<rect class="f" x="6.5" y="5" width="4" height="14" rx="1"/><rect class="f" x="13.5" y="5" width="4" height="14" rx="1"/>',
  stop: '<rect class="f" x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  prev: '<path d="M18 6.5 10 12l8 5.5zM6.5 6v12"/>',
  next: '<path d="M6 6.5 14 12l-8 5.5zM17.5 6v12"/>',
  back15: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/><path d="M10 10v5M13 10h2.5v1.8H13V15h2.5"/>',
  fwd30: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"/><path d="M8.5 10h2.2v2.4H9.2h1.5V15H8.5M13.2 10h2.3v5h-2.3z"/>',
  vol: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
  radio: '<rect x="3" y="8.5" width="18" height="12" rx="2"/><path d="M7 8.5 16 4"/><circle cx="8.5" cy="14.5" r="2.5"/><path d="M14 13h3.5M14 16h3.5"/>',
  music: '<path d="M9 17.5V5.5l10.5-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17" cy="15.5" r="2.5"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h13v14h-13a2 2 0 0 0-2 2zM4.5 19.5a2 2 0 0 0 2 2h13v-4"/><path d="M8.5 7.5h7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  phones: '<path d="M4 15.5V12a8 8 0 0 1 16 0v3.5"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filenew: '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M13.5 3v5.5H19M12 11.5v6M9 14.5h6"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  save: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16"/>',
  sine: '<path d="M2.5 12c1.6-5.3 3.2-7 4.75-7S10 6.7 11.9 12s3.2 7 4.85 7 3.1-1.7 4.75-7"/>',
  pu: '<path d="M18.5 5.5l-13 13"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  resistor: '<path d="M2 12h3.5l1.6-4.5 3.2 9 3.2-9 3.2 9 1.6-4.5H22"/>',
  motor: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5v-7l3.5 4.6 3.5-4.6v7"/>',
  fault: '<path d="M13.5 2.5 8.5 10h4.5l-1.8 5.5"/><path d="M12 15.5v2.5M6 18h12M8.5 20.5h7M11 22.5h2"/>',
};
const NS = 'http://www.w3.org/2000/svg';
/** -> an <svg class="ic"> element; the size and colour come from CSS. */
export function icon(name, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls ? 'ic ' + cls : 'ic');
  s.innerHTML = I[name] || '';
  return s;
}
