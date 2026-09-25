/*
 EE Calc — global chat.

 A tiny MQTT 3.1.1 client over secure WebSocket (no library) talking to free public brokers.
 Messages are published with QoS 0 and without "retain", on a clean session, so brokers only relay them:
 nothing is stored, and a message disappears once delivered. Only text and emoji are accepted — no
 files, images or links — and everything received is validated and shown as plain text.
*/
export const BROKERS = globalThis.__EECALC_BROKERS || ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
export const TOPIC = 'eecalc/v1/global/7c1f9e2a4b';
export const MAX_LEN = 300;
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const TOPIC_BYTES = () => (TOPIC_BYTES.v ||= enc.encode(TOPIC));

// ── validation (applied to what we send and to everything we receive) ────────────────────────────
const TEXT_OK = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Extended_Pictographic}\u200D\uFE0F\u20E3 ]+$/u;
const NICK_OK = /^[\p{L}\p{N}_\-. ]{2,20}$/u;
// characters that look like nothing (Hangul fillers, the blank Braille pattern) and "Zalgo" runs of combining marks,
// which draw over the neighbouring messages; legitimate text never needs 4 marks on one letter
export const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u2800]/u;
const MARK_RUN = /\p{M}{4,}/u;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|pt|app|dev|me|co|gg|ly|xyz|info|biz|tv|link|site|online|shop|ru|cn|de|uk|fr|es|br|us|eu|to|cc|tk|ml|ga|gl|sh|ai)\b)/i;
/** -> error text, or null when the message may be sent. */
export function checkText(t) {
  const s = t.replace(/\s+/g, ' ').trim();
  if (!s) return 'Write something first';
  if ([...s].length > MAX_LEN) return `At most ${MAX_LEN} characters`;
  if (!TEXT_OK.test(s) || INVISIBLE.test(s) || MARK_RUN.test(s)) return 'Only words and emoji are allowed';
  if (LINK.test(s)) return 'Links are not allowed';
  return null;
}
export function checkNick(n) {
  const s = n.trim();
  return NICK_OK.test(s) && !INVISIBLE.test(s) ? null : 'Nickname: 2–20 letters, digits, spaces, _ - .';
}
/** Parse and validate one received payload; null if it is not a valid chat message. */
export function parseMessage(bytes) {
  if (bytes.length > 2048) return null;
  let o;
  try { o = JSON.parse(dec.decode(bytes)); } catch { return null; }
  if (!o || o.v !== 1 || typeof o.n !== 'string' || typeof o.t !== 'string' || typeof o.id !== 'string') return null;
  if (!/^[0-9a-f]{8}$/.test(o.id) || checkNick(o.n) || checkText(o.t)) return null;
  if (o.g !== undefined && !(typeof o.g === 'string' && /^[0-9a-f]{4}$/.test(o.g))) return null;   // device tag (optional)
  if (o.l !== undefined && !(Number.isInteger(o.l) && o.l >= 1 && o.l <= 9999)) return null;       // level (optional)
  if (o.k !== undefined && !(typeof o.k === 'string' && /^[0-9a-f]{8}$/.test(o.k))) return null;   // sender's nonce
  // the time shown is when it arrived: a sender's clock (or a forged "ts") is not trusted
  return { id: o.id, nick: o.n.trim(), tag: o.g || null, level: o.l || null, text: o.t.replace(/\s+/g, ' ').trim(),
    k: o.k || null, ts: Date.now() };
}

// ── MQTT 3.1.1 packets ────────────────────────────────────────────────────────────────────────────
function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
const packet = (type, flags, body) => new Uint8Array([(type << 4) | flags, ...varLen(body.length), ...body]);
const CONNECT = (id, keep) => packet(1, 0, [...str('MQTT'), 4, 0b00000010, keep >> 8, keep & 255, ...str(id)]);   // clean session
const SUBSCRIBE = (pid, topic) => packet(8, 2, [pid >> 8, pid & 255, ...str(topic), 0]);
const PUBLISH = (topic, payload) => packet(3, 0, [...str(topic), ...payload]);                                   // QoS 0, no retain
const PINGREQ = () => new Uint8Array([0xc0, 0]);
const MAX_PACKET = 65536;                                         // a larger packet is never a chat message
const DISCONNECT = () => new Uint8Array([0xe0, 0]);

export class Chat {
  /** onEvent(kind, data): 'state' (connecting|online|offline|error), 'message' ({id,nick,text,ts}) */
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.ws = null; this.state = 'offline'; this.buf = new Uint8Array(0);
    this.me = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    this.broker = 0; this.timer = 0; this.pingT = 0; this.pongT = 0; this.lastPong = 0; this.wanted = false; this.sent = [];
    this.fails = 0; this.since = 0; this.nonces = []; this.rx = new Map(); this.waiting = new Map();
  }
  /** Messages sent but not yet echoed back when the link goes: the user is told (their text comes back to the input). */
  lost() {
    const texts = [...this.waiting.values()].map(w => (clearTimeout(w.t), w.text));
    this.waiting.clear();
    if (texts.length) this.onEvent('undelivered', { text: texts[texts.length - 1] });
  }
  /** Drops a socket at once (no waiting for its close event, which a dead link may deliver much later). */
  drop(ws) { if (this.ws !== ws) return; try { ws.close(); } catch { /* already closed */ } this.closed(); }
  setState(s, info) { this.state = s; this.onEvent('state', { state: s, info }); }
  connect() {
    this.wanted = true;
    if (this.ws || !navigator.onLine) { if (!navigator.onLine) this.setState('offline'); return; }
    const url = BROKERS[this.broker % BROKERS.length];
    this.setState('connecting', new URL(url).hostname);
    let ws;
    try { ws = new WebSocket(url, ['mqtt']); } catch { this.fail(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws; this.buf = new Uint8Array(0);
    const guard = setTimeout(() => { if (this.state === 'connecting') ws.close(); }, 8000);
    // events from a socket that is no longer the current one (closed on purpose) are ignored
    ws.onopen = () => { if (this.ws === ws) ws.send(CONNECT(`eecalc-${this.me}`, 45)); };
    ws.onmessage = e => { if (this.ws === ws) this.receive(new Uint8Array(e.data)); };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(guard); if (this.ws === ws) this.closed(); };
  }
  fail() { this.closed(); }
  closed() {
    clearInterval(this.pingT); clearTimeout(this.pongT); this.lost();
    // a link that stayed up for 30 s was fine: reconnect at once; anything shorter (a broker that accepts and then
    // drops us, an unreachable one, a captive portal) counts as a failure: next broker, 0.8 s doubling up to 30 s
    const stable = this.state === 'online' && performance.now() - this.since > 30000;
    this.ws = null;
    if (!this.wanted) { this.setState('offline'); return; }
    if (stable) this.fails = 0; else { this.broker++; this.fails++; }
    this.setState(navigator.onLine ? 'connecting' : 'offline');
    clearTimeout(this.timer);
    const wait = stable ? 1500 : Math.min(30000, 800 * 2 ** (this.fails - 1));
    if (navigator.onLine) this.timer = setTimeout(() => this.connect(), wait);
  }
  disconnect() {
    this.wanted = false;
    clearTimeout(this.timer); clearInterval(this.pingT); clearTimeout(this.pongT); this.lost();
    const ws = this.ws;
    this.ws = null;                                              // detach first: late events are ignored
    if (ws) { try { if (ws.readyState === 1) ws.send(DISCONNECT()); ws.close(); } catch { /* already closed */ } }
    this.setState('offline');
  }
  receive(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length);
    let i = 0;
    for (;;) {                                                   // MQTT packets may be split across or packed into frames
      if (b.length - i < 2) break;
      let len = 0, mul = 1, j = i + 1, byte;
      do { if (j >= b.length) { j = -1; break; } byte = b[j++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128 && mul < 2 ** 28);
      if (j >= 0 && len > MAX_PACKET) { this.buf = new Uint8Array(0); this.drop(this.ws); return; }   // can't resync: reconnect
      if (j < 0 || j + len > b.length) break;
      try { this.handle(b[i] >> 4, b.subarray(j, j + len)); }
      catch { this.buf = new Uint8Array(0); this.drop(this.ws); return; }   // malformed packet: reconnect clean
      if (!this.ws) return;                                      // the packet closed the link
      i = j + len;
    }
    this.buf = b.slice(i);                                       // at most one incomplete packet (≤ MAX_PACKET)
  }
  handle(type, body) {
    if (type === 2) {                                             // CONNACK
      if (body[1] !== 0) { this.drop(this.ws); return; }
      this.ws.send(SUBSCRIBE(1, TOPIC));
    } else if (type === 9) {                                      // SUBACK: return code 0x80 = subscription refused
      if (body.length < 3 || body[2] & 0x80) { this.drop(this.ws); return; }
      this.since = performance.now();
      this.setState('online', new URL(this.ws.url).hostname);
      clearInterval(this.pingT);
      // a ping every 20 s (keep-alive 45 s); no answer within 8 s means the link is dead: reconnect
      this.pingT = setInterval(() => {
        const ws = this.ws;
        if (!ws) { clearInterval(this.pingT); return; }
        if (ws.readyState !== 1) return;
        const at = performance.now();
        ws.send(PINGREQ());
        clearTimeout(this.pongT);
        this.pongT = setTimeout(() => { if (this.ws === ws && this.lastPong < at) this.drop(ws); }, 8000);
      }, 20000);
    } else if (type === 13) this.lastPong = performance.now();    // PINGRESP
    else if (type === 3) {                                        // PUBLISH (QoS 0)
      const tl = (body[0] << 8) | body[1], t = TOPIC_BYTES();
      if (tl !== t.length || body.length < 2 + tl || t.some((x, i) => body[2 + i] !== x)) return;   // compare bytes, no decoding
      const msg = parseMessage(body.subarray(2 + tl));
      if (!msg) return;
      const w = msg.id === this.me && this.waiting.get(msg.k);    // our own message came back: it was delivered
      if (w) { clearTimeout(w.t); this.waiting.delete(msg.k); }
      if (this.flooding(msg.id)) return;
      // "mine" only for a nonce this client sent (an id alone can be copied by anyone)
      this.onEvent('message', { ...msg, mine: msg.id === this.me && this.nonces.includes(msg.k) });
    }
  }
  /** Incoming limit per sender (the sending limits live only in the client, 1 per 1.5 s and 20 per minute): more
   *  than 5 in 5 s or 25 in a minute is a flood, dropped before it costs any rendering. The margin allows for
   *  messages that the network delivers bunched together. */
  flooding(id) {
    const now = performance.now(), t = (this.rx.get(id) || []).filter(x => now - x < 60000);
    if (this.rx.size > 500) for (const [k, v] of this.rx) if (!v.length || now - v[v.length - 1] > 60000) this.rx.delete(k);
    const flood = t.filter(x => now - x < 5000).length >= 5 || t.length >= 25;
    if (!flood) t.push(now);
    this.rx.set(id, t);
    return flood;
  }
  /** -> null if sent, or the reason it was not. */
  send(nick, text, tag, level) {
    const e = checkNick(nick) || checkText(text);
    if (e) return e;
    if (this.state !== 'online') return 'Not connected';
    const now = performance.now();                             // not the wall clock: changing it can't block or lift the limit
    this.sent = this.sent.filter(t => now - t < 60000);
    if (this.sent.length && now - this.sent[this.sent.length - 1] < 1500) return 'Slow down a little';
    if (this.sent.length >= 20) return 'At most 20 messages per minute';
    this.sent.push(now);
    const k = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    this.nonces.push(k); if (this.nonces.length > 40) this.nonces.shift();
    const o = { v: 1, id: this.me, k, n: nick.trim(), t: text.replace(/\s+/g, ' ').trim(), ts: Date.now() };
    if (/^[0-9a-f]{4}$/.test(tag || '')) o.g = tag;
    if (Number.isInteger(level) && level >= 1 && level <= 9999) o.l = level;
    const payload = enc.encode(JSON.stringify(o)), ws = this.ws;
    ws.send(PUBLISH(TOPIC, payload));
    // the broker relays our own message back to us (we are subscribed): no echo within 6 s means the link is dead
    this.waiting.set(k, { text: o.t, t: setTimeout(() => { if (this.ws === ws && this.waiting.has(k)) this.drop(ws); }, 6000) });
    return null;
  }
}
