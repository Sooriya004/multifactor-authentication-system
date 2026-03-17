# ESP32 Smart Lock Firmware (Chained MFA)

## Hardware Profile (This Build)
- EM18 RFID reader (UART, 125 kHz)
- R307S fingerprint sensor (UART)
- 4x4 matrix keypad
- 0.96 inch SSD1306 OLED (I2C)
- Buzzer

## What It Does
- Executes chained MFA for web unlock sessions in backend order:
  - Polls `/api/unlock/pending/next`
  - Captures the current factor (`current_method`)
  - Verifies via `/api/auth/verify`
  - Updates state via `PATCH /api/unlock/{session_id}`
  - Continues until backend returns `status=success`
- Handles credential registration initiated from web app:
  - Fingerprint: `/api/device/register_check` -> `/api/device/register_complete`
  - RFID/Keypad: `/api/device/credential_check` -> `/api/device/credential_complete`
- Handles lockout alert when failures exceed threshold:
  - `/api/device/alert`

## Required Arduino Libraries
- `ArduinoJson` (v6+)
- `Adafruit Fingerprint Sensor Library`
- `Adafruit SSD1306`
- `Adafruit GFX Library`
- `Keypad`

## Default Pin Map in Sketch
- EM18:
  - EM18 TX -> ESP32 `GPIO19` (UART RX)
- R307S:
  - Sensor TX -> ESP32 `GPIO16` (RX2)
  - Sensor RX -> ESP32 `GPIO17` (TX2)
- OLED SSD1306 (I2C):
  - SDA -> `GPIO21`
  - SCL -> `GPIO22`
  - Address -> `0x3C`
- Buzzer -> `GPIO5`
- Keypad 4x4:
  - Rows -> `GPIO32,33,25,26`
  - Cols -> `GPIO27,14,4,18`

## Before Upload
Edit in `esp32_smart_lock.ino`:
- `WIFI_SSID`
- `WIFI_PASSWORD`
- `API_BASE_URL`

This firmware is currently configured in universal mode (no `house_id` or `device_id` sent).
