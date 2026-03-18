/*
 * ===========================================
 *   ESP8266 Otomatik Balık Yemleyici
 *   Fish Feeder Dashboard Firmware
 * ===========================================
 *
 * Gerekli Kütüphaneler (Arduino Library Manager'dan yükle):
 *   - ArduinoJson by Benoit Blanchon
 *   - Servo (dahili)
 *   - ESP8266WiFi (dahili)
 *   - ESP8266HTTPClient (dahili)
 *
 * Bağlantılar:
 *   - HC-SR04 Trig -> D1 (GPIO5)
 *   - HC-SR04 Echo -> D2 (GPIO4)
 *   - Servo Signal -> D3 (GPIO0)
 *   - HC-SR04 VCC  -> 5V
 *   - HC-SR04 GND  -> GND
 *   - Servo VCC    -> 5V (harici güç önerilir)
 *   - Servo GND    -> GND
 *
 * KURULUM:
 *   1. Aşağıdaki 3 bilgiyi doldurun:
 *      - WIFI_SSID: WiFi adınız
 *      - WIFI_PASSWORD: WiFi şifreniz
 *      - DEVICE_TOKEN: Dashboard'dan kopyaladığınız cihaz tokeni
 *   2. Kodu ESP8266'ya yükleyin
 *   3. Bitti! ESP otomatik bağlanıp çalışmaya başlar
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Servo.h>

// ==================== BURAYA DOLDURUN ====================
const char* WIFI_SSID     = "WIFI_ADINIZ";
const char* WIFI_PASSWORD  = "WIFI_SIFRENIZ";
const char* DEVICE_TOKEN   = "DEV-DASHBOARD_TOKENI";
// =========================================================

// Sunucu adresi (Render URL'niz)
const char* SERVER_URL = "https://RENDER_ADRESINIZ.onrender.com";

// Pin tanımları
#define TRIG_PIN    D1
#define ECHO_PIN    D2
#define SERVO_PIN   D3

// Mesafe sensörü ayarları (cm)
#define CONTAINER_EMPTY_DISTANCE 20
#define CONTAINER_FULL_DISTANCE  3

// Servo ayarları
#define SERVO_CLOSE_ANGLE  0
#define SERVO_OPEN_ANGLE   90
#define FEED_DURATION      1500

// Zamanlama (ms)
#define HEARTBEAT_INTERVAL     10000
#define COMMAND_CHECK_INTERVAL 5000

// Global
Servo feederServo;
WiFiClientSecure wifiClient;
unsigned long lastHeartbeat = 0;
unsigned long lastCommandCheck = 0;

// ==================== WiFi ====================
void connectWiFi() {
  Serial.print("WiFi'ye baglaniliyor: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("Baglandi! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi baglantisi basarisiz! Yeniden deneniyor...");
    delay(5000);
    ESP.restart();
  }
}

// ==================== Sensör ====================
int calculateFoodLevel() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1;

  float distance = duration * 0.034 / 2.0;
  float range = CONTAINER_EMPTY_DISTANCE - CONTAINER_FULL_DISTANCE;
  float level = (CONTAINER_EMPTY_DISTANCE - distance) / range * 100.0;
  return constrain((int)level, 0, 100);
}

// ==================== Servo ====================
void dispenseFeed() {
  Serial.println("Yem veriliyor...");
  feederServo.attach(SERVO_PIN);
  feederServo.write(SERVO_OPEN_ANGLE);
  delay(FEED_DURATION);
  feederServo.write(SERVO_CLOSE_ANGLE);
  delay(500);
  feederServo.detach();
  Serial.println("Yem verildi!");
}

// ==================== HTTP ====================
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;

  int foodLevel = calculateFoodLevel();
  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/esp/heartbeat");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  StaticJsonDocument<128> doc;
  doc["device_token"] = DEVICE_TOKEN;
  if (foodLevel >= 0) doc["food_level_percent"] = foodLevel;

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.println(code == 200 ? "Heartbeat OK" : "Heartbeat HATA");
  http.end();
}

void checkCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/esp/commands");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  if (http.GET() == 200) {
    StaticJsonDocument<256> doc;
    deserializeJson(doc, http.getString());
    for (JsonObject cmd : doc["commands"].as<JsonArray>()) {
      if (cmd["action"].as<String>() == "feed") {
        dispenseFeed();
        // Besleme bildirimi
        HTTPClient http2;
        http2.begin(wifiClient, String(SERVER_URL) + "/api/esp/feed-done");
        http2.addHeader("Content-Type", "application/json");
        http2.addHeader("X-Device-Token", DEVICE_TOKEN);
        http2.POST("{\"device_token\":\"" + String(DEVICE_TOKEN) + "\",\"triggered_by\":\"manual\"}");
        http2.end();
      }
    }
  }
  http.end();
}

// ==================== Setup & Loop ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Fish Feeder v2.0 ===");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  wifiClient.setInsecure();

  feederServo.attach(SERVO_PIN);
  feederServo.write(SERVO_CLOSE_ANGLE);
  delay(500);
  feederServo.detach();

  connectWiFi();
  sendHeartbeat();
  Serial.println("Sistem hazir!");
}

void loop() {
  unsigned long now = millis();

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    sendHeartbeat();
  }
  if (now - lastCommandCheck >= COMMAND_CHECK_INTERVAL) {
    lastCommandCheck = now;
    checkCommands();
  }
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  delay(100);
}
