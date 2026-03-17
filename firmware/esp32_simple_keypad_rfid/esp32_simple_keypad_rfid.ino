#include <WiFi.h>
#include <HTTPClient.h>
#include <Keypad.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ---------------- WIFI ----------------
const char* ssid = "Sharone's F55";
const char* password = "helloworld";

// ---------------- BACKEND ----------------
const String verifyURL = "http://10.11.43.61:8000/api/auth/verify";
const String registerCheckURL = "http://10.11.43.61:8000/api/device/register_check";
const String registerCompleteRFIDURL = "http://10.11.43.61:8000/api/device/rfid/register_complete";

// ---------------- RFID ----------------
HardwareSerial em18Serial(1);
const int EM18_RX_PIN = 19;

// ---------------- KEYPAD ----------------
const byte ROWS = 4;
const byte COLS = 4;

char keys[ROWS][COLS] = {
{'1','2','3','A'},
{'4','5','6','B'},
{'7','8','9','C'},
{'*','0','#','D'}
};

byte rowPins[ROWS] = {13,12,27,14};   
byte colPins[COLS] = {26,25,33,32};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ---------------- STATE ----------------
String enteredCode = "";
bool isRegisteringRFID = false;
unsigned long lastRegisterCheck = 0;

// ---------------- DISPLAY ----------------
void showMessage(String l1, String l2="")
{
  display.clearDisplay();
  display.setCursor(0,0);
  display.println(l1);
  display.setCursor(0,30);
  display.println(l2);
  display.display();
}

void showHome()
{
  showMessage("Enter PIN/OTP", "Scan RFID");
}

// ---------------- WIFI ----------------
void connectWiFi()
{
  showMessage("Connecting WiFi");

  WiFi.begin(ssid,password);

  while(WiFi.status()!=WL_CONNECTED)
    delay(500);

  showMessage("WiFi Connected");
  delay(1000);
}

// ---------------- HTTP ----------------
int postJSONTo(String url, String json, String &res)
{
  HTTPClient http;
  http.begin(url);
  http.setTimeout(1500);
  http.addHeader("Content-Type","application/json");

  int code = http.POST(json);
  res = (code>0)?http.getString():"";

  http.end();
  return code;
}

// ---------------- RFID READ ----------------
String readRFID()
{
  // EM18 frame format is typically:
  // STX(0x02) + 12 ASCII hex chars + ETX(0x03)
  // First 10 chars represent the UID; last 2 are checksum.
  static bool inFrame = false;
  static String frame = "";
  static String loose = "";

  while(em18Serial.available())
  {
    char c = (char)em18Serial.read();
    uint8_t uc = (uint8_t)c;

    if (uc == 0x02)  // STX
    {
      inFrame = true;
      frame = "";
      loose = "";
      continue;
    }

    if (uc == 0x03)  // ETX
    {
      if (inFrame && frame.length() >= 10)
      {
        String out = frame.substring(0, 10);
        out.toUpperCase();
        inFrame = false;
        frame = "";
        loose = "";
        return out;
      }
      inFrame = false;
      frame = "";
      loose = "";
      continue;
    }

    if (inFrame)
    {
      if(isxdigit(c))
      {
        frame += c;
        if(frame.length() > 12)
        {
          // Invalid/shifted frame; reset and wait for next STX.
          inFrame = false;
          frame = "";
        }
      }
      else
      {
        inFrame = false;
        frame = "";
      }
      continue;
    }

    // Fallback for EM18 variants that send plain HEX + CR/LF (no STX/ETX).
    if (isxdigit(c))
    {
      loose += c;
      if (loose.length() == 12)
      {
        String out = loose.substring(0, 10);
        out.toUpperCase();
        loose = "";
        return out;
      }
      if (loose.length() > 16) loose = "";
    }
    else if (c == '\n' || c == '\r')
    {
      if (loose.length() >= 10)
      {
        String out = loose.substring(0, 10);
        out.toUpperCase();
        loose = "";
        return out;
      }
      loose = "";
    }
    else
    {
      loose = "";
    }
  }
  return "";
}

// ---------------- AUTH ----------------
void sendAuth(String method,String payload)
{
  String res;
  String json="{\"method_used\":\""+method+"\",\"payload\":\""+payload+"\"}";

  Serial.println(json);

  int code = postJSONTo(verifyURL,json,res);

  Serial.println("AUTH_CODE: " + String(code));
  Serial.println(res);

  if(code <= 0)
    showMessage("API Error", String(code));
  else if(res.indexOf("\"status\":\"success\"")!=-1)
    showMessage("Access Granted");
  else
    showMessage("Access Denied");

  delay(1500);
  showHome();
}

// ---------------- RFID REGISTRATION ----------------
void checkRFIDRegistration()
{
  if (millis() - lastRegisterCheck < 2000) return;
  lastRegisterCheck = millis();

  if (WiFi.status() != WL_CONNECTED) return;
  if (isRegisteringRFID) return;
  if (enteredCode.length() > 0) return;

  HTTPClient http;
  http.begin(registerCheckURL);
  http.setTimeout(1200);

  int code = http.GET();
  if (code != 200)
  {
    http.end();
    return;
  }

  String res = http.getString();
  http.end();

  Serial.println("REGISTER_CHECK: " + res);

  String normalized = res;
  normalized.toLowerCase();
  normalized.replace(" ","");

  if (normalized.indexOf("\"register_rfid\":true") != -1)
  {
    isRegisteringRFID = true;

    showMessage("RFID Register", "Scan card");
    delay(500);

    unsigned long start = millis();

    while (millis() - start < 15000)
    {
      String tag = readRFID();

      if (tag.length() > 0)
      {
        showMessage("Tag read", tag.substring(0,8));

        String json = "{\"tag_uid\":\""+tag+"\",\"success\":true}";
        String response;

        int regCode = postJSONTo(registerCompleteRFIDURL,json,response);
        Serial.println(response);

        if (regCode > 0 && response.indexOf("\"status\":\"stored\"") != -1)
          showMessage("Registered");
        else
          showMessage("Reg Failed");
        delay(1500);

        isRegisteringRFID = false;
        showHome();
        return;
      }
      delay(20);
    }

    // timeout
    String json = "{\"tag_uid\":\"UNKNOWN\",\"success\":false}";
    String response;

    int regCode = postJSONTo(registerCompleteRFIDURL,json,response);

    Serial.println("REGISTER_TIMEOUT_POST: " + String(regCode) + " " + response);

    showMessage("Timeout");
    delay(1500);

    isRegisteringRFID = false;
    showHome();
  }
}

// ---------------- KEYPAD ----------------
void handleKeypad()
{
  char key=keypad.getKey();
  if(!key) return;

  if(key=='#')
  {
    if(enteredCode.length()==4)
      sendAuth("keypad",enteredCode);
    
    else if(enteredCode.length()>4)
      sendAuth("otp",enteredCode);

    else
      showMessage("Invalid");

    enteredCode="";
    return;
  }

  if(key=='*')
  {
    enteredCode="";
    showMessage("Cleared");
    delay(500);
    showHome();
    return;
  }

  if(key>='0' && key<='9')
  {
    enteredCode+=key;

    display.clearDisplay();
    display.setCursor(0,0);
    display.println(enteredCode.length()>4 ? "OTP" : "PIN");
    display.setCursor(0,30);
    display.println(enteredCode);
    display.display();
  }
}

// ---------------- RFID AUTH ----------------
void handleRFID()
{
  if(enteredCode.length()>0) return;

  String tag=readRFID();
  if(tag.length()==0) return;

  showMessage("RFID",tag.substring(0,8));
  delay(300);

  sendAuth("rfid",tag);
}

// ---------------- SETUP ----------------
void setup()
{
  Serial.begin(115200);

  Wire.begin(21,22);
  display.begin(SSD1306_SWITCHCAPVCC,0x3C);
  display.setTextSize(1);
  display.setTextColor(WHITE);

  em18Serial.begin(9600,SERIAL_8N1,EM18_RX_PIN,-1);

  connectWiFi();
  showHome();
}

// ---------------- LOOP ----------------
void loop()
{
  checkRFIDRegistration();   // 🔥 priority

  if(!isRegisteringRFID)
  {
    handleKeypad();
    handleRFID();
  }

  delay(10);
}
