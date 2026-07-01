const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const devices = {
  water_pump: { name: 'Máy bơm tưới cây', icon: 'pump', state: 'OFF' },
  grow_light: { name: 'Đèn trồng cây', icon: 'light', state: 'OFF' },
  mist_fan: { name: 'Quạt phun sương', icon: 'mist', state: 'OFF' },
  roof: { name: 'Mái che tự động', icon: 'roof', state: 'CLOSED' }
};

let telemetry = {
  temperature: 29,
  humidity: 68,
  soilMoisture: 55,
  light: 70,
  rain: false,
  waterLevel: 82,
  ts: Date.now()
};

const clients = new Set();

const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    sendJson(res, {
      devices,
      telemetry,
      topics: {
        telemetry: 'garden/sensor/telemetry',
        alert: 'garden/alert',
        deviceSet: 'garden/device/{deviceId}/set',
        deviceState: 'garden/device/{deviceId}/state'
      }
    });
    return;
  }

  if (req.url === '/health') {
    sendJson(res, { ok: true, broker: 'smart-garden-web-mqtt', port: PORT });
    return;
  }

  serveStatic(req, res);
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/mqtt') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n'));

  const client = { socket, subscriptions: new Set() };
  clients.add(client);
  console.log('[WS] client connected');

  socket.on('data', (buffer) => readFrames(buffer).forEach((text) => handleMessage(client, text)));
  socket.on('close', () => clients.delete(client));
  socket.on('error', () => clients.delete(client));
});

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : decodeURIComponent(req.url);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function topicMatches(filter, topic) {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < filterParts.length; i += 1) {
    if (filterParts[i] === '#') return true;
    if (filterParts[i] !== '+' && filterParts[i] !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}

function publish(topic, payload) {
  const packet = JSON.stringify({ type: 'message', topic, payload });

  clients.forEach((client) => {
    const accepted = Array.from(client.subscriptions).some((filter) => topicMatches(filter, topic));
    if (accepted) sendFrame(client.socket, packet);
  });
}

function handleMessage(client, text) {
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return;
  }

  if (data.type === 'subscribe' && data.topic) {
    client.subscriptions.add(data.topic);
    sendFrame(client.socket, JSON.stringify({ type: 'suback', topic: data.topic }));
    return;
  }

  if (data.type === 'publish' && data.topic) {
    handlePublish(data.topic, data.payload || {});
  }
}

function handlePublish(topic, payload) {
  publish(topic, payload);

  if (topic === 'garden/sensor/telemetry') {
    telemetry = { ...payload, ts: payload.ts || Date.now() };
    return;
  }

  if (topic === 'garden/alert') return;

  const stateMatch = topic.match(/^garden\/device\/([^/]+)\/state$/);
  if (stateMatch && devices[stateMatch[1]]) {
    const deviceId = stateMatch[1];
    devices[deviceId] = { ...devices[deviceId], ...payload, state: payload.state || devices[deviceId].state };
    return;
  }

  const commandMatch = topic.match(/^garden\/device\/([^/]+)\/set$/);
  if (!commandMatch) return;

  const deviceId = commandMatch[1];
  if (!devices[deviceId]) return;

  devices[deviceId].state = normalizeState(deviceId, payload.state);
  publish(`garden/device/${deviceId}/state`, {
    id: deviceId,
    ...devices[deviceId],
    ts: Date.now()
  });
}

function normalizeState(deviceId, state) {
  if (deviceId === 'roof') {
    return state === 'OPEN' ? 'OPEN' : 'CLOSED';
  }

  return state === 'ON' ? 'ON' : 'OFF';
}

function randomBetween(min, max, fixed = 1) {
  return Number((Math.random() * (max - min) + min).toFixed(fixed));
}

function nextTelemetry() {
  telemetry = {
    temperature: randomBetween(24, 36),
    humidity: randomBetween(45, 88),
    soilMoisture: Math.round(randomBetween(20, 90, 0)),
    light: Math.round(randomBetween(10, 100, 0)),
    rain: Math.random() > 0.8,
    waterLevel: Math.round(randomBetween(15, 100, 0)),
    ts: Date.now()
  };

  return telemetry;
}

function readFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const secondByte = buffer[offset + 1];
    let length = secondByte & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    const masked = (secondByte & 0x80) === 0x80;
    const mask = masked ? buffer.slice(cursor, cursor + 4) : null;
    cursor += masked ? 4 : 0;

    if (cursor + length > buffer.length) break;

    const payload = buffer.slice(cursor, cursor + length);
    if (masked) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    messages.push(payload.toString('utf8'));
    offset = cursor + length;
  }

  return messages;
}

function sendFrame(socket, text) {
  const payload = Buffer.from(text);
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[APP] smart garden dashboard: http://localhost:${PORT}`);
  console.log(`[APP] web mqtt endpoint: ws://localhost:${PORT}/mqtt`);

  setInterval(() => {
    const data = nextTelemetry();
    publish('garden/sensor/telemetry', data);

    if (data.soilMoisture < 35 || data.waterLevel < 25 || data.temperature > 34) {
      publish('garden/alert', {
        level: 'warning',
        message: 'Cảnh báo vườn cần kiểm tra độ ẩm đất, nước hoặc nhiệt độ',
        telemetry: data,
        ts: Date.now()
      });
    }
  }, 2500);
});
