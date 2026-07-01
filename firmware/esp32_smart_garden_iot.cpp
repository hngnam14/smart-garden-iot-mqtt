#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// Sửa theo WiFi và IP máy tính đang chạy backend Node.js.
const char* WIFI_SSID = "TEN_WIFI";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char* SERVER_HOST = "192.168.1.10";
const uint16_t SERVER_PORT = 3100;
const char* SERVER_PATH = "/mqtt";

// Chân cảm biến.
#define DHT_PIN 4
#define DHT_TYPE DHT11
#define SOIL_PIN 34
#define LDR_PIN 35
#define RAIN_PIN 27
#define WATER_LEVEL_PIN 32

// Chân relay điều khiển thiết bị.
#define RELAY_PUMP 18
#define RELAY_LIGHT 19
#define RELAY_MIST_FAN 21
#define RELAY_ROOF 22

DHT dht(DHT_PIN, DHT_TYPE);
WebSocketsClient webSocket;

unsigned long lastTelemetryMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 2500;

void setRelay(uint8_t pin, bool on) {
  // Nhiều module relay kích mức LOW. Nếu relay của bạn kích mức HIGH,
  // đổi LOW/HIGH ở hai dòng dưới.
  digitalWrite(pin, on ? LOW : HIGH);
}

void publishJson(const char* topic, JsonDocument& payload) {
  StaticJsonDocument<384> packet;
  packet["type"] = "publish";
  packet["topic"] = topic;
  packet["payload"] = payload.as<JsonObject>();

  String message;
  serializeJson(packet, message);
  webSocket.sendTXT(message);
}

void subscribeTopic(const char* topic) {
  StaticJsonDocument<128> packet;
  packet["type"] = "subscribe";
  packet["topic"] = topic;

  String message;
  serializeJson(packet, message);
  webSocket.sendTXT(message);
}

void publishDeviceState(const char* id, const char* name, const char* icon, const char* state) {
  char topic[80];
  snprintf(topic, sizeof(topic), "garden/device/%s/state", id);

  StaticJsonDocument<192> payload;
  payload["id"] = id;
  payload["name"] = name;
  payload["icon"] = icon;
  payload["state"] = state;
  payload["ts"] = millis();

  publishJson(topic, payload);
}

void applyDeviceCommand(const char* deviceId, const char* state) {
  if (strcmp(deviceId, "water_pump") == 0) {
    setRelay(RELAY_PUMP, strcmp(state, "ON") == 0);
    publishDeviceState("water_pump", "Máy bơm tưới cây", "pump", state);
  } else if (strcmp(deviceId, "grow_light") == 0) {
    setRelay(RELAY_LIGHT, strcmp(state, "ON") == 0);
    publishDeviceState("grow_light", "Đèn trồng cây", "light", state);
  } else if (strcmp(deviceId, "mist_fan") == 0) {
    setRelay(RELAY_MIST_FAN, strcmp(state, "ON") == 0);
    publishDeviceState("mist_fan", "Quạt phun sương", "mist", state);
  } else if (strcmp(deviceId, "roof") == 0) {
    setRelay(RELAY_ROOF, strcmp(state, "OPEN") == 0);
    publishDeviceState("roof", "Mái che tự động", "roof", state);
  }
}

void handleWebMqttMessage(const String& text) {
  StaticJsonDocument<768> packet;
  DeserializationError error = deserializeJson(packet, text);
  if (error) return;

  const char* type = packet["type"] | "";
  const char* topic = packet["topic"] | "";
  if (strcmp(type, "message") != 0) return;

  char deviceId[32];
  if (sscanf(topic, "garden/device/%31[^/]/set", deviceId) == 1) {
    const char* state = packet["payload"]["state"] | "";
    applyDeviceCommand(deviceId, state);
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] connected");
      subscribeTopic("garden/device/+/set");
      publishDeviceState("water_pump", "Máy bơm tưới cây", "pump", "OFF");
      publishDeviceState("grow_light", "Đèn trồng cây", "light", "OFF");
      publishDeviceState("mist_fan", "Quạt phun sương", "mist", "OFF");
      publishDeviceState("roof", "Mái che tự động", "roof", "CLOSED");
      break;

    case WStype_TEXT:
      {
        String text;
        text.reserve(length);
        for (size_t i = 0; i < length; i += 1) {
          text += (char)payload[i];
        }
        handleWebMqttMessage(text);
      }
      break;

    case WStype_DISCONNECTED:
      Serial.println("[WS] disconnected");
      break;

    default:
      break;
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.localIP());
}

void publishTelemetry() {
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature)) temperature = 0;
  if (isnan(humidity)) humidity = 0;

  int soilRaw = analogRead(SOIL_PIN);
  int lightRaw = analogRead(LDR_PIN);
  int waterRaw = analogRead(WATER_LEVEL_PIN);
  bool rain = digitalRead(RAIN_PIN) == LOW;

  int soilMoisture = map(soilRaw, 4095, 0, 0, 100);
  int lightPercent = map(lightRaw, 0, 4095, 100, 0);
  int waterLevel = map(waterRaw, 0, 4095, 0, 100);

  soilMoisture = constrain(soilMoisture, 0, 100);
  lightPercent = constrain(lightPercent, 0, 100);
  waterLevel = constrain(waterLevel, 0, 100);

  StaticJsonDocument<256> payload;
  payload["temperature"] = roundf(temperature * 10) / 10.0;
  payload["humidity"] = roundf(humidity * 10) / 10.0;
  payload["soilMoisture"] = soilMoisture;
  payload["light"] = lightPercent;
  payload["rain"] = rain;
  payload["waterLevel"] = waterLevel;
  payload["ts"] = millis();

  publishJson("garden/sensor/telemetry", payload);

  if (soilMoisture < 35 || waterLevel < 25 || temperature > 40) {
    StaticJsonDocument<256> alert;
    alert["level"] = "warning";
    alert["message"] = "Cảnh báo vườn cần kiểm tra độ ẩm đất, nước hoặc nhiệt độ";
    alert["ts"] = millis();
    publishJson("garden/alert", alert);
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(RAIN_PIN, INPUT);
  pinMode(RELAY_PUMP, OUTPUT);
  pinMode(RELAY_LIGHT, OUTPUT);
  pinMode(RELAY_MIST_FAN, OUTPUT);
  pinMode(RELAY_ROOF, OUTPUT);

  setRelay(RELAY_PUMP, false);
  setRelay(RELAY_LIGHT, false);
  setRelay(RELAY_MIST_FAN, false);
  setRelay(RELAY_ROOF, false);

  dht.begin();
  connectWiFi();

  webSocket.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();

  if (millis() - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = millis();
    publishTelemetry();
  }
}
