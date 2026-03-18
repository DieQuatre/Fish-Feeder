/*
 * ===========================================
 *   ESP8266 Otomatik Balık Yemleyici
 *   Fish Feeder Dashboard Firmware
 * ===========================================
 *
 * Gerekli Kütüphaneler (Arduino Library Manager'dan yükle):
 *   - WiFiManager by tzapu
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
 * İLK KURULUM:
 *   1. Kodu ESP8266'ya yükleyin
 *   2. ESP "BalikYemleyici-Kurulum" adında bir WiFi ağı oluşturur
 *   3. Telefonunuzdan bu ağa bağlanın
 *   4. Açılan sayfada WiFi bilgilerinizi ve Device Token'ı girin
 *   5. Kaydet'e basın — ESP bağlanır ve çalışmaya başlar
 *   6. Bir daha kurulum gerekmez (bilgiler hafızada kalır)
 *
 *   Sıfırlamak isterseniz: ESP açılırken 5 saniye FLASH butonuna basın
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Servo.h>
#include <EEPROM.h>

// ==================== SUNUCU ADRESI ====================
// Render'a deploy ettikten sonra buraya Render URL'nizi yazın
// Örnek: "https://fish-feeder-xxxx.onrender.com"
const char* SERVER_URL = "https://RENDER_ADRESINIZ.onrender.com";

// ==================== PIN TANIMLARI ====================
#define TRIG_PIN    D1   // HC-SR04 Trigger
#define ECHO_PIN    D2   // HC-SR04 Echo
#define SERVO_PIN   D3   // Servo motor
#define RESET_PIN   D5   // Sıfırlama butonu (opsiyonel, GND'ye bağlayın)

// ==================== MESAFE SENSÖRÜ AYARLARI ====================
#define CONTAINER_EMPTY_DISTANCE 20  // Kap boşken mesafe (cm)
#define CONTAINER_FULL_DISTANCE  3   // Kap doluyken mesafe (cm)

// ==================== SERVO AYARLARI ====================
#define SERVO_CLOSE_ANGLE  0
#define SERVO_OPEN_ANGLE   90
#define FEED_DURATION      1500  // ms

// ==================== ZAMANLAMA ====================
#define HEARTBEAT_INTERVAL     10000  // 10 saniye
#define COMMAND_CHECK_INTERVAL 5000   // 5 saniye

// ==================== EEPROM ====================
#define EEPROM_SIZE       128
#define EEPROM_TOKEN_ADDR 0
#define TOKEN_MAX_LEN     64
#define EEPROM_MAGIC      0xAB  // Token kaydedildi işareti

// ==================== GLOBAL ====================
Servo feederServo;
WiFiClientSecure wifiClient;
WiFiManager wifiManager;

char deviceToken[TOKEN_MAX_LEN] = "";
unsigned long lastHeartbeat = 0;
unsigned long lastCommandCheck = 0;

// WiFiManager custom parameter
WiFiManagerParameter customTokenParam("token", "Device Token (Dashboard'dan kopyalayın)", "", TOKEN_MAX_LEN - 1);

// ==================== EEPROM FONKSİYONLARI ====================

void saveTokenToEEPROM(const char* token) {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.write(EEPROM_TOKEN_ADDR, EEPROM_MAGIC);
  for (int i = 0; i < TOKEN_MAX_LEN - 1; i++) {
    EEPROM.write(EEPROM_TOKEN_ADDR + 1 + i, token[i]);
    if (token[i] == '\0') break;
  }
  EEPROM.commit();
  EEPROM.end();
  Serial.println("✅ Token EEPROM'a kaydedildi.");
}

bool loadTokenFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  if (EEPROM.read(EEPROM_TOKEN_ADDR) != EEPROM_MAGIC) {
    EEPROM.end();
    return false;
  }
  for (int i = 0; i < TOKEN_MAX_LEN - 1; i++) {
    deviceToken[i] = EEPROM.read(EEPROM_TOKEN_ADDR + 1 + i);
    if (deviceToken[i] == '\0') break;
  }
  deviceToken[TOKEN_MAX_LEN - 1] = '\0';
  EEPROM.end();

  if (strlen(deviceToken) < 5) return false;

  Serial.print("📦 EEPROM'dan token yüklendi: ");
  Serial.println(deviceToken);
  return true;
}

void clearEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  for (int i = 0; i < EEPROM_SIZE; i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  EEPROM.end();
  Serial.println("🗑️ EEPROM temizlendi.");
}

// ==================== SENSÖR + SERVO ====================

float measureDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1;
  return duration * 0.034 / 2.0;
}

int calculateFoodLevel() {
  float distance = measureDistance();
  if (distance < 0) {
    Serial.println("Mesafe ölçüm hatası!");
    return -1;
  }
  Serial.print("Mesafe: ");
  Serial.print(distance);
  Serial.println(" cm");

  float range = CONTAINER_EMPTY_DISTANCE - CONTAINER_FULL_DISTANCE;
  float level = (CONTAINER_EMPTY_DISTANCE - distance) / range * 100.0;
  int percent = constrain((int)level, 0, 100);

  Serial.print("Yem seviyesi: %");
  Serial.println(percent);
  return percent;
}

void dispenseFeed() {
  Serial.println("🐟 Yem veriliyor...");
  feederServo.attach(SERVO_PIN);
  feederServo.write(SERVO_OPEN_ANGLE);
  delay(FEED_DURATION);
  feederServo.write(SERVO_CLOSE_ANGLE);
  delay(500);
  feederServo.detach();
  Serial.println("✅ Yem verildi!");
}

// ==================== HTTP FONKSİYONLARI ====================

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED || strlen(deviceToken) < 5) return;

  int foodLevel = calculateFoodLevel();

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp/heartbeat";
  http.begin(wifiClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", deviceToken);

  StaticJsonDocument<128> doc;
  doc["device_token"] = deviceToken;
  if (foodLevel >= 0) doc["food_level_percent"] = foodLevel;

  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);

  if (httpCode == 200) {
    Serial.println("💚 Heartbeat gönderildi.");
  } else {
    Serial.print("❌ Heartbeat hatası: ");
    Serial.println(httpCode);
  }
  http.end();
}

void checkCommands() {
  if (WiFi.status() != WL_CONNECTED || strlen(deviceToken) < 5) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp/commands";
  http.begin(wifiClient, url);
  http.addHeader("X-Device-Token", deviceToken);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    StaticJsonDocument<256> doc;
    deserializeJson(doc, payload);

    JsonArray commands = doc["commands"];
    for (JsonObject cmd : commands) {
      String action = cmd["action"].as<String>();
      if (action == "feed") {
        Serial.println("📥 Besleme komutu alındı!");
        dispenseFeed();
        notifyFeedDone("manual");
      }
    }
  }
  http.end();
}

void notifyFeedDone(const char* triggeredBy) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp/feed-done";
  http.begin(wifiClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", deviceToken);

  StaticJsonDocument<128> doc;
  doc["device_token"] = deviceToken;
  doc["triggered_by"] = triggeredBy;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();

  Serial.println("✅ Besleme kaydı sunucuya bildirildi.");
}

// ==================== WiFiManager CALLBACK ====================

void saveConfigCallback() {
  // WiFiManager'dan parametre al
  String token = String(customTokenParam.getValue());
  token.trim();

  if (token.length() > 4) {
    token.toCharArray(deviceToken, TOKEN_MAX_LEN);
    saveTokenToEEPROM(deviceToken);
    Serial.print("✅ Device Token ayarlandı: ");
    Serial.println(deviceToken);
  } else {
    Serial.println("⚠️ Token çok kısa, kaydedilmedi.");
  }
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("=================================");
  Serial.println("  🐟 Fish Feeder System v2.0");
  Serial.println("  WiFiManager Kurulum Destekli");
  Serial.println("=================================");

  // Pin modları
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);

  // HTTPS ayarı (sertifika doğrulamasını atla)
  wifiClient.setInsecure();

  // Servo başlangıç
  feederServo.attach(SERVO_PIN);
  feederServo.write(SERVO_CLOSE_ANGLE);
  delay(500);
  feederServo.detach();

  // EEPROM'dan token yükle
  bool tokenLoaded = loadTokenFromEEPROM();

  // Sıfırlama kontrolü: RESET_PIN 3 saniye basılı tutulursa
  Serial.println("Sıfırlama kontrolü (3 saniye RESET pinine basın)...");
  unsigned long resetStart = millis();
  bool resetRequested = false;
  while (millis() - resetStart < 3000) {
    if (digitalRead(RESET_PIN) == LOW) {
      resetRequested = true;
    }
    delay(100);
  }

  if (resetRequested) {
    Serial.println("🔄 SIFIRLAMA başlatıldı!");
    clearEEPROM();
    wifiManager.resetSettings();
    tokenLoaded = false;
  }

  // WiFiManager ayarları
  wifiManager.addParameter(&customTokenParam);
  wifiManager.setSaveConfigCallback(saveConfigCallback);
  wifiManager.setConfigPortalTimeout(300); // 5 dakika timeout

  // Eğer token yoksa veya WiFi bağlantısı yoksa → kurulum portalı aç
  if (!tokenLoaded) {
    Serial.println("📡 Kurulum portalı açılıyor...");
    Serial.println("Telefonunuzdan 'BalikYemleyici-Kurulum' ağına bağlanın.");

    if (!wifiManager.startConfigPortal("BalikYemleyici-Kurulum")) {
      Serial.println("Bağlantı başarısız, yeniden başlatılıyor...");
      delay(3000);
      ESP.restart();
    }
  } else {
    // Token var, sadece WiFi'ye bağlan (kaydedilmiş bilgilerle)
    Serial.println("📶 Kayıtlı WiFi'ye bağlanılıyor...");
    if (!wifiManager.autoConnect("BalikYemleyici-Kurulum")) {
      Serial.println("WiFi bağlantısı başarısız, yeniden başlatılıyor...");
      delay(3000);
      ESP.restart();
    }
  }

  Serial.print("✅ WiFi bağlandı! IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("🔑 Device Token: ");
  Serial.println(deviceToken);

  // İlk heartbeat
  sendHeartbeat();
  Serial.println("✅ Sistem hazır!");
}

// ==================== LOOP ====================
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

  // WiFi kopmuşsa yeniden bağlan
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi koptu! Yeniden bağlanılıyor...");
    WiFi.reconnect();
    delay(5000);
  }

  delay(100);
}
