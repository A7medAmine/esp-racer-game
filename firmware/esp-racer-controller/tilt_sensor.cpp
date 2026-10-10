#include "tilt_sensor.h"

#include <Wire.h>

#include "config.h"

namespace {

// ADXL345 registers
const uint8_t ADXL_DEVID = 0x00;
const uint8_t ADXL_BW_RATE = 0x2C;
const uint8_t ADXL_POWER_CTL = 0x2D;
const uint8_t ADXL_DATA_FORMAT = 0x31;
const uint8_t ADXL_DATAX0 = 0x32;
const float ADXL_G_PER_LSB = 0.0039f;  // full-resolution mode

// MPU6050 registers
const uint8_t MPU_CONFIG = 0x1A;
const uint8_t MPU_GYRO_CONFIG = 0x1B;
const uint8_t MPU_ACCEL_CONFIG = 0x1C;
const uint8_t MPU_ACCEL_XOUT_H = 0x3B;
const uint8_t MPU_PWR_MGMT_1 = 0x6B;
const uint8_t MPU_WHO_AM_I = 0x75;
const float MPU_G_PER_LSB = 1.0f / 16384.0f;  // +-2g
const float MPU_DPS_PER_LSB = 1.0f / 131.0f;  // +-250 deg/s

bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t len) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

int readReg(uint8_t addr, uint8_t reg) {
  uint8_t v;
  return readRegs(addr, reg, &v, 1) ? v : -1;
}

const float RAD2DEG = 57.2957795f;

}  // namespace

const char* TiltSensor::name() const {
  switch (type_) {
    case SENSOR_ADXL345: return "ADXL345";
    case SENSOR_MPU6050: return "MPU6050";
    default: return "none";
  }
}

bool TiltSensor::begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  type_ = SENSOR_NONE;
  errors_ = 0;
  primed_ = false;
  if (probeAdxl(0x53) || probeAdxl(0x1D) || probeMpu(0x68) || probeMpu(0x69)) {
    lastMicros_ = micros();
    return true;
  }
  return false;
}

bool TiltSensor::probeAdxl(uint8_t addr) {
  if (readReg(addr, ADXL_DEVID) != 0xE5) return false;
  writeReg(addr, ADXL_POWER_CTL, 0x00);    // standby while configuring
  writeReg(addr, ADXL_DATA_FORMAT, 0x08);  // full resolution, +-2g
  writeReg(addr, ADXL_BW_RATE, 0x0A);      // 100 Hz output rate
  writeReg(addr, ADXL_POWER_CTL, 0x08);    // measure mode
  type_ = SENSOR_ADXL345;
  addr_ = addr;
  return true;
}

bool TiltSensor::probeMpu(uint8_t addr) {
  int who = readReg(addr, MPU_WHO_AM_I);
  // 0x68 = MPU6050, 0x70 = MPU6500, 0x71/0x73 = MPU9250/9255, 0x98 = common clones.
  if (who != 0x68 && who != 0x70 && who != 0x71 && who != 0x73 && who != 0x98) return false;
  writeReg(addr, MPU_PWR_MGMT_1, 0x01);    // wake up, PLL with gyro X clock
  writeReg(addr, MPU_CONFIG, 0x03);        // ~44 Hz digital low-pass filter
  writeReg(addr, MPU_GYRO_CONFIG, 0x00);   // +-250 deg/s
  writeReg(addr, MPU_ACCEL_CONFIG, 0x00);  // +-2g
  type_ = SENSOR_MPU6050;
  addr_ = addr;
  return true;
}

bool TiltSensor::readAdxl(float& ax, float& ay, float& az) {
  uint8_t b[6];
  if (!readRegs(addr_, ADXL_DATAX0, b, 6)) return false;
  ax = (int16_t)(b[1] << 8 | b[0]) * ADXL_G_PER_LSB;
  ay = (int16_t)(b[3] << 8 | b[2]) * ADXL_G_PER_LSB;
  az = (int16_t)(b[5] << 8 | b[4]) * ADXL_G_PER_LSB;
  return true;
}

bool TiltSensor::readMpu(float& ax, float& ay, float& az, float& gx, float& gy) {
  uint8_t b[14];
  if (!readRegs(addr_, MPU_ACCEL_XOUT_H, b, 14)) return false;
  ax = (int16_t)(b[0] << 8 | b[1]) * MPU_G_PER_LSB;
  ay = (int16_t)(b[2] << 8 | b[3]) * MPU_G_PER_LSB;
  az = (int16_t)(b[4] << 8 | b[5]) * MPU_G_PER_LSB;
  gx = (int16_t)(b[8] << 8 | b[9]) * MPU_DPS_PER_LSB;
  gy = (int16_t)(b[10] << 8 | b[11]) * MPU_DPS_PER_LSB;
  return true;
}

void TiltSensor::update() {
  if (type_ == SENSOR_NONE) return;

  uint32_t now = micros();
  float dt = (now - lastMicros_) / 1e6f;
  lastMicros_ = now;
  if (dt <= 0 || dt > 0.5f) dt = 0.01f;

  float ax, ay, az, gx = 0, gy = 0;
  bool ok = type_ == SENSOR_ADXL345 ? readAdxl(ax, ay, az) : readMpu(ax, ay, az, gx, gy);
  if (!ok) {
    if (errors_ < 255) errors_++;
    return;
  }
  errors_ = 0;

  // Angles from gravity. Signs depend on how the board is mounted; the game can
  // pick the axis and invert it, so no orientation is hard-coded here.
  float accRoll = atan2f(ay, az) * RAD2DEG;
  float accPitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * RAD2DEG;

  if (!primed_) {
    roll_ = accRoll;
    pitch_ = accPitch;
    primed_ = true;
    return;
  }

  if (type_ == SENSOR_MPU6050) {
    // Complementary filter: the gyro gives fast, smooth response, the
    // accelerometer pulls the estimate back so it never drifts.
    roll_ = MPU_GYRO_WEIGHT * (roll_ + gx * dt) + (1 - MPU_GYRO_WEIGHT) * accRoll;
    pitch_ = MPU_GYRO_WEIGHT * (pitch_ + gy * dt) + (1 - MPU_GYRO_WEIGHT) * accPitch;
  } else {
    roll_ += (accRoll - roll_) * (1 - TILT_SMOOTHING);
    pitch_ += (accPitch - pitch_) * (1 - TILT_SMOOTHING);
  }
}
