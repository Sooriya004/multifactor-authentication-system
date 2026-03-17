/*
  FortiNest ESP32 Smart Lock Firmware (Chained MFA)
  -------------------------------------------------
  Hardware profile:
  - EM18 RFID reader (UART)
  - R307S fingerprint sensor (UART)
  - 4x4 matrix keypad
  - 0.96 inch SSD1306 OLED (I2C)
  - Buzzer

  Chained MFA flow:
  1) Poll /api/unlock/pending/next
  2) Execute current factor (current_method)
  3) Verify with /api/auth/verify
  4) PATCH /api/unlock/{id} with success/failure
  5) If response status=authenticating, continue with returned current_method
  6) If response status=success, show success prompt

  Registration flow:
  - Fingerprint: /api/device/register_check -> enroll -> /api/device/register_complete
  - RFID/Keypad: /api/device/credential_check -> capture -> /api/device/credential_complete
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Keypad.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>

// -------------------- User Config --------------------
const char* WIFI_SSID = "Summa";
const char* WIFI_PASSWORD = "123456789";

// Backend URL reachable from ESP32 on the same Wi-Fi network.
const char* API_BASE_URL = "http://10.72.39.61:8080";

// Universal mode: no house/device scoping.

// -------------------- Pin Mapping --------------------
// EM18: connect EM18 TX -> ESP32 RX pin below
const int EM18_RX_PIN = 19;

// R307S fingerprint
const int FINGERPRINT_RX_PIN = 16;  // ESP32 RX2
const int FINGERPRINT_TX_PIN = 17;  // ESP32 TX2

// OLED (SSD1306 I2C)
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const uint8_t OLED_I2C_ADDR = 0x3C;
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;

const int BUZZER_PIN = 5;

// 4x4 keypad
const byte KEYPAD_ROWS = 4;
const byte KEYPAD_COLS = 4;
char KEYPAD_KEYS[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte KEYPAD_ROW_PINS[KEYPAD_ROWS] = {32, 33, 25, 26};
byte KEYPAD_COL_PINS[KEYPAD_COLS] = {27, 14, 4, 18};

// -------------------- Behavior --------------------
const uint8_t MAX_FAILED_ATTEMPTS = 4;     // Alert when attempts > 4
const uint32_t FACTOR_TIMEOUT_MS = 30000;

const uint32_t UNLOCK_POLL_INTERVAL_MS = 1500;
const uint32_t REGISTRATION_POLL_INTERVAL_MS = 2500;
const uint32_t WIFI_RETRY_INTERVAL_MS = 10000;

// -------------------- Hardware objects --------------------
HardwareSerial em18Serial(1);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger(&fingerSerial);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
Keypad keypad = Keypad(makeKeymap(KEYPAD_KEYS), KEYPAD_ROW_PINS, KEYPAD_COL_PINS, KEYPAD_ROWS, KEYPAD_COLS);

// -------------------- Runtime --------------------
uint8_t g_failedAttempts = 0;
unsigned long g_lastUnlockPollMs = 0;
unsigned long g_lastFingerprintRegPollMs = 0;
unsigned long g_lastCredentialRegPollMs = 0;
unsigned long g_lastWifiRetryMs = 0;
unsigned long g_lastIdleStatusMs = 0;
bool g_busy = false;
bool g_backendReachable = false;
uint8_t g_backendFailureStreak = 0;
String g_em18Buffer = "";

// -------------------- OLED --------------------
void oledShow(const String& l1, const String& l2 = "", const String& l3 = "", const String& l4 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(l1);
  if (l2.length()) display.println(l2);
  if (l3.length()) display.println(l3);
  if (l4.length()) display.println(l4);
  display.display();
}

// -------------------- Utilities --------------------
String buildUrl(const String& path) {
  String base(API_BASE_URL);
  if (base.endsWith("/") && path.startsWith("/")) return base.substring(0, base.length() - 1) + path;
  if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
  return base + path;
}

String withHouseQuery(const String& path) {
  return path;
}

String jsonToString(const JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  return out;
}

bool sendJsonRequest(const char* method, const String& path, const String& body, DynamicJsonDocument& outDoc, int& statusCode) {
  statusCode = -1;
  outDoc.clear();

  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(buildUrl(path));
  http.addHeader("Content-Type", "application/json");

  if (strcmp(method, "GET") == 0) statusCode = http.GET();
  else if (strcmp(method, "POST") == 0) statusCode = http.POST(body);
  else if (strcmp(method, "PATCH") == 0) statusCode = http.sendRequest("PATCH", body);
  else {
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  if (payload.length() > 0) {
    DeserializationError err = deserializeJson(outDoc, payload);
    if (err) {
      Serial.print("[HTTP] JSON parse error: ");
      Serial.println(err.c_str());
    }
  }
  return statusCode > 0;
}

void beep(uint16_t onMs = 120, uint16_t offMs = 80) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(onMs);
  digitalWrite(BUZZER_PIN, LOW);
  delay(offMs);
}

void buzzerAlertPattern() {
  for (int i = 0; i < 5; i++) beep(220, 120);
}

void indicateAccessGranted() {
  Serial.println("[AUTH] MFA success");
  oledShow("Access verified", "MFA chain passed");
  beep(120, 60);
  beep(120, 60);
}

void connectWifiBlocking() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WIFI] Connecting");
  oledShow("WiFi connecting...");
  uint8_t retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print('.');
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
    oledShow("WiFi connected", WiFi.localIP().toString());
  } else {
    Serial.println("[WIFI] Initial connect failed");
    oledShow("WiFi failed", "Retrying in loop");
  }
}

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - g_lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) return;
  g_lastWifiRetryMs = millis();

  Serial.println("[WIFI] Reconnecting...");
  oledShow("WiFi reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void markBackendCheck(bool ok, const char* endpoint) {
  if (ok) {
    if (!g_backendReachable) {
      Serial.print("[BACKEND] Reachable via ");
      Serial.println(endpoint);
    }
    g_backendReachable = true;
    g_backendFailureStreak = 0;
    return;
  }

  if (g_backendFailureStreak < 255) g_backendFailureStreak++;
  if (g_backendFailureStreak >= 3) g_backendReachable = false;

  if (g_backendFailureStreak == 1 || g_backendFailureStreak % 20 == 0) {
    Serial.print("[BACKEND] Poll failed (");
    Serial.print(endpoint);
    Serial.print("), streak=");
    Serial.println(g_backendFailureStreak);
  }
}

void showIdleStatus() {
  if (g_busy) return;
  if (millis() - g_lastIdleStatusMs < 3000) return;
  g_lastIdleStatusMs = millis();

  if (WiFi.status() != WL_CONNECTED) {
    oledShow("WiFi disconnected", "Check SSID/router");
    return;
  }

  if (!g_backendReachable) {
    oledShow("WiFi connected", "Waiting backend...", "Open website");
    return;
  }

  oledShow("System ready", "Awaiting web action", "Click Start Registration");
}

// -------------------- EM18 RFID --------------------
String readEm18TagNonBlocking() {
  while (em18Serial.available()) {
    char c = (char)em18Serial.read();

    if (c == '\r' || c == '\n') {
      if (g_em18Buffer.length() >= 10) {
        String tag = g_em18Buffer;
        g_em18Buffer = "";
        tag.trim();
        tag.toUpperCase();
        if (tag.length() > 12) tag = tag.substring(tag.length() - 12);
        return tag;
      }
      g_em18Buffer = "";
      continue;
    }

    if (isxdigit((unsigned char)c)) {
      g_em18Buffer += (char)toupper(c);
      if (g_em18Buffer.length() > 12) {
        g_em18Buffer = g_em18Buffer.substring(g_em18Buffer.length() - 12);
      }
    } else {
      g_em18Buffer = "";
    }
  }
  return "";
}

String waitForEm18Tag(uint32_t timeoutMs) {
  Serial.println("[RFID] Waiting for EM18 tag...");
  oledShow("RFID step", "Tap EM18 card/tag");
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    String tag = readEm18TagNonBlocking();
    if (tag.length() > 0) {
      Serial.print("[RFID] Tag: ");
      Serial.println(tag);
      oledShow("RFID captured", tag);
      return tag;
    }
    delay(15);
  }
  Serial.println("[RFID] Timeout");
  oledShow("RFID timeout");
  return "";
}

// -------------------- Keypad --------------------
String waitKeypadCode(const String& title, uint8_t minLen, uint8_t maxLen, uint32_t timeoutMs) {
  String code = "";
  unsigned long start = millis();

  oledShow(title, "Digits to type", "# = submit", "* = clear");

  while (millis() - start < timeoutMs) {
    char key = keypad.getKey();
    if (!key) {
      delay(20);
      continue;
    }

    if (key >= '0' && key <= '9') {
      if (code.length() < maxLen) {
        code += key;
        String masked = "";
        for (size_t i = 0; i < code.length(); i++) masked += "*";
        oledShow(title, masked, "# = submit", "* = clear");
      }
    } else if (key == '*') {
      code = "";
      oledShow(title, "Cleared", "# = submit", "* = clear");
    } else if (key == '#') {
      if (code.length() >= minLen) {
        return code;
      }
      oledShow(title, "Too short", "Try again");
    }
  }

  oledShow(title, "Input timeout");
  return "";
}

// -------------------- Fingerprint (R307S) --------------------
bool waitFingerImage(uint32_t timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) return true;
    if (p != FINGERPRINT_NOFINGER && p != FINGERPRINT_PACKETRECIEVEERR) {
      Serial.print("[FINGER] getImage code: ");
      Serial.println(p);
    }
    delay(40);
  }
  return false;
}

bool waitFingerRemoved(uint32_t timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    if (finger.getImage() == FINGERPRINT_NOFINGER) return true;
    delay(40);
  }
  return false;
}

String waitForFingerprintMatch(uint32_t timeoutMs) {
  oledShow("Fingerprint step", "Place enrolled finger");
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    uint8_t p = finger.getImage();
    if (p != FINGERPRINT_OK) {
      delay(40);
      continue;
    }

    p = finger.image2Tz();
    if (p != FINGERPRINT_OK) {
      delay(40);
      continue;
    }

    p = finger.fingerFastSearch();
    if (p == FINGERPRINT_OK) {
      int id = finger.fingerID;
      oledShow("Fingerprint match", "ID: " + String(id));
      return String(id);
    }
    delay(60);
  }
  oledShow("Fingerprint timeout");
  return "";
}

bool enrollFingerprint(uint16_t fid) {
  oledShow("Enroll fingerprint", "ID: " + String(fid), "Scan 1");
  if (!waitFingerImage(20000)) return false;
  if (finger.image2Tz(1) != FINGERPRINT_OK) return false;

  oledShow("Enroll fingerprint", "Remove finger");
  if (!waitFingerRemoved(10000)) return false;

  oledShow("Enroll fingerprint", "ID: " + String(fid), "Scan 2");
  if (!waitFingerImage(20000)) return false;
  if (finger.image2Tz(2) != FINGERPRINT_OK) return false;

  if (finger.createModel() != FINGERPRINT_OK) return false;
  if (finger.storeModel(fid) != FINGERPRINT_OK) return false;

  oledShow("Fingerprint enrolled", "ID: " + String(fid));
  return true;
}

// -------------------- Backend API helpers --------------------
bool verifyCredential(const String& method, const String& payload, const String& sessionId) {
  DynamicJsonDocument req(384);
  req["method_used"] = (method == "keypad") ? "pin" : method;
  req["payload"] = payload;
  if (sessionId.length() > 0) req["session_id"] = sessionId;

  DynamicJsonDocument res(512);
  int code = -1;
  if (!sendJsonRequest("POST", "/api/auth/verify", jsonToString(req), res, code) || code != 200) {
    Serial.print("[AUTH] verify failed HTTP=");
    Serial.println(code);
    return false;
  }

  String status = res["status"] | "";
  String action = res["action"] | "";
  return (status == "success" && action == "unlock");
}

bool patchUnlockSession(const String& sessionId, const String& status, const String& method, DynamicJsonDocument& outRes) {
  DynamicJsonDocument req(256);
  req["status"] = status;
  if (method.length() > 0) req["current_method"] = method;

  int code = -1;
  String path = "/api/unlock/" + sessionId;
  if (!sendJsonRequest("PATCH", path, jsonToString(req), outRes, code) || code != 200) {
    Serial.print("[SESSION] patch failed HTTP=");
    Serial.println(code);
    return false;
  }
  return true;
}

void sendDeviceAlert(const String& reason, const String& method, const String& sessionId) {
  DynamicJsonDocument req(384);
  req["reason"] = reason;
  req["method"] = method;
  req["failed_attempts"] = g_failedAttempts;
  if (sessionId.length() > 0) req["session_id"] = sessionId;

  DynamicJsonDocument res(256);
  int code = -1;
  sendJsonRequest("POST", "/api/device/alert", jsonToString(req), res, code);
  Serial.print("[ALERT] HTTP=");
  Serial.println(code);
}

void onAuthSuccess() {
  g_failedAttempts = 0;
  indicateAccessGranted();
}

void onAuthFailed(const String& method, const String& sessionId) {
  g_failedAttempts++;
  beep(80, 60);

  oledShow("Access denied", "Attempts: " + String(g_failedAttempts));
  Serial.print("[AUTH] Failed attempts: ");
  Serial.println(g_failedAttempts);

  if (g_failedAttempts > MAX_FAILED_ATTEMPTS) {
    oledShow("Security alert", "Too many failures");
    buzzerAlertPattern();
    sendDeviceAlert("Failed attempt threshold exceeded", method, sessionId);
    g_failedAttempts = 0;
  }
}

String prettyMethodName(const String& method) {
  if (method == "rfid") return "RFID";
  if (method == "fingerprint") return "Fingerprint";
  if (method == "keypad") return "Keypad PIN";
  if (method == "otp") return "OTP";
  return method;
}

int findMethodIndex(JsonArrayConst methods, const String& currentMethod) {
  int idx = 0;
  for (JsonVariantConst item : methods) {
    String m = item.as<String>();
    if (m == currentMethod) {
      return idx;
    }
    idx++;
  }
  return -1;
}

String captureFactorPayload(const String& method) {
  if (method == "rfid") return waitForEm18Tag(FACTOR_TIMEOUT_MS);
  if (method == "fingerprint") return waitForFingerprintMatch(FACTOR_TIMEOUT_MS);
  if (method == "keypad") return waitKeypadCode("PIN step", 4, 8, FACTOR_TIMEOUT_MS);
  if (method == "otp") return waitKeypadCode("OTP step", 6, 6, FACTOR_TIMEOUT_MS);
  return "";
}

bool runChainedSession(const String& sessionId, JsonArrayConst methods, String currentMethod) {
  if (sessionId.length() == 0 || methods.size() == 0) return false;

  if (currentMethod.length() == 0) {
    currentMethod = methods[0].as<String>();
  }

  while (true) {
    Serial.print("[MFA] Current method: ");
    Serial.println(currentMethod);
    int currentIdx = findMethodIndex(methods, currentMethod);
    String stepLine = "Step " + String((currentIdx >= 0 ? currentIdx + 1 : 1)) + "/" + String((int)methods.size());
    oledShow("Web MFA running", stepLine, prettyMethodName(currentMethod));

    String payload = captureFactorPayload(currentMethod);
    if (payload.length() == 0) {
      DynamicJsonDocument patchRes(512);
      patchUnlockSession(sessionId, "failed", currentMethod, patchRes);
      onAuthFailed(currentMethod, sessionId);
      return false;
    }

    bool verified = verifyCredential(currentMethod, payload, sessionId);
    if (!verified) {
      DynamicJsonDocument patchRes(512);
      patchUnlockSession(sessionId, "failed", currentMethod, patchRes);
      onAuthFailed(currentMethod, sessionId);
      return false;
    }

    DynamicJsonDocument patchRes(1024);
    if (!patchUnlockSession(sessionId, "success", currentMethod, patchRes)) {
      onAuthFailed("session_patch_error", sessionId);
      return false;
    }

    String newStatus = patchRes["status"] | "";
    String nextMethod = patchRes["current_method"] | "";

    if (newStatus == "authenticating") {
      if (nextMethod.length() == 0) {
        onAuthFailed("missing_next_method", sessionId);
        return false;
      }
      currentMethod = nextMethod;
      continue;
    }

    if (newStatus == "success") {
      onAuthSuccess();
      return true;
    }

    onAuthFailed(currentMethod, sessionId);
    return false;
  }
}

// -------------------- Registration handlers --------------------
void handleFingerprintRegistration() {
  DynamicJsonDocument res(512);
  int code = -1;
  bool ok = sendJsonRequest("GET", withHouseQuery("/api/device/register_check"), "", res, code);
  markBackendCheck(ok && code == 200, "/api/device/register_check");
  if (!ok || code != 200) return;

  if (!(res["register_fingerprint"] | false)) return;

  int fingerprintId = res["fingerprint_id"] | -1;
  if (fingerprintId <= 0) return;

  Serial.print("[REG] Fingerprint request id=");
  Serial.println(fingerprintId);
  oledShow("Web requested", "Fingerprint enroll", "ID: " + String(fingerprintId));
  bool success = enrollFingerprint((uint16_t)fingerprintId);

  DynamicJsonDocument req(256);
  req["fingerprint_id"] = fingerprintId;
  req["success"] = success;

  DynamicJsonDocument out(512);
  int outCode = -1;
  sendJsonRequest("POST", "/api/device/register_complete", jsonToString(req), out, outCode);

  if (success) {
    oledShow("Registration done", "Fingerprint saved");
    beep(100, 60);
    beep(100, 60);
  } else {
    oledShow("Registration failed", "Fingerprint");
    buzzerAlertPattern();
  }
}

void handleCredentialRegistration() {
  DynamicJsonDocument res(768);
  int code = -1;
  bool ok = sendJsonRequest("GET", withHouseQuery("/api/device/credential_check"), "", res, code);
  markBackendCheck(ok && code == 200, "/api/device/credential_check");
  if (!ok || code != 200) return;

  if (!(res["register_credential"] | false)) return;

  String type = res["credential_type"] | "";
  String requestId = res["request_id"] | "";
  type.toLowerCase();
  if (requestId.length() == 0) return;

  String value = "";
  bool success = false;

  if (type == "rfid") {
    oledShow("Web requested", "RFID registration");
    value = waitForEm18Tag(FACTOR_TIMEOUT_MS);
    success = value.length() > 0;
  } else if (type == "keypad") {
    oledShow("Web requested", "Keypad PIN register");
    value = waitKeypadCode("Enroll PIN", 4, 8, FACTOR_TIMEOUT_MS);
    success = value.length() >= 4;
  } else {
    return;
  }

  DynamicJsonDocument req(512);
  req["request_id"] = requestId;
  req["credential_type"] = type;
  req["credential_value"] = success ? value : "FAILED";
  req["success"] = success;

  DynamicJsonDocument out(512);
  int outCode = -1;
  sendJsonRequest("POST", "/api/device/credential_complete", jsonToString(req), out, outCode);

  if (success) {
    oledShow("Registration done", prettyMethodName(type) + " saved");
    beep(100, 60);
    beep(100, 60);
  } else {
    oledShow("Registration failed", prettyMethodName(type));
    buzzerAlertPattern();
  }
}

// -------------------- Unlock/session polling --------------------
void pollPendingUnlockSession() {
  if (g_busy) return;
  if (millis() - g_lastUnlockPollMs < UNLOCK_POLL_INTERVAL_MS) return;
  g_lastUnlockPollMs = millis();

  DynamicJsonDocument res(1024);
  int code = -1;
  bool ok = sendJsonRequest("GET", withHouseQuery("/api/unlock/pending/next"), "", res, code);
  markBackendCheck(ok && code == 200, "/api/unlock/pending/next");
  if (!ok || code != 200) return;

  String status = res["status"] | "";
  if (status != "pending") return;

  String sessionId = res["session_id"] | "";
  String currentMethod = res["current_method"] | "";
  JsonArrayConst methods = res["auth_methods"].as<JsonArrayConst>();

  if (sessionId.length() == 0 || methods.size() == 0) return;

  g_busy = true;
  Serial.println("[SESSION] Processing pending chained MFA session");
  oledShow("Web unlock request", "Starting MFA chain", "Follow OLED prompts");
  runChainedSession(sessionId, methods, currentMethod);
  oledShow("System idle", "Awaiting web action");
  g_busy = false;
}

void pollRegistrationRequests() {
  if (millis() - g_lastFingerprintRegPollMs >= REGISTRATION_POLL_INTERVAL_MS) {
    g_lastFingerprintRegPollMs = millis();
    handleFingerprintRegistration();
  }

  if (millis() - g_lastCredentialRegPollMs >= REGISTRATION_POLL_INTERVAL_MS) {
    g_lastCredentialRegPollMs = millis();
    handleCredentialRegistration();
  }
}

// -------------------- Setup/Loop --------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // OLED
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("[OLED] SSD1306 init failed");
  }
  oledShow("FortiNest Boot", "Initializing...");

  // EM18 UART
  em18Serial.begin(9600, SERIAL_8N1, EM18_RX_PIN, -1);
  Serial.println("[RFID] EM18 UART ready");

  // Fingerprint UART
  fingerSerial.begin(57600, SERIAL_8N1, FINGERPRINT_RX_PIN, FINGERPRINT_TX_PIN);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("[FINGER] R307S detected");
  } else {
    Serial.println("[FINGER] Sensor not detected");
  }

  connectWifiBlocking();

  oledShow("System ready", "Web chained MFA", "Registration + Verify");
}

void loop() {
  ensureWifiConnected();

  pollRegistrationRequests();
  pollPendingUnlockSession();
  showIdleStatus();

  // Keep EM18 serial buffer fresh even when idle.
  readEm18TagNonBlocking();

  delay(20);
}
