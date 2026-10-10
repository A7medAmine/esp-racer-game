// Tilt sensor abstraction. The sensor is auto-detected on the I2C bus at boot:
//   ADXL345 at 0x53 (SDO -> GND) or 0x1D (SDO -> VCC)
//   MPU6050 at 0x68 (AD0 -> GND) or 0x69 (AD0 -> VCC)
// Swapping the ADXL345 for an MPU6050 needs no code change, only re-wiring.
#pragma once
#include <Arduino.h>

enum TiltSensorType : uint8_t { SENSOR_NONE = 0, SENSOR_ADXL345, SENSOR_MPU6050 };

class TiltSensor {
 public:
  // Scans the bus and configures the first supported sensor found.
  bool begin();
  // Reads the sensor and updates roll/pitch. Call at a steady rate.
  void update();

  // Degrees. Sign depends on how the module is mounted; the game can invert it.
  float roll() const { return roll_; }
  float pitch() const { return pitch_; }
  TiltSensorType type() const { return type_; }
  uint8_t address() const { return addr_; }
  const char* name() const;
  bool ok() const { return type_ != SENSOR_NONE && errors_ < 20; }

 private:
  bool probeAdxl(uint8_t addr);
  bool probeMpu(uint8_t addr);
  bool readAdxl(float& ax, float& ay, float& az);
  bool readMpu(float& ax, float& ay, float& az, float& gx, float& gy);

  TiltSensorType type_ = SENSOR_NONE;
  uint8_t addr_ = 0;
  float roll_ = 0, pitch_ = 0;
  bool primed_ = false;
  uint32_t lastMicros_ = 0;
  uint8_t errors_ = 0;
};
