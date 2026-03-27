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
const unsigned long CONFIG_POLL_MS = 5000;

String mfaOrder[3] = {"keypad"};
int mfaCount = 1;

String idleEnteredCode = "";
bool isProcessingSession = false;

unsigned long lastRegisterCheck = 0;
const unsigned long REGISTER_POLL_MS = 3000;
bool isRegisteringDevice = false; // Covers both RFID and FP

// ---------------- DISPLAY ----------------
void showMessage(String l1, String l2="", String l3=""){
  display.clearDisplay();
  display.setCursor(0,0); display.println(l1);
  if(l2!=""){ display.setCursor(0,24); display.println(l2); }
  if(l3!=""){ display.setCursor(0,48); display.println(l3); }
  display.display();
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
}

void showHome(){
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("MFA System Ready");
  display.setCursor(0,24);
  display.print("Use: ");
  display.println(prettyMethod(mfaOrder[0]));
  if(mfaCount > 1){
    display.setCursor(0,48);
    display.print("(");
    display.print(mfaCount);
    display.print(" steps)");
  }
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
  http.setTimeout(4000);
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

    // Show verifying message
    showStepHeader(currentStep, totalSteps);
    display.setCursor(0,28);
    display.println("Verifying...");
    display.display();

    if(!requestJSON("POST",verifyURL,json,res,code) || code!=200){
      showMessage("Network Error", "Code: " + String(code));
      delay(1500); break;
    }

    if(res.containsKey("session_id")) sessionId = String(res["session_id"]);
    String status = res["status"] | "";
    String message = res["message"] | "";

    if(status=="success"){
      showMessage("ACCESS GRANTED", "", "Welcome!");
      delay(2000); break;
    }
    if(status!="authenticating"){
      if(message.length() > 0){
        if(message == "House is in lockdown") showMessage("ACCESS BLOCKED", "House in", "Lockdown");
        else showMessage("ACCESS DENIED", "", message);
      } else {
        showMessage("ACCESS DENIED", "", "Invalid credential");
      }
      delay(1500); break;
    }
    
    // Step passed, show progress before next step
    if(i + 1 < mfaCount){
      showMessage("Step " + String(currentStep) + " OK", "Next:", prettyMethod(mfaOrder[i+1]));
      delay(1000);
    }
  }

  isProcessingSession=false;
  showHome();
}

// ---------------- CONFIG ----------------
void updateDeviceConfig(){
  if(millis()-lastConfigPoll < CONFIG_POLL_MS) return;
  lastConfigPoll = millis();
  if(isProcessingSession || isRegisteringDevice) return;

  DynamicJsonDocument res(512);
  int code;
  if(requestJSON("GET",configURL,"",res,code) && code==200){
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
      Serial.println("Config changed!");
      showHome();
    }
  }
}

// ---------------- SETUP ----------------
void setup(){
  Serial.begin(115200);
  Wire.begin(21,22);
  display.begin(SSD1306_SWITCHCAPVCC,0x3C);
  display.setTextSize(1);
  display.setTextColor(WHITE);

  em18Serial.begin(9600,SERIAL_8N1,EM18_RX_PIN,-1);
  fpSerial.begin(57600, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(57600);

  display.clearDisplay(); display.setCursor(0,0);
  if (finger.verifyPassword()) {
    display.println("FP Sensor: OK");
    finger.getTemplateCount();
    Serial.println("Templates stored: " + String(finger.templateCount));
    display.println("Templates: " + String(finger.templateCount));

    // Test if template at slot 1 is valid
    if (finger.templateCount > 0) {
      uint8_t p = finger.loadModel(1);
      Serial.println("Load template 1: " + String(p));
      if (p == FINGERPRINT_OK) {
        Serial.println("Template 1 is VALID");
      } else {
        Serial.println("Template 1 load FAILED: " + String(p));
      }
    }
  } else {
    display.println("FP Sensor: ERROR");
    Serial.println("FP Sensor password verify FAILED");
  }
  display.display();
  delay(2000);

  connectWiFi();
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