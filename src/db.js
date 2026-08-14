const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function initDB() {
  const dbPath = path.join(__dirname, '..', 'data', 'chess.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_state (
      room_id TEXT PRIMARY KEY,
      state TEXT,
      updated_at INTEGER
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_weights (
      id INTEGER PRIMARY KEY,
      weights TEXT,
      stats TEXT,
      updated_at INTEGER
    )
  `);
  
  return db;
}

function closeDB(database) {
  if (database) database.close();
}

// 房间状态
function saveRoomState(roomId, state) {
  if (!db) return false;
  try {
    db.prepare(
      'INSERT OR REPLACE INTO room_state (room_id, state, updated_at) VALUES (?, ?, ?)'
    ).run(roomId, JSON.stringify(state), Date.now());
    return true;
  } catch (e) {
    console.error('saveRoomState error:', e);
    return false;
  }
}

function loadRoomState(roomId) {
  if (!db) return null;
  try {
    const row = db.prepare('SELECT state FROM room_state WHERE room_id = ?').get(roomId);
    if (row && row.state) return JSON.parse(row.state);
  } catch (e) {
    console.error('loadRoomState error:', e);
  }
  return null;
}

function deleteRoomState(roomId) {
  if (!db) return;
  try {
    db.prepare('DELETE FROM room_state WHERE room_id = ?').run(roomId);
  } catch (e) {}
}

// AI 权重
function loadAiData() {
  if (!db) return { weights: null, stats: null };
  try {
    const row = db.prepare('SELECT weights, stats FROM ai_weights WHERE id = 1').get();
    if (row) {
      return {
        weights: row.weights ? JSON.parse(row.weights) : null,
        stats: row.stats ? JSON.parse(row.stats) : null
      };
    }
  } catch (e) {
    console.error('loadAiData error:', e);
  }
  return { weights: null, stats: null };
}

function saveAiData(weights, stats) {
  if (!db) return false;
  try {
    db.prepare(
      'INSERT OR REPLACE INTO ai_weights (id, weights, stats, updated_at) VALUES (1, ?, ?, ?)'
    ).run(JSON.stringify(weights), JSON.stringify(stats), Date.now());
    return true;
  } catch (e) {
    console.error('saveAiData error:', e);
    return false;
  }
}

module.exports = { initDB, closeDB, saveRoomState, loadRoomState, deleteRoomState, loadAiData, saveAiData };