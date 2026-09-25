// Local MQTT-over-WebSocket broker for testing the chat (the real public brokers are used in the app).
import { Aedes } from 'aedes';
import http from 'http';
import { WebSocketServer, createWebSocketStream } from 'ws';
const aedes = await Aedes.createBroker();
const server = http.createServer();
const wss = new WebSocketServer({ server, handleProtocols: () => 'mqtt' });
wss.on('connection', ws => aedes.handle(createWebSocketStream(ws)));
aedes.on('publish', (p, client) => { if (client && p.retain) console.log('RETAINED MESSAGE (should never happen)'); });
server.listen(8899, () => console.log('broker ready on ws://localhost:8899'));
