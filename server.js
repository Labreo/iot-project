'use strict';

require('dotenv').config();

const express    = require('express');
const mysql      = require('mysql2/promise');
const cors       = require('cors');
const path       = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = process.env.SERVER_PORT || 3000;

const DB_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  port:    Number(    process.env.DB_PORT)     || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'telemetry_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  decimalNumbers:     true,
};

// Thresholds for anomaly detection
const OVERSPEEDING_THRESHOLD = 60;   // km/h
const ABRUPT_ACCEL_THRESHOLD = 8.0;  // m/s² magnitude (≈ 0.8g)

// ─── Database Pool ─────────────────────────────────────────────────────────────

let pool;

async function initDb() {
  pool = mysql.createPool(DB_CONFIG);

  // Verify connection
  const conn = await pool.getConnection();
  console.log(`✅ MySQL connected → ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  conn.release();
}

// ─── Express App ───────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Authentication (Bypassed by default) ──────────────────────────────────────
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';
const HARDCODED_PASSWORD = process.env.DEVICE_PASSWORD || 'pico-secret-123';

console.log(`🔒 Authentication status: ${REQUIRE_AUTH ? 'ENABLED' : 'DISABLED (Code ready)'}`);

function authMiddleware(req, res, next) {
  if (!REQUIRE_AUTH) {
    return next();
  }
  const clientPassword = req.headers['x-device-password'] || req.body.password;
  if (clientPassword === HARDCODED_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Invalid password.' });
}

app.use('/api', authMiddleware);

// ─── Helper ────────────────────────────────────────────────────────────────────

function detectAnomalies(speed, acceleration) {
  const is_overspeeding = speed > OVERSPEEDING_THRESHOLD;
  const is_abrupt       = Math.abs(acceleration) > ABRUPT_ACCEL_THRESHOLD;
  return { is_overspeeding, is_abrupt };
}

// ─── API Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/telemetry
 * Accepts a telemetry payload from the Raspberry Pi Pico 2 W.
 *
 * Expected body:
 *   { "speed": float, "acceleration": float, "tilt_angle": float,
 *     "lat": float|null, "lng": float|null }
 */
app.post('/api/telemetry', async (req, res) => {
  try {
    const { speed, acceleration, tilt_angle, lat = null, lng = null } = req.body;

    // Validate required numeric fields
    if (
      typeof speed        !== 'number' ||
      typeof acceleration !== 'number' ||
      typeof tilt_angle   !== 'number'
    ) {
      return res.status(400).json({
        error: 'Invalid payload. speed, acceleration, and tilt_angle must be numbers.',
      });
    }

    const { is_overspeeding, is_abrupt } = detectAnomalies(speed, acceleration);

    const [result] = await pool.execute(
      `INSERT INTO device_logs
         (speed, acceleration, tilt_angle, latitude, longitude, is_overspeeding, is_abrupt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [speed, acceleration, tilt_angle, lat, lng, is_overspeeding, is_abrupt]
    );

    // Check for pending commands to return in response
    let pendingCommand = null;
    const [commands] = await pool.execute(
      `SELECT * FROM device_commands WHERE is_sent = FALSE ORDER BY id ASC LIMIT 1`
    );
    if (commands.length > 0) {
      pendingCommand = commands[0];
      // Mark it as sent
      await pool.execute(
        `UPDATE device_commands SET is_sent = TRUE, sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [pendingCommand.id]
      );
    }

    return res.status(201).json({
      id:             result.insertId,
      is_overspeeding,
      is_abrupt,
      message:        'Telemetry data recorded.',
      warning:        is_overspeeding,
      command:        pendingCommand ? pendingCommand.command : null,
    });
  } catch (err) {
    console.error('POST /api/telemetry error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/telemetry/live
 * Returns the single most recent log entry.
 */
app.get('/api/telemetry/live', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM device_logs ORDER BY id DESC LIMIT 1`
    );
    return res.json(rows[0] || null);
  } catch (err) {
    console.error('GET /api/telemetry/live error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/telemetry/history
 * Returns the last 50 log entries (chronological order for charting).
 */
app.get('/api/telemetry/history', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM (
         SELECT * FROM device_logs ORDER BY id DESC LIMIT 50
       ) AS sub
       ORDER BY id ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/telemetry/history error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/telemetry/incidents
 * Returns all rows where is_overspeeding OR is_abrupt is true.
 */
app.get('/api/telemetry/incidents', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM device_logs
       WHERE is_overspeeding = TRUE OR is_abrupt = TRUE
       ORDER BY id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/telemetry/incidents error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/commands
 * Queues a new command to be sent to the Pico 2 W.
 */
app.post('/api/commands', async (req, res) => {
  try {
    const { command } = req.body;
    if (typeof command !== 'string' || command.trim() === '') {
      return res.status(400).json({ error: 'Invalid command. command must be a non-empty string.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO device_commands (command) VALUES (?)`,
      [command.trim()]
    );

    return res.status(201).json({
      id: result.insertId,
      message: 'Command queued successfully.',
    });
  } catch (err) {
    console.error('POST /api/commands error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/commands/pending
 * Returns all un-sent commands.
 */
app.get('/api/commands/pending', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM device_commands WHERE is_sent = FALSE ORDER BY id ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/commands/pending error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/commands/history
 * Returns the last 15 sent commands.
 */
app.get('/api/commands/history', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM device_commands WHERE is_sent = TRUE ORDER BY id DESC LIMIT 15`
    );
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/commands/history error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Catch-all: serve SPA ──────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`🚀 Telemetry server running → http://localhost:${PORT}`);
      console.log(`   Overspeeding threshold : ${OVERSPEEDING_THRESHOLD} km/h`);
      console.log(`   Abrupt accel threshold : ±${ABRUPT_ACCEL_THRESHOLD} m/s²`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
})();
