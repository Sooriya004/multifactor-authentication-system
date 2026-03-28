#include <WiFi.h>
#include <HTTPClient.h>
#include <Keypad.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ---------------- WIFI & API ----------------
const char* ssid = "Airtel_Summa";
const char* password = "Sooriya2005";

const String API_BASE_URL = "http://192.168.1.11:8000";
const String configURL = API_BASE_URL + "/api/device/config";
const String verifyURL = API_BASE_URL + "/api/auth/verify";
const String registerCheckURL = API_BASE_URL + "/api/device/register_check";
const String registerCompleteRFIDURL = API_BASE_URL + "/api/device/rfid/register_complete";
const String registerCompleteFPURL = API_BASE_URL + "/api/device/register_complete";

// ---------------- RFID (Serial 1) ----------------
HardwareSerial em18Serial(1);
const int EM18_RX_PIN = 19;

// ---------------- FINGERPRINT (Serial 2) ----------------
HardwareSerial fpSerial(2);
const int FP_RX_PIN = 16;
const int FP_TX_PIN = 17;
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// ---------------- BUZZER ----------------
const int BUZZER_PIN = 4;

// ---------------- KEYPAD ----------------
const byte ROWS = 4;
const byte COLS = 4;

char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

byte rowPins[ROWS] = {13,12,14,27};
byte colPins[COLS] = {26,25,33,32};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ---------------- STATE ----------------
unsigned long lastConfigPoll = 0;
const unsigned long CONFIG_POLL_MS = 15000;  // Poll config every 15 seconds

String mfaOrder[3] = {"keypad"};
int mfaCount = 1;

String idleEnteredCode = "";
bool isProcessingSession = false;

unsigned long lastRegisterCheck = 0;
const unsigned long REGISTER_POLL_MS = 10000;  // Check registration every 10 seconds
bool isRegisteringDevice = false; // Covers both RFID and FP
int consecutiveFailures = 0;

// ---------------- DISPLAY ----------------
void showMessage(String l1, String l2="", String l3=""){
  display.clearDisplay();
  display.setCursor(0,0); display.println(l1);
  if(l2!=""){ display.setCursor(0,24); display.println(l2); }
  if(l3!=""){ display.setCursor(0,48); display.println(l3); }
  display.display();
}

void drawCenteredText(String text, int y) {
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text.c_str(), 0, 0, &x1, &y1, &w, &h);
  display.setCursor((SCREEN_WIDTH - w) / 2, y);
  display.print(text);
}

void showLoadingAnimation(String msg) {
  // Animated loading spinner while verifying
  static int frame = 0;
  const char* frames[] = {"|", "/", "-", "\\"};
  
  display.clearDisplay();
  display.setTextSize(1);
  drawCenteredText(msg, 20);
  
  // Draw spinner
  display.setTextSize(2);
  display.setCursor(56, 40);
  display.print(frames[frame % 4]);
  display.setTextSize(1);
  display.display();
  frame++;
}

void showAccessGrantedAnimation() {
  // Frame 1: Door unlock icon expanding
  display.clearDisplay();
  display.drawRect(54, 10, 20, 30, WHITE);
  display.fillRect(70, 22, 6, 6, WHITE);
  display.display();
  delay(400);
  
  // Frame 2: Add checkmark
  display.clearDisplay();
  display.drawRect(54, 10, 20, 30, WHITE);
  display.fillRect(70, 22, 6, 6, WHITE);
  display.drawLine(50, 48, 58, 56, WHITE);
  display.drawLine(58, 56, 78, 36, WHITE);
  display.display();
  delay(400);
  
  // Frame 3: Full display with text
  display.clearDisplay();
  
  // Draw unlock icon
  display.drawRect(54, 5, 20, 25, WHITE);
  display.fillRect(70, 15, 6, 6, WHITE);
  
  // Draw checkmark
  display.drawLine(50, 38, 58, 46, WHITE);
  display.drawLine(58, 46, 78, 26, WHITE);
  
  display.setTextSize(1);
  drawCenteredText("ACCESS GRANTED", 52);
  display.display();
}

void showAccessDeniedAnimation() {
  // Frame 1: Lock icon
  display.clearDisplay();
  display.drawRect(54, 15, 20, 25, WHITE);
  display.fillRect(58, 5, 12, 15, WHITE);
  display.fillRect(60, 7, 8, 11, BLACK);
  display.display();
  delay(350);
  
  // Frame 2: Add X mark
  display.clearDisplay();
  display.drawRect(54, 15, 20, 25, WHITE);
  display.fillRect(58, 5, 12, 15, WHITE);
  display.fillRect(60, 7, 8, 11, BLACK);
  display.drawLine(52, 45, 76, 55, WHITE);
  display.drawLine(52, 55, 76, 45, WHITE);
  display.setTextSize(1);
  drawCenteredText("ACCESS DENIED", 58);
  display.display();
}

void buzzBeep(int onMs, int offMs, int count){
  for(int i=0; i<count; i++){
    digitalWrite(BUZZER_PIN, HIGH);
    delay(onMs);
    digitalWrite(BUZZER_PIN, LOW);
    if(i < count - 1) delay(offMs);
  }
}

void buzzStepPassed(){
  // Short confirmation beep for each successful MFA step.
  buzzBeep(50, 0, 1);
}

void buzzAccessGranted(){
  // Celebratory pattern: ascending tones (simulated with beeps)
  buzzBeep(60, 60, 1);
  delay(40);
  buzzBeep(80, 0, 1);
  delay(40);
  buzzBeep(120, 0, 1);
}

void buzzAccessDenied(){
  // Negative pattern: two short warning beeps.
  buzzBeep(150, 100, 2);
}

void buzzAlertPattern(){
  // High-priority alarm after repeated failed attempts.
  buzzBeep(220, 120, 6);
}

String prettyMethod(String m){
  if(m=="rfid") return "RFID Card";
  if(m=="keypad") return "PIN Code";
  if(m=="otp") return "OTP";
  if(m=="fingerprint") return "Fingerprint";
  return m;
}

void showStepHeader(int step, int total){
  display.clearDisplay();
  display.setCursor(0,0);
  display.print("Step ");
  display.print(step);
  display.print(" of ");
  display.println(total);
  display.display();
}

void showHome(){
  display.clearDisplay();
  
  // Draw decorative border
  display.drawRect(0, 0, 128, 64, WHITE);
  display.drawLine(0, 18, 128, 18, WHITE);
  
  // Header
  display.setTextSize(1);
  drawCenteredText("M.F.A SYSTEM", 5);
  
  // First method prompt
  display.setCursor(8, 26);
  display.print("> ");
  display.print(prettyMethod(mfaOrder[0]));
  
  // Step count if multi-factor
  if(mfaCount > 1){
    display.setCursor(8, 42);
    display.print("  (");
    display.print(mfaCount);
    display.print(" steps)");
  }
  
  // Status indicator
  display.fillCircle(118, 54, 4, WHITE);
  
  display.display();
}

// ---------------- WIFI ----------------
void connectWiFi(){
  showMessage("Connecting WiFi");
  WiFi.begin(ssid,password);
  unsigned long start=millis();
  while(WiFi.status()!=WL_CONNECTED && millis()-start<15000){
    delay(500);
  }
}

bool ensureWiFi(){
  if(WiFi.status()==WL_CONNECTED) return true;
  static unsigned long lastTry=0;
  if(millis()-lastTry>5000){
    lastTry=millis();
    connectWiFi();
  }
  return WiFi.status()==WL_CONNECTED;
}

// ---------------- HTTP ----------------
bool requestJSON(String method,String url,String body, DynamicJsonDocument &doc,int &code){
  code=-1; doc.clear();
  if(!ensureWiFi()) return false;
  
  HTTPClient http;
  http.begin(url);
  http.setTimeout(2500);  // Reduced from 4000ms for better responsiveness
  if(method!="GET") http.addHeader("Content-Type","application/json");

  String raw;
  if(method=="GET") code=http.GET();
  else if(method=="POST") code=http.POST(body);

  raw=(code>0)?http.getString():"";
  http.end();

  if(raw.length()>0){
    DeserializationError err=deserializeJson(doc,raw);
    if(err) return false;
  }
  return code>0;
}

// ---------------- HARDWARE READERS ----------------
String readRFID(){
  static String buffer="";
  while(em18Serial.available()){
    char c=em18Serial.read();
    if(isxdigit((unsigned char)c)){
      buffer += (char)toupper(c);
      if(buffer.length() >= 12){
        String tag = buffer.substring(0,10);
        buffer = "";
        return tag;
      }
    } else {
      buffer="";
    }
  }
  return "";
}

String readFingerprint() {
  uint8_t p = finger.getImage();
  // If no finger is on the sensor, quietly return (this runs 100x a second)
  if (p != FINGERPRINT_OK) return "";

  Serial.println("[FP-AUTH] Finger detected! Capturing image...");

  p = finger.image2Tz(1);  // Convert to template in buffer 1
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP-AUTH] Image conversion failed: " + String(p));
    return "";
  }

  Serial.println("[FP-AUTH] Searching database...");

  // Use ONLY standard search. Fast search breaks clone modules.
  p = finger.fingerSearch();

  if (p == FINGERPRINT_OK) {
    Serial.println("[FP-AUTH] MATCH! ID: " + String(finger.fingerID) + " (Confidence: " + String(finger.confidence) + ")");
    String matchedID = String(finger.fingerID);

    // Add debounce: wait for finger removal to prevent duplicate triggers
    Serial.println("[FP-AUTH] Waiting for finger removal...");
    unsigned long removeStart = millis();
    while (millis() - removeStart < 2000) {
      uint8_t checkRemove = finger.getImage();
      if (checkRemove == FINGERPRINT_NOFINGER) break;
      delay(50);
    }

    return matchedID;
  }
  else if (p == FINGERPRINT_NOTFOUND) {
    Serial.println("[FP-AUTH] No match found in database.");

    // 🔥 CRITICAL FIX: Tell the user it failed, and force a 1-second delay.
    // This stops the ESP32 from taking 100 failed pictures of an unregistered
    // finger and crashing the module's memory buffer.
    showMessage("Access Denied", "Fingerprint", "Not Recognized");
    delay(1000);
    showHome(); // Reset the screen
    return "";
  }
  else {
    Serial.println("[FP-AUTH] Hardware search error: " + String(p));
    return "";
  }
}

// ---------------- MFA CAPTURE ROUTINES ----------------
// Step context for display
int currentStep = 1;
int totalSteps = 1;

String captureRFID(){
  showStepHeader(currentStep, totalSteps);
  display.setCursor(0,24);
  display.println("Scan RFID Card");
  display.display();
  
  unsigned long start = millis();
  while(millis()-start < 15000){
    String tag = readRFID();
    if(tag!="") return tag;
    delay(5); yield();
  }
  return "";
}

String captureFingerprint(){
  Serial.println("[FP-CAPTURE] Waiting for finger...");
  showStepHeader(currentStep, totalSteps);
  display.setCursor(0,24);
  display.println("Place Finger");
  display.setCursor(0,40);
  display.println("on sensor");
  display.display();
  
  unsigned long start = millis();
  while(millis()-start < 15000){
    String fpID = readFingerprint();
    if(fpID != "") {
      Serial.println("[FP-CAPTURE] Got ID: " + fpID);
      return fpID;
    }
    delay(50); yield();
  }
  Serial.println("[FP-CAPTURE] Timeout - no match found");
  return "";
}

String captureKeypad(String method){
  String code="";
  
  showStepHeader(currentStep, totalSteps);
  display.setCursor(0,24);
  if(method == "otp"){
    display.println("Enter OTP");
  } else {
    display.println("Enter PIN");
  }
  display.setCursor(0,48);
  display.println("#=OK  *=Clear");
  display.display();
  
  unsigned long start=millis();
  while(millis()-start<15000){
    char key=keypad.getKey();
    if(key){
      if(key>='0' && key<='9' && code.length() < 8) code+=key;
      else if(key=='*') code="";
      else if(key=='#') return code;

      String masked = "";
      for(int j=0; j<code.length(); j++) masked += "*";
      
      showStepHeader(currentStep, totalSteps);
      display.setCursor(0,24);
      display.println(method == "otp" ? "Enter OTP" : "Enter PIN");
      display.setCursor(0,40);
      display.println(masked);
      display.display();
    }
    delay(5); yield();
  }
  return "";
}

// ---------------- REGISTRATION ROUTINES ----------------
int enrollFingerprint(int id) {
  int p = -1;
  Serial.println("[FP] Starting enrollment for ID: " + String(id));
  showMessage("Enroll FP", "Place finger", "ID: " + String(id));
  unsigned long start = millis();

  // Step 1: First Scan
  while (p != FINGERPRINT_OK && millis() - start < 20000) {
    p = finger.getImage();
    if(p == FINGERPRINT_OK) {
      Serial.println("[FP] Image captured, converting...");
      showMessage("Enroll FP", "Processing...");
      p = finger.image2Tz(1);
      if(p != FINGERPRINT_OK) {
        Serial.println("[FP] image2Tz(1) failed: " + String(p));
        showMessage("FP Error", "Conversion fail");
        delay(1500);
        return -1;
      }
      Serial.println("[FP] Step 1 OK");
    }
    delay(100); yield();
  }
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP] Step 1 timeout");
    return -1;
  }

  // Step 2: Remove finger
  showMessage("Enroll FP", "Remove finger", "...");
  Serial.println("[FP] Waiting for finger removal");
  p = 0;
  start = millis();
  while (p != FINGERPRINT_NOFINGER && millis() - start < 10000) {
    p = finger.getImage();
    delay(100); yield();
  }

  if (p != FINGERPRINT_NOFINGER) {
    Serial.println("[FP] Timeout waiting for finger removal");
    showMessage("FP Error", "Remove finger");
    delay(1500);
    return -1;
  }

  // Step 3: Second Scan
  showMessage("Enroll FP", "Place SAME", "finger again");
  Serial.println("[FP] Waiting for second scan");
  p = -1;
  start = millis();
  while (p != FINGERPRINT_OK && millis() - start < 20000) {
    p = finger.getImage();
    if(p == FINGERPRINT_OK) {
      Serial.println("[FP] Second image captured");
      showMessage("Enroll FP", "Processing...");
      p = finger.image2Tz(2);
      if(p != FINGERPRINT_OK) {
        Serial.println("[FP] image2Tz(2) failed: " + String(p));
        showMessage("FP Error", "Conversion fail");
        delay(1500);
        return -1;
      }
      Serial.println("[FP] Step 3 OK");
    }
    delay(100); yield();
  }
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP] Step 3 timeout");
    return -1;
  }

  // Step 4: Create Model
  Serial.println("[FP] Creating model...");
  showMessage("Enroll FP", "Creating model");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP] createModel failed: " + String(p));
    showMessage("FP Error", "Model fail", "Try again");
    delay(1500);
    return -1;
  }

  // Step 5: Store Model
  Serial.println("[FP] Storing model at ID " + String(id));
  p = finger.storeModel(id);
  Serial.println("[FP] storeModel returned: " + String(p));

  if (p == FINGERPRINT_OK) {
    // Verify it was actually stored by loading it back
    delay(100);
    p = finger.loadModel(id);
    Serial.println("[FP] loadModel(" + String(id) + ") verification: " + String(p));

    if (p == FINGERPRINT_OK) {
      Serial.println("[FP] Enrollment SUCCESS - template verified at slot " + String(id));
      showMessage("FP Registered!", "ID: " + String(id));
      delay(500);
      return id;
    } else {
      Serial.println("[FP] ERROR: Template storage verification failed!");
      Serial.println("[FP] loadModel returned: " + String(p));
      showMessage("FP Error", "Verify failed");
      delay(1500);
      return -1;
    }
  }

  Serial.println("[FP] storeModel failed: " + String(p));
  showMessage("FP Error", "Store fail", "code: " + String(p));
  delay(1500);
  return -1;
}

void checkDeviceRegistration(){
  if(millis()-lastRegisterCheck < REGISTER_POLL_MS) return;
  lastRegisterCheck = millis();

  if(isRegisteringDevice || isProcessingSession) return;

  DynamicJsonDocument res(512);
  int code;

  if(requestJSON("GET",registerCheckURL,"",res,code) && code==200){
    bool regRFID = res["register_rfid"] | false;
    bool regFP = res["register_fingerprint"] | false;
    
    if(!regRFID && !regFP) return;

    isRegisteringDevice = true;

    // --- RFID ENROLLMENT ---
    if(regRFID) {
      showMessage("RFID Enroll", "Scan your card");
      
      unsigned long start = millis();
      String tag = "";
      while(millis()-start < 15000){
        tag = readRFID();
        if(tag!="") break;
        delay(5); yield();
      }
      
      DynamicJsonDocument req(256);
      req["tag_uid"] = (tag!="")?tag:"UNKNOWN";
      req["success"] = (tag!="");
      String json; serializeJson(req,json);
      DynamicJsonDocument out(256);
      requestJSON("POST",registerCompleteRFIDURL,json,out,code);
      
      if(tag!=""){
        showMessage("RFID Registered", tag.substring(0,10));
      } else {
        showMessage("Timeout", "No card detected");
      }
      delay(2000);
    }
    
    // --- FINGERPRINT ENROLLMENT ---
    else if(regFP) {
      int fpSlot = res["fingerprint_id"] | -1;
      Serial.println("[REG] Fingerprint registration, slot: " + String(fpSlot));

      if (fpSlot > 0 && fpSlot < 128) {
        int result = enrollFingerprint(fpSlot);
        Serial.println("[REG] Enrollment result: " + String(result));

        DynamicJsonDocument req(256);
        req["fingerprint_id"] = fpSlot;
        req["success"] = (result == fpSlot);
        String json; serializeJson(req,json);
        Serial.println("[REG] Sending: " + json);

        DynamicJsonDocument out(256);
        requestJSON("POST",registerCompleteFPURL,json,out,code);
        Serial.println("[REG] Server response: " + String(code));

        if(result == fpSlot){
          showMessage("FP Registered", "Slot: " + String(fpSlot));
        } else {
          showMessage("FP Failed", "Try again");
        }
        delay(2500);
      } else {
        Serial.println("[REG] Invalid slot: " + String(fpSlot));
        showMessage("Error", "Invalid FP Slot");
        delay(2000);
      }
    }

    isRegisteringDevice = false;
    showHome();
  }
}

// ---------------- MFA EXECUTION ----------------
void executeMFASequence(String firstPayload){
  isProcessingSession=true;
  String sessionId="";
  
  // Set total steps for display context
  totalSteps = mfaCount;

  for(int i=0;i<mfaCount;i++){
    String method=mfaOrder[i];
    String payload = "";
    
    // Set current step context for capture functions
    currentStep = i + 1;

    if(i == 0) payload = firstPayload;
    else {
      if(method == "rfid") payload = captureRFID();
      else if(method == "fingerprint") payload = captureFingerprint();
      else payload = captureKeypad(method);
    }

    if(payload==""){
      showMessage("Timeout", "No input", "Try again");
      delay(1500); break;
    }

    DynamicJsonDocument req(256);
    req["method_used"]=method;
    req["payload"]=payload;
    req["step"]=i+1;
    if(sessionId!="") req["session_id"]=sessionId;

    String json; serializeJson(req,json);
    DynamicJsonDocument res(512); int code;

    // Show animated verifying message
    for(int a = 0; a < 3; a++) {
      showLoadingAnimation("Verifying...");
      delay(100);
    }

    if(!requestJSON("POST",verifyURL,json,res,code) || code!=200){
      showMessage("Network Error", "Code: " + String(code));
      delay(1500); break;
    }

    if(res.containsKey("session_id")) sessionId = String(res["session_id"]);
    String status = res["status"] | "";
    String message = res["message"] | "";

    if(status=="success"){
      consecutiveFailures = 0;
      showAccessGrantedAnimation();
      buzzAccessGranted();
      delay(4500); break;  // 4.5 seconds to enjoy animated success
    }
    if(status!="authenticating"){
      consecutiveFailures++;
      showAccessDeniedAnimation();
      if(consecutiveFailures >= 3){
        buzzAlertPattern();
        consecutiveFailures = 0;
      } else {
        buzzAccessDenied();
      }
      delay(300);
      // Show reason below the animation
      if(message.length() > 0){
        display.setCursor(0, 58);
        display.setTextSize(1);
        if(message == "House is in lockdown") {
          drawCenteredText("LOCKDOWN", 58);
        }
      }
      display.display();
      delay(3700); break;  // 4 seconds total to see failure
    }
    
    // Step passed, show progress before next step
    if(i + 1 < mfaCount){
      buzzStepPassed();
      showMessage("Step " + String(currentStep) + " OK", "Next:", prettyMethod(mfaOrder[i+1]));
      delay(4000);  // 4 seconds between steps for breathing room
    }
  }

  isProcessingSession=false;
  
  // Clear RFID buffer to prevent stale reads
  while(em18Serial.available()) em18Serial.read();
  
  showHome();
}

// ---------------- CONFIG ----------------
void updateDeviceConfig(){
  if(millis()-lastConfigPoll < CONFIG_POLL_MS) return;
  lastConfigPoll = millis();
  if(isProcessingSession || isRegisteringDevice) return;

  DynamicJsonDocument res(512);
  int code;
  bool success = requestJSON("GET",configURL,"",res,code);
  
  // Diagnostic logging for config poll failures
  if(!success) {
    if(WiFi.status() != WL_CONNECTED) {
      Serial.println("[CONFIG] Poll failed - WiFi disconnected (NETWORK ISSUE)");
    } else {
      Serial.println("[CONFIG] Poll failed - Server unreachable or timeout (NETWORK ISSUE likely)");
      Serial.println("[CONFIG] WiFi connected, HTTP code: " + String(code));
    }
    return;
  }
  
  if(code != 200) {
    Serial.println("[CONFIG] Poll returned non-200: " + String(code) + " (SERVER ISSUE)");
    return;
  }
  
  // Successfully got config
  JsonArray arr = res["order"];
  bool changed = false;
  if(arr.size() != mfaCount) changed = true;
  else {
    int i = 0;
    for(JsonVariant v: arr){
      if(mfaOrder[i] != String(v.as<const char*>())) { changed = true; break; }
      i++;
    }
  }

  int i=0;
  for(JsonVariant v: arr) mfaOrder[i++] = String(v.as<const char*>());
  mfaCount = i;

  if(changed){
    Serial.println("[CONFIG] Config changed!");
    showHome();
  }
}

// ---------------- SETUP ----------------
void setup(){
  Serial.begin(115200);
  Wire.begin(21,22);
  display.begin(SSD1306_SWITCHCAPVCC,0x3C);
  display.setTextSize(1);
  display.setTextColor(WHITE);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  em18Serial.begin(9600,SERIAL_8N1,EM18_RX_PIN,-1);
  fpSerial.begin(57600, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(57600);

  // Initialize fingerprint sensor and log to Serial
  Serial.println("[FP] Initializing fingerprint sensor...");
  if (finger.verifyPassword()) {
    Serial.println("[FP] Sensor: OK");
    finger.getTemplateCount();
    Serial.println("[FP] Templates stored: " + String(finger.templateCount));
    if (finger.templateCount > 0) {
      uint8_t p = finger.loadModel(1);
      if (p == FINGERPRINT_OK) {
        Serial.println("[FP] Template 1: VALID");
      } else {
        Serial.println("[FP] Template 1 load FAILED: " + String(p));
      }
    }
  } else {
    Serial.println("[FP] Sensor: ERROR - password verify failed");
  }

  connectWiFi();
  WiFi.setSleep(false);  // Disable WiFi power saving to prevent intermittent drops
  updateDeviceConfig();
  showHome();
}

// ---------------- LOOP ----------------
void loop(){
  readRFID(); // Keep buffer clean
  checkDeviceRegistration();
  updateDeviceConfig();

  if(!isProcessingSession && !isRegisteringDevice){
    String first = mfaOrder[0];

    if(first=="rfid"){
      String tag = readRFID();
      if(tag!="") executeMFASequence(tag);
    }
    else if(first=="fingerprint"){
      String fpID = readFingerprint();
      if(fpID!="") executeMFASequence(fpID);
    }
    else{
      // Keypad or OTP as first step
      char key = keypad.getKey();
      if(key){
        if(key>='0' && key<='9' && idleEnteredCode.length() < 8){
          idleEnteredCode += key;
          
          String masked = "";
          for(int j=0; j<idleEnteredCode.length(); j++) masked += "*";
          
          display.clearDisplay();
          display.setCursor(0,0);
          display.println(first == "otp" ? "Enter OTP" : "Enter PIN");
          display.setCursor(0,24);
          display.println(masked);
          display.setCursor(0,48);
          display.println("#=OK  *=Clear");
          display.display();
        }
        else if(key=='*'){ 
          idleEnteredCode=""; 
          showHome(); 
        }
        else if(key=='#'){
          String temp = idleEnteredCode;
          idleEnteredCode="";
          executeMFASequence(temp);
        }
      }
    }
  }
  delay(10);
}