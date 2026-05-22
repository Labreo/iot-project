-- IoT Telemetry Database Schema
-- Run with: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS telemetry_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE telemetry_db;

CREATE TABLE IF NOT EXISTS device_logs (
  id              INT           NOT NULL AUTO_INCREMENT,
  timestamp       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  speed           FLOAT         NOT NULL,
  acceleration    FLOAT         NOT NULL,
  tilt_angle      FLOAT         NOT NULL,
  latitude        FLOAT         NULL,
  longitude       FLOAT         NULL,
  is_overspeeding BOOLEAN       NOT NULL DEFAULT FALSE,
  is_abrupt       BOOLEAN       NOT NULL DEFAULT FALSE,

  PRIMARY KEY (id),
  INDEX idx_timestamp    (timestamp),
  INDEX idx_overspeeding (is_overspeeding),
  INDEX idx_abrupt       (is_abrupt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
