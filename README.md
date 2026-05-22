# 📡 IoT Telemetry Dashboard

A full-stack real-time vehicle monitoring system for the **Raspberry Pi Pico 2 W**.  
It receives telemetry over HTTP, stores it in MySQL, and visualises speed, tilt, acceleration, and GPS data on a live web dashboard.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [Installation & Setup](#installation--setup)
5. [Environment Variables](#environment-variables)
6. [Database Schema](#database-schema)
7. [Running the Server](#running-the-server)
8. [REST API Reference](#rest-api-reference)
9. [Anomaly Detection Logic](#anomaly-detection-logic)
10. [Dashboard Features](#dashboard-features)
11. [Sending Data from Pico 2 W](#sending-data-from-pico-2-w)
12. [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Backend    | Node.js · Express 4                 |
| Database   | MySQL / MariaDB (via `mysql2`)       |
| Frontend   | Vanilla HTML/CSS/JS · Chart.js 4    |
| Config     | `dotenv`                            |
| Dev server | `node --watch` (built-in Node ≥ 18) |

---

## Project Structure

```
iot-project/
├── server.js          ← Express REST API + DB connection pool
├── schema.sql         ← Database & table creation script
├── package.json       ← Node dependencies & npm scripts
├── .env.example       ← Environment variable template
├── .env               ← Your local config (never commit this)
└── public/
    └── index.html     ← Single-page dashboard (no build step)
```

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|-----------------|-------|
| Node.js     | 18.x            | Uses `node --watch` for dev mode |
| npm         | 9.x             | Bundled with Node |
| MySQL       | 8.0 **or** MariaDB 10.6 | See install note below |

### Installing MySQL on macOS (Homebrew)

```bash
brew install mysql
brew services start mysql       # start MySQL as a background service
mysql_secure_installation       # (optional) set root password & harden defaults
```

> **Note:** If you skip `mysql_secure_installation`, the root user has no password by default. Leave `DB_PASSWORD` blank in `.env`.

---

## Installation & Setup

```bash
# 1. Clone / copy the project
cd iot-project

# 2. Install Node dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
# → open .env and fill in your MySQL credentials

# 4. Initialise the database (creates DB + table)
mysql -u root -p < schema.sql
```

---

## Environment Variables

| Variable      | Default         | Description                       |
|---------------|-----------------|-----------------------------------|
| `DB_HOST`     | `localhost`     | MySQL server hostname             |
| `DB_PORT`     | `3306`          | MySQL port                        |
| `DB_USER`     | `root`          | MySQL username                    |
| `DB_PASSWORD` | *(empty)*       | MySQL password                    |
| `DB_NAME`     | `telemetry_db`  | Database name                     |
| `SERVER_PORT` | `3000`          | HTTP port the Express server uses |

All variables have safe defaults; the server will still start if `.env` is missing, but you must ensure MySQL is accessible with those defaults.

---

## Database Schema

**Database:** `telemetry_db`  
**Charset:** `utf8mb4` / `utf8mb4_unicode_ci`

### Table: `device_logs`

| Column           | Type       | Nullable | Default             | Description                              |
|------------------|------------|----------|---------------------|------------------------------------------|
| `id`             | `INT`      | NO       | Auto-increment PK   | Unique row identifier                    |
| `timestamp`      | `DATETIME` | NO       | `CURRENT_TIMESTAMP` | Time the record was inserted             |
| `speed`          | `FLOAT`    | NO       | —                   | Vehicle speed in **km/h**                |
| `acceleration`   | `FLOAT`    | NO       | —                   | Acceleration in **m/s²** (signed)        |
| `tilt_angle`     | `FLOAT`    | NO       | —                   | Device tilt in **degrees**               |
| `latitude`       | `FLOAT`    | YES      | `NULL`              | GPS latitude (decimal degrees)           |
| `longitude`      | `FLOAT`    | YES      | `NULL`              | GPS longitude (decimal degrees)          |
| `is_overspeeding`| `BOOLEAN`  | NO       | `FALSE`             | `TRUE` when `speed > 60 km/h`            |
| `is_abrupt`      | `BOOLEAN`  | NO       | `FALSE`             | `TRUE` when `|acceleration| > 8.0 m/s²` |

### Indexes

| Index Name        | Column(s)        | Purpose                               |
|-------------------|------------------|---------------------------------------|
| `PRIMARY`         | `id`             | Row lookup                            |
| `idx_timestamp`   | `timestamp`      | Time-range queries                    |
| `idx_overspeeding`| `is_overspeeding`| Fast incident filter                  |
| `idx_abrupt`      | `is_abrupt`      | Fast incident filter                  |

### SQL (verbatim from `schema.sql`)

```sql
CREATE DATABASE IF NOT EXISTS telemetry_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE telemetry_db;

CREATE TABLE IF NOT EXISTS device_logs (
  id              INT      NOT NULL AUTO_INCREMENT,
  timestamp       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  speed           FLOAT    NOT NULL,
  acceleration    FLOAT    NOT NULL,
  tilt_angle      FLOAT    NOT NULL,
  latitude        FLOAT    NULL,
  longitude       FLOAT    NULL,
  is_overspeeding BOOLEAN  NOT NULL DEFAULT FALSE,
  is_abrupt       BOOLEAN  NOT NULL DEFAULT FALSE,

  PRIMARY KEY (id),
  INDEX idx_timestamp    (timestamp),
  INDEX idx_overspeeding (is_overspeeding),
  INDEX idx_abrupt       (is_abrupt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Running the Server

```bash
# Production
npm start

# Development (auto-restarts on file changes, Node ≥ 18)
npm run dev
```

Expected console output on success:

```
✅ MySQL connected → localhost:3306/telemetry_db
🚀 Telemetry server running → http://localhost:3000
   Overspeeding threshold : 60 km/h
   Abrupt accel threshold : ±8 m/s²
```

Open **http://localhost:3000** in your browser to view the dashboard.

---

## REST API Reference

Base URL: `http://localhost:3000`

---

### `POST /api/telemetry`

Ingest a telemetry reading from the Pico 2 W (or any HTTP client).

**Request body** (`Content-Type: application/json`)

```json
{
  "speed":        72.4,
  "acceleration":  2.1,
  "tilt_angle":    5.3,
  "lat":          12.9716,
  "lng":          77.5946
}
```

| Field          | Type    | Required | Description                       |
|----------------|---------|----------|-----------------------------------|
| `speed`        | `float` | ✅        | Vehicle speed in km/h             |
| `acceleration` | `float` | ✅        | Acceleration in m/s² (signed)     |
| `tilt_angle`   | `float` | ✅        | Tilt in degrees                   |
| `lat`          | `float` | ❌        | GPS latitude (omit if no GPS fix) |
| `lng`          | `float` | ❌        | GPS longitude                     |

**Response `201 Created`**

```json
{
  "id": 42,
  "is_overspeeding": true,
  "is_abrupt": false,
  "message": "Telemetry data recorded."
}
```

**Response `400 Bad Request`** — if `speed`, `acceleration`, or `tilt_angle` are missing or non-numeric.

---

### `GET /api/telemetry/live`

Returns the **single most recent** log entry. Used by the dashboard for live widget polling (every 3 s).

**Response `200 OK`**

```json
{
  "id": 42,
  "timestamp": "2026-05-22T18:30:00.000Z",
  "speed": 72.4,
  "acceleration": 2.1,
  "tilt_angle": 5.3,
  "latitude": 12.9716,
  "longitude": 77.5946,
  "is_overspeeding": 1,
  "is_abrupt": 0
}
```

Returns `null` if the table is empty.

---

### `GET /api/telemetry/history`

Returns the **last 50 entries** in ascending chronological order. Used to seed the Chart.js line charts on page load.

**Response `200 OK`** — Array of up to 50 row objects (same shape as above).

---

### `GET /api/telemetry/incidents`

Returns **all rows** where `is_overspeeding = TRUE` or `is_abrupt = TRUE`, newest first. Used to populate the Incident Log table.

**Response `200 OK`** — Array of incident row objects.

---

## Anomaly Detection Logic

Both flags are computed **server-side** in `server.js` before each INSERT — the Pico does not need to calculate them.

```
is_overspeeding = speed > 60           (km/h)
is_abrupt       = |acceleration| > 8.0 (m/s²  ≈ 0.8 g)
```

To adjust thresholds, edit these constants at the top of `server.js`:

```js
const OVERSPEEDING_THRESHOLD = 60;   // km/h
const ABRUPT_ACCEL_THRESHOLD = 8.0;  // m/s²
```

No database changes are required — the flags are derived at insert time.

---

## Dashboard Features

| Section | Detail |
|---------|--------|
| **Live Status Widgets** | Speed · Tilt Angle · Acceleration · GPS coordinates. Polls `/api/telemetry/live` every **3 seconds**. |
| **Speed Chart** | Line chart with a dashed red 60 km/h threshold line. |
| **Tilt Angle Chart** | Line chart in teal showing device orientation. |
| **Acceleration Chart** | Full-width line chart with dashed ±8 m/s² threshold lines. |
| **Incident Log Table** | All flagged events, auto-refreshes every **10 seconds**. Manual refresh button also available. |
| **Connection Status** | Green pulsing pill when live data is arriving; red when the server is unreachable. |
| **Toast Notifications** | Pop-up warnings appear in the corner whenever a live reading is flagged as overspeeding or abrupt. |

---

## Sending Data from Pico 2 W

Below is a minimal **MicroPython** snippet to POST telemetry:

```python
import urequests
import ujson

SERVER_URL = "http://<your-laptop-ip>:3000/api/telemetry"

def send_telemetry(speed, acceleration, tilt_angle, lat=None, lng=None):
    payload = {
        "speed":        speed,
        "acceleration": acceleration,
        "tilt_angle":   tilt_angle,
        "lat":          lat,
        "lng":          lng,
    }
    try:
        res = urequests.post(
            SERVER_URL,
            headers={"Content-Type": "application/json"},
            data=ujson.dumps(payload)
        )
        print(res.json())
        res.close()
    except Exception as e:
        print("Send failed:", e)

# Example call (replace with real sensor values)
send_telemetry(speed=55.2, acceleration=1.4, tilt_angle=3.1, lat=12.97, lng=77.59)
```

> **Important:** Replace `<your-laptop-ip>` with the actual local IP of your Mac on the same Wi-Fi network (find it with `ipconfig getifaddr en0`).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `zsh: command not found: mysql` | MySQL not installed. Run `brew install mysql && brew services start mysql` |
| `Error: connect ECONNREFUSED` | MySQL service isn't running. Run `brew services start mysql` |
| `ER_ACCESS_DENIED_ERROR` | Wrong DB credentials in `.env`. Verify with `mysql -u root -p` |
| `ER_BAD_DB_ERROR` | Database not created yet. Re-run `mysql -u root -p < schema.sql` |
| Dashboard shows "Offline" | Server not running, or browser can't reach `localhost:3000` |
| Pico can't reach server | Ensure Pico and Mac are on the **same Wi-Fi network** and use Mac's LAN IP (not `localhost`) |
| Port 3000 already in use | Change `SERVER_PORT` in `.env` to e.g. `3001` |

---

> **Note on MySQL install (current state):** As of project setup, `brew install mysql` was initiated but may still be completing. Once done, run `brew services start mysql` then re-run `mysql -u root -p < schema.sql` to initialise the schema.
