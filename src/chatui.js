/* EE Calc — chat screen (global public room, text and emoji only, nothing stored). */
import { Chat, MAX_LEN } from './chat.js';
import { h, toast } from './ui.js';

const MAX_SHOWN = 200;

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
  lock.append(h('div', 'lockicon', '🔒'), h('div', null, 'The chat needs an internet connection.'));
  root.replaceChildren(head, note, lock, list, form);

  const chat = new Chat((kind, data) => {
    if (kind === 'state') {
      const s = data.state;
      status.textContent = s === 'online' ? `Online · ${data.info}` : s === 'connecting' ? `Connecting${data.info ? ' to ' + data.info : ''}…` : 'Offline';
      status.className = 'chatstatus ' + s;
      send.disabled = s !== 'online';
    } else if (kind === 'message') addMessage(data);
  });

  function addMessage(m) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const el = h('div', 'msg' + (m.mine ? ' mine' : ''));
    const who = h('div', 'who');
    const name = h('b', null, m.nick);                      // all plain text (textContent), never HTML
    if (m.tag) name.appendChild(h('span', 'tg', '#' + m.tag));
    if (m.level) name.appendChild(h('span', 'lv', 'Lv ' + m.level));
    who.append(name, h('span', null, new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    el.append(who, h('div', 'txt', m.text));                 // plain text only: never interpreted as HTML
    list.appendChild(el);
    while (list.children.length > MAX_SHOWN) list.firstElementChild.remove();
    if (atBottom || m.mine) list.scrollTop = list.scrollHeight;
    if (!visible && !m.mine) { unread++; ctx.unread(unread); }
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
