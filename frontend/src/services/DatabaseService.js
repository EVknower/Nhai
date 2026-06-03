/**
 * DatabaseService.js
 * NHAI Face Recognition System
 *
 * Manages all SQLite operations for:
 *  - Face enrollments (with embeddings)
 *  - Auth attempt logs (with sync tracking)
 *
 * Uses react-native-sqlite-storage
 */

import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);
SQLite.DEBUG(__DEV__);

const DB_NAME = 'nhai_facerecog.db';
const DB_VERSION = '1.0';
const DB_DISPLAY_NAME = 'NHAI Face Recognition DB';
const DB_SIZE = 200000;

class DatabaseService {
  constructor() {
    this.db = null;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  async init() {
    try {
      this.db = await SQLite.openDatabase({
        name: DB_NAME,
        version: DB_VERSION,
        displayName: DB_DISPLAY_NAME,
        size: DB_SIZE,
        location: 'default',
      });
      await this._createTables();
      console.log('[DB] Initialized successfully');
    } catch (error) {
      console.error('[DB] Init failed:', error);
      throw error;
    }
  }

  async _createTables() {
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        employee_id   TEXT NOT NULL UNIQUE,
        role          TEXT NOT NULL DEFAULT 'STAFF',
        embedding     TEXT NOT NULL,
        enrolled_at   TEXT NOT NULL,
        enrolled_by   TEXT,
        active        INTEGER NOT NULL DEFAULT 1,
        synced        INTEGER NOT NULL DEFAULT 0
      );
    `);

    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS auth_logs (
        id            TEXT PRIMARY KEY,
        timestamp     TEXT NOT NULL,
        result        TEXT NOT NULL,
        matched_id    TEXT,
        confidence    REAL,
        device_id     TEXT,
        liveness_pass INTEGER NOT NULL DEFAULT 0,
        synced        INTEGER NOT NULL DEFAULT 0
      );
    `);

    await this.db.executeSql(
      `CREATE INDEX IF NOT EXISTS idx_enrollments_employee_id ON enrollments(employee_id);`
    );
    await this.db.executeSql(
      `CREATE INDEX IF NOT EXISTS idx_auth_logs_synced ON auth_logs(synced);`
    );
    await this.db.executeSql(
      `CREATE INDEX IF NOT EXISTS idx_auth_logs_timestamp ON auth_logs(timestamp);`
    );
  }

  // ─── Enrollment Operations ───────────────────────────────────────────────────

  async enrollFace({ id, name, employeeId, role, embedding, enrolledBy }) {
    const embeddingJson = JSON.stringify(Array.from(embedding));
    const enrolledAt = new Date().toISOString();

    await this.db.executeSql(
      `INSERT INTO enrollments (id, name, employee_id, role, embedding, enrolled_at, enrolled_by, active, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [id, name, employeeId, role, embeddingJson, enrolledAt, enrolledBy || null]
    );

    console.log(`[DB] Enrolled: ${name} (${employeeId})`);
    return { id, name, employeeId, role, enrolledAt };
  }

  async updateEnrollment(employeeId, embedding) {
    const embeddingJson = JSON.stringify(Array.from(embedding));
    await this.db.executeSql(
      `UPDATE enrollments SET embedding = ?, synced = 0 WHERE employee_id = ? AND active = 1`,
      [embeddingJson, employeeId]
    );
    console.log(`[DB] Updated embedding for: ${employeeId}`);
  }

  async deactivateEnrollment(employeeId) {
    await this.db.executeSql(
      `UPDATE enrollments SET active = 0 WHERE employee_id = ?`,
      [employeeId]
    );
  }

  async getAllEmbeddings() {
    const [results] = await this.db.executeSql(
      `SELECT id, name, employee_id, role, embedding FROM enrollments WHERE active = 1`
    );

    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      const row = results.rows.item(i);
      rows.push({
        id: row.id,
        name: row.name,
        employeeId: row.employee_id,
        role: row.role,
        embedding: new Float32Array(JSON.parse(row.embedding)),
      });
    }
    return rows;
  }

  async getEnrollmentCount() {
    const [results] = await this.db.executeSql(
      `SELECT COUNT(*) as count FROM enrollments WHERE active = 1`
    );
    return results.rows.item(0).count;
  }

  async isEnrolled(employeeId) {
    const [results] = await this.db.executeSql(
      `SELECT id FROM enrollments WHERE employee_id = ? AND active = 1`,
      [employeeId]
    );
    return results.rows.length > 0;
  }

  // ─── Auth Log Operations ─────────────────────────────────────────────────────

  async logAuthAttempt({ id, result, matchedId, confidence, deviceId, livenessPass }) {
    const timestamp = new Date().toISOString();
    await this.db.executeSql(
      `INSERT INTO auth_logs (id, timestamp, result, matched_id, confidence, device_id, liveness_pass, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, timestamp, result, matchedId || null, confidence || null, deviceId, livenessPass ? 1 : 0]
    );
    console.log(`[DB] Auth log: ${result} (confidence: ${confidence?.toFixed(3)})`);
  }

  async getUnsyncedLogs() {
    const [results] = await this.db.executeSql(
      `SELECT * FROM auth_logs WHERE synced = 0 ORDER BY timestamp ASC LIMIT 200`
    );

    const logs = [];
    for (let i = 0; i < results.rows.length; i++) {
      const row = results.rows.item(i);
      logs.push({
        id: row.id,
        timestamp: row.timestamp,
        result: row.result,
        matchedId: row.matched_id,
        confidence: row.confidence,
        deviceId: row.device_id,
        livenessPass: row.liveness_pass === 1,
      });
    }
    return logs;
  }

  async getUnsyncedCount() {
    const [results] = await this.db.executeSql(
      `SELECT COUNT(*) as count FROM auth_logs WHERE synced = 0`
    );
    return results.rows.item(0).count;
  }

  async markSynced(ids) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.executeSql(
      `UPDATE auth_logs SET synced = 1 WHERE id IN (${placeholders})`,
      ids
    );
    console.log(`[DB] Marked ${ids.length} logs as synced`);
  }

  async getRecentLogs(limit = 50) {
    const [results] = await this.db.executeSql(
      `SELECT l.*, e.name as matched_name, e.employee_id as matched_employee_id
       FROM auth_logs l
       LEFT JOIN enrollments e ON l.matched_id = e.id
       ORDER BY l.timestamp DESC
       LIMIT ?`,
      [limit]
    );

    const logs = [];
    for (let i = 0; i < results.rows.length; i++) {
      logs.push(results.rows.item(i));
    }
    return logs;
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
      console.log('[DB] Connection closed');
    }
  }
}

export default new DatabaseService();
