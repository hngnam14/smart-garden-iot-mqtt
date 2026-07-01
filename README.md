# Smart Garden IoT Web MQTT

Dự án mẫu về vườn thông minh IoT gồm frontend, backend và Web MQTT qua WebSocket. Backend tự tạo broker publish/subscribe theo topic kiểu MQTT, web dashboard kết nối trực tiếp bằng `ws://localhost:3100/mqtt`.

## Chức năng

- Hiển thị dữ liệu cảm biến: nhiệt độ, độ ẩm không khí, độ ẩm đất, ánh sáng, mưa và mực nước.
- Điều khiển thiết bị: máy bơm tưới cây, đèn trồng cây, quạt phun sương và mái che tự động.
- Truyền dữ liệu thời gian thực bằng topic MQTT qua WebSocket.
- Backend có API lấy trạng thái ban đầu.
- Có cảnh báo khi đất khô, mực nước thấp hoặc nhiệt độ cao.

## Cấu trúc thư mục

```text
smart-garden-iot-mqtt/
├── backend/
│   └── server.js
├── firmware/
│   └── esp32_smart_garden_iot.cpp
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
└── README.md
```

## Cài đặt và chạy

Cần cài Node.js 18 trở lên. Project này không cần cài thêm thư viện ngoài.

```bash
cd smart-garden-iot-mqtt
npm start
```

Mở trình duyệt:

```text
http://localhost:3100
```

Web MQTT endpoint:

```text
ws://localhost:3100/mqtt
```

## Web MQTT Topics

| Mục đích | Topic | Payload mẫu |
|---|---|---|
| Dữ liệu cảm biến | `garden/sensor/telemetry` | `{"temperature":29.5,"humidity":65,"soilMoisture":52,"light":70,"rain":false,"waterLevel":80}` |
| Gửi lệnh điều khiển | `garden/device/{deviceId}/set` | `{"state":"ON"}` |
| Nhận trạng thái thiết bị | `garden/device/{deviceId}/state` | `{"id":"water_pump","name":"Máy bơm tưới cây","state":"ON"}` |
| Cảnh báo | `garden/alert` | `{"level":"warning","message":"Cảnh báo vườn cần kiểm tra độ ẩm đất, nước hoặc nhiệt độ"}` |

## Device ID

| Device ID | Thiết bị | Trạng thái |
|---|---|---|
| `water_pump` | Máy bơm tưới cây | `ON` / `OFF` |
| `grow_light` | Đèn trồng cây | `ON` / `OFF` |
| `mist_fan` | Quạt phun sương | `ON` / `OFF` |
| `roof` | Mái che tự động | `OPEN` / `CLOSED` |

## Giải thích nhanh

- `backend/server.js`: tạo HTTP server, tạo WebSocket broker tại `/mqtt`, mô phỏng cảm biến và xử lý lệnh điều khiển.
- `frontend/app.js`: kết nối Web MQTT, subscribe các topic, cập nhật giao diện và publish lệnh điều khiển.
- `frontend/index.html` và `frontend/style.css`: giao diện dashboard vườn thông minh.
- `firmware/esp32_smart_garden_iot.cpp`: code ESP32 đọc cảm biến thật và gửi dữ liệu về dashboard.

## Cách demo với giáo viên

1. Chạy `npm start`.
2. Mở `http://localhost:3100`.
3. Bấm bật/tắt máy bơm, đèn trồng cây, quạt phun sương hoặc mái che.
4. Giải thích: Web publish lệnh vào topic `garden/device/{id}/set`, backend nhận lệnh, cập nhật trạng thái và publish lại topic `garden/device/{id}/state`.
5. Cảm biến được backend mô phỏng và gửi liên tục qua topic `garden/sensor/telemetry`.

## Chạy với ESP32 và cảm biến thật

File firmware nằm tại:

```text
firmware/esp32_smart_garden_iot.cpp
```

Thư viện cần cài trong Arduino IDE hoặc PlatformIO:

| Thư viện | Mục đích |
|---|---|
| `DHT sensor library` | Đọc DHT11/DHT22 |
| `ArduinoJson` | Tạo và đọc gói JSON |
| `WebSockets` by Markus Sattler | Kết nối ESP32 đến `ws://server:3100/mqtt` |

Sơ đồ chân mặc định:

| Thiết bị | Chân ESP32 |
|---|---|
| DHT11/DHT22 data | GPIO 4 |
| Cảm biến độ ẩm đất analog | GPIO 34 |
| LDR analog | GPIO 35 |
| Cảm biến mưa | GPIO 27 |
| Cảm biến mực nước analog | GPIO 32 |
| Relay máy bơm | GPIO 18 |
| Relay đèn trồng cây | GPIO 19 |
| Relay quạt phun sương | GPIO 21 |
| Relay mái che | GPIO 22 |

Cần sửa 3 dòng trong file C++:

```cpp
const char* WIFI_SSID = "TEN_WIFI";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char* SERVER_HOST = "192.168.1.10";
```

`SERVER_HOST` là IP máy tính đang chạy lệnh `npm start`. ESP32 và máy tính phải cùng mạng WiFi.
