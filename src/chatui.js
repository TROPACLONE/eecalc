/* EE Calc — chat screen (global public room, text and emoji only, nothing stored). */
import { Chat, MAX_LEN } from './chat.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';

const MAX_SHOWN = 200;
const TIME = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });   // built once (per message it was ~50 µs)

export function init(ctx, root) {
  const Pr = ctx.profile;
  let visible = false, used = false, unread = 0;

  const head = h('div', 'chathead');
  const status = h('div', 'chatstatus', 'Offline');
  const nickBtn = h('button', 'chip');
  const me = () => { const p = Pr.get(); nickBtn.textContent = p ? `${Pr.label()} · Lv ${Pr.levelOf(p.xp)}` : ''; };
  me(); Pr.onChange(w => { if (w === 'profile' || (w && w.xp)) me(); });
  head.append(status, nickBtn);
  const note = h('div', 'mini chatnote', 'Public room: anyone using EE Calc can read this. Text and emoji only, no links. Messages are not saved.');
  const list = h('div', 'chatlist scroll');
  const form = h('div', 'chatform');
  const input = h('input'); input.type = 'text'; input.maxLength = MAX_LEN; input.enterKeyHint = 'send';
  input.autocomplete = 'off'; input.placeholder = 'Message'; input.setAttribute('aria-label', 'Message');
  const send = h('button', 'btn accent', 'Send');
  form.append(input, send);
  const lock = h('div', 'chatlock');
  const li = h('div', 'lockicon'); li.appendChild(icon('lock'));
  lock.append(li, h('div', null, 'The chat needs an internet connection.'));
  root.replaceChildren(head, note, lock, list, form);

  const chat = new Chat((kind, data) => {
    if (kind === 'state') {
      const s = data.state;
      status.textContent = s === 'online' ? `Online · ${data.info}` : s === 'connecting' ? `Connecting${data.info ? ' to ' + data.info : ''}…` : 'Offline';
      status.className = 'chatstatus ' + s;
      send.disabled = s !== 'online';
    } else if (kind === 'message') addMessage(data);
    else if (kind === 'undelivered') {                     // the link died before the message went out: offer it again
      toast('Message not delivered: reconnecting');
      if (!input.value.trim()) input.value = data.text;
    }
  });

  function row(m) {
    const el = h('div', 'msg' + (m.mine ? ' mine' : ''));
    const who = h('div', 'who');
    const name = h('b', null, m.nick);                      // all plain text (textContent), never HTML
    if (m.tag) name.appendChild(h('span', 'tg', '#' + m.tag));
    if (m.level) name.appendChild(h('span', 'lv', 'Lv ' + m.level));
    who.append(name, h('span', null, TIME.format(m.ts)));
    el.append(who, h('div', 'txt', m.text));                 // plain text only: never interpreted as HTML
    return el;
  }
  // messages are added once per frame, in one batch (one layout however many arrive); of a burst only the last
  // MAX_SHOWN are ever built
  let queue = [];
  function addMessage(m) {
    if (!visible && !m.mine) { unread++; ctx.unread(unread); }
    if (queue.push(m) === 1) requestAnimationFrame(flush);
    else if (queue.length > 2 * MAX_SHOWN) queue.splice(0, queue.length - MAX_SHOWN);   // frames pause while hidden
  }
  function flush() {
    const batch = queue.slice(-MAX_SHOWN), mine = queue.some(m => m.mine); queue = [];
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const f = document.createDocumentFragment();
    for (const m of batch) f.appendChild(row(m));
    list.appendChild(f);
    for (let n = list.children.length - MAX_SHOWN; n > 0; n--) list.firstElementChild.remove();
    if (atBottom || mine) list.scrollTop = list.scrollHeight;
  }
  function submit() {
    const p = Pr.get();
    if (!p) { toast('Choose a name first'); return; }
    const err = chat.send(p.name, input.value, p.tag, Pr.levelOf(p.xp));
    if (err) { toast(err); return; }
    input.value = '';
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  nickBtn.addEventListener('click', () => ctx.show('profile'));

  function applyOnline() {
    const online = navigator.onLine;
    lock.hidden = online; list.hidden = !online; form.hidden = !online;
    if (!online) chat.disconnect();
    else if (used && document.visibilityState === 'visible') chat.connect();
  }
  window.addEventListener('online', applyOnline);
  window.addEventListener('offline', applyOnline);
  document.addEventListener('visibilitychange', () => {            // no connection while the app is in the background
    if (document.visibilityState === 'hidden') chat.disconnect();
    else if (used && navigator.onLine) chat.connect();
  });

  return {
    show() { visible = true; used = true; unread = 0; ctx.unread(0); applyOnline(); list.scrollTop = list.scrollHeight; },
    hide() { visible = false; },
  };
}
