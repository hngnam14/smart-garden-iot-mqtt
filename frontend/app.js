const deviceGrid = document.getElementById('deviceGrid');
const eventLog = document.getElementById('eventLog');
const statusDot = document.getElementById('statusDot');
const connectionText = document.getElementById('connectionText');
const brokerText = document.getElementById('brokerText');
const refreshBtn = document.getElementById('refreshBtn');
const alertPanel = document.querySelector('.alert-panel');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');

const sensorEls = {
  temperature: document.getElementById('temperature'),
  humidity: document.getElementById('humidity'),
  soilMoisture: document.getElementById('soilMoisture'),
  light: document.getElementById('light'),
  rain: document.getElementById('rain'),
  waterLevel: document.getElementById('waterLevel'),
  updatedAt: document.getElementById('updatedAt')
};

const devices = {};
const subscriptions = new Map();
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const brokerUrl = `${protocol}://${window.location.host}/mqtt`;
let socket;

brokerText.textContent = brokerUrl;

function connectWebMqtt() {
  socket = new WebSocket(brokerUrl);

  socket.addEventListener('open', () => {
    setConnection('online', 'Đã kết nối Web MQTT');
    subscribe('garden/sensor/telemetry', setTelemetry);
    subscribe('garden/device/+/state', handleDeviceState);
    subscribe('garden/alert', handleAlert);
    logEvent('Kết nối broker thành công');
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== 'message') return;

    subscriptions.forEach((handler, filter) => {
      if (topicMatches(filter, data.topic)) handler(data.payload, data.topic);
    });
  });

  socket.addEventListener('close', () => {
    setConnection('offline', 'Mất kết nối Web MQTT');
    setTimeout(connectWebMqtt, 1200);
  });

  socket.addEventListener('error', () => {
    setConnection('offline', 'Lỗi kết nối Web MQTT');
  });
}

function subscribe(topic, handler) {
  subscriptions.set(topic, handler);
  socket.send(JSON.stringify({ type: 'subscribe', topic }));
}

function publish(topic, payload) {
  socket.send(JSON.stringify({ type: 'publish', topic, payload }));
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

function logEvent(text) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} - ${text}`;
  eventLog.prepend(item);

  while (eventLog.children.length > 16) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

function setConnection(status, text) {
  statusDot.className = `dot ${status}`;
  connectionText.textContent = text;
}

function setTelemetry(data) {
  sensorEls.temperature.textContent = data.temperature;
  sensorEls.humidity.textContent = data.humidity;
  sensorEls.soilMoisture.textContent = data.soilMoisture;
  sensorEls.light.textContent = data.light;
  sensorEls.rain.textContent = data.rain ? 'Có' : 'Không';
  sensorEls.waterLevel.textContent = data.waterLevel;
  sensorEls.updatedAt.textContent = new Date(data.ts).toLocaleTimeString();
}

function isDeviceOn(device) {
  return device.state === 'ON' || device.state === 'OPEN';
}

function nextState(deviceId, device) {
  if (deviceId === 'roof') {
    return device.state === 'CLOSED' ? 'OPEN' : 'CLOSED';
  }

  return device.state === 'ON' ? 'OFF' : 'ON';
}

function renderDevices() {
  deviceGrid.innerHTML = Object.entries(devices)
    .map(([id, device]) => {
      const on = isDeviceOn(device);
      const action = id === 'roof'
        ? (device.state === 'CLOSED' ? 'Mở mái' : 'Đóng mái')
        : (device.state === 'ON' ? 'Tắt' : 'Bật');

      return `
        <article class="device-card">
          <div class="device-title">
            <div>
              <span>${device.icon}</span>
              <strong>${device.name}</strong>
            </div>
            <span class="state-badge ${on ? 'on' : ''}">${device.state}</span>
          </div>
          <button class="toggle-btn" data-id="${id}">${action}</button>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('.toggle-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const state = nextState(id, devices[id]);
      publish(`garden/device/${id}/set`, { state });
      logEvent(`Gửi lệnh ${id}: ${state}`);
    });
  });
}

function handleDeviceState(payload) {
  devices[payload.id] = payload;
  renderDevices();
}

function handleAlert(data) {
  alertPanel.classList.add('warning');
  alertTitle.textContent = 'Cảnh báo từ khu vườn';
  alertMessage.textContent = data.message;
  logEvent(`Cảnh báo: ${data.message}`);
}

async function loadInitialState() {
  const response = await fetch('/api/state');
  const data = await response.json();

  Object.assign(devices, data.devices);
  setTelemetry(data.telemetry);
  renderDevices();
}

refreshBtn.addEventListener('click', loadInitialState);
loadInitialState();
connectWebMqtt();
