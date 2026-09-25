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
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|pt|app|dev|me|co|gg|ly|xyz|info|biz|tv|link|site|online|shop|ru|cn|de|uk|fr|es|br|us|eu|to|cc|tk|ml|ga|gl|sh|ai)\b)/i;
/** -> error text, or null when the message may be sent. */
export function checkText(t) {
  const s = t.replace(/\s+/g, ' ').trim();
  if (!s) return 'Write something first';
  if ([...s].length > MAX_LEN) return `At most ${MAX_LEN} characters`;
  if (!TEXT_OK.test(s)) return 'Only words and emoji are allowed';
  if (LINK.test(s)) return 'Links are not allowed';
  return null;
}
export function checkNick(n) {
  const s = n.trim();
  return NICK_OK.test(s) ? null : 'Nickname: 2–20 letters, digits, spaces, _ - .';
}
/** Parse and validate one received payload; null if it is not a valid chat message. */
export function parseMessage(bytes) {
  if (bytes.length > 2048) return null;
  let o;
  try { o = JSON.parse(dec.decode(bytes)); } catch { return null; }
  if (!o || o.v !== 1 || typeof o.n !== 'string' || typeof o.t !== 'string' || typeof o.id !== 'string') return null;
  if (!/^[0-9a-f]{8}$/.test(o.id) || checkNick(o.n) || checkText(o.t)) return null;
  if (o.g !== undefined && !/^[0-9a-f]{4}$/.test(o.g)) return null;                      // device tag (optional)
  if (o.l !== undefined && !(Number.isInteger(o.l) && o.l >= 1 && o.l <= 9999)) return null; // level (optional)
  const ts = Number(o.ts);
  return { id: o.id, nick: o.n.trim(), tag: o.g || null, level: o.l || null, text: o.t.replace(/\s+/g, ' ').trim(),
    ts: Number.isFinite(ts) ? ts : Date.now() };
}

// ── MQTT 3.1.1 packets ────────────────────────────────────────────────────────────────────────────
function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
const packet = (type, flags, body) => new Uint8Array([(type << 4) | flags, ...varLen(body.length), ...body]);
const CONNECT = (id, keep) => packet(1, 0, [...str('MQTT'), 4, 0b00000010, keep >> 8, keep & 255, ...str(id)]);   // clean session
const SUBSCRIBE = (pid, topic) => packet(8, 2, [pid >> 8, pid & 255, ...str(topic), 0]);
const PUBLISH = (topic, payload) => packet(3, 0, [...str(topic), ...payload]);                                   // QoS 0, no retain
const PINGREQ = () => new Uint8Array([0xc0, 0]);
const DISCONNECT = () => new Uint8Array([0xe0, 0]);

export class Chat {
  /** onEvent(kind, data): 'state' (connecting|online|offline|error), 'message' ({id,nick,text,ts}) */
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.ws = null; this.state = 'offline'; this.buf = new Uint8Array(0);
    this.me = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    this.broker = 0; this.timer = 0; this.pingT = 0; this.lastPong = 0; this.wanted = false; this.sent = [];
  }
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
    clearInterval(this.pingT);
    const wasOnline = this.state === 'online';
    this.ws = null;
    if (!this.wanted) { this.setState('offline'); return; }
    if (!wasOnline) this.broker++;                              // this broker failed: try the next one
    this.setState(navigator.onLine ? 'connecting' : 'offline');
    clearTimeout(this.timer);
    if (navigator.onLine) this.timer = setTimeout(() => this.connect(), wasOnline ? 1500 : 800);
  }
  disconnect() {
    this.wanted = false;
    clearTimeout(this.timer); clearInterval(this.pingT);
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
      if (j < 0 || j + len > b.length) break;
      try { this.handle(b[i] >> 4, b.subarray(j, j + len)); }
      catch { this.buf = new Uint8Array(0); return; }           // malformed packet: drop and resynchronise
      i = j + len;
    }
    this.buf = b.slice(i);
    if (this.buf.length > 65536) this.buf = new Uint8Array(0);   // never let a bad stream grow memory
  }
  handle(type, body) {
    if (type === 2) {                                             // CONNACK
      if (body[1] !== 0) { this.ws.close(); return; }
      this.ws.send(SUBSCRIBE(1, TOPIC));
    } else if (type === 9) {                                      // SUBACK
      this.setState('online', new URL(this.ws.url).hostname);
      this.lastPong = Date.now();
      clearInterval(this.pingT);
      this.pingT = setInterval(() => {
        const ws = this.ws;
        if (!ws) { clearInterval(this.pingT); return; }
        if (Date.now() - this.lastPong > 100000) { ws.close(); return; }
        if (ws.readyState === 1) ws.send(PINGREQ());
      }, 30000);
    } else if (type === 13) this.lastPong = Date.now();           // PINGRESP
    else if (type === 3) {                                        // PUBLISH (QoS 0)
      const tl = (body[0] << 8) | body[1], t = TOPIC_BYTES();
      if (tl !== t.length || body.length < 2 + tl || t.some((x, i) => body[2 + i] !== x)) return;   // compare bytes, no decoding
      const msg = parseMessage(body.subarray(2 + tl));
      if (msg) this.onEvent('message', { ...msg, mine: msg.id === this.me });
    }
  }
  /** -> null if sent, or the reason it was not. */
  send(nick, text, tag, level) {
    const e = checkNick(nick) || checkText(text);
    if (e) return e;
    if (this.state !== 'online') return 'Not connected';
    const now = Date.now();
    this.sent = this.sent.filter(t => now - t < 60000);
    if (this.sent.length && now - this.sent[this.sent.length - 1] < 1500) return 'Slow down a little';
    if (this.sent.length >= 20) return 'At most 20 messages per minute';
    this.sent.push(now);
    const o = { v: 1, id: this.me, n: nick.trim(), t: text.replace(/\s+/g, ' ').trim(), ts: now };
    if (/^[0-9a-f]{4}$/.test(tag || '')) o.g = tag;
    if (Number.isInteger(level) && level >= 1 && level <= 9999) o.l = level;
    const payload = enc.encode(JSON.stringify(o));
    this.ws.send(PUBLISH(TOPIC, payload));
    return null;
  }
}
