const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { initDB, closeDB } = require('./src/db');
const { createAppRouter } = require('./src/index');
const { ChessRoomManager } = require('./src/chess-room');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 初始化数据库和房间管理器
let db, roomManager;

async function startup() {
  db = initDB();
  roomManager = new ChessRoomManager(db);
  
  // API 路由
  app.use('/api', createAppRouter(db, roomManager));

  // WebSocket 服务
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('roomId');
    
    if (roomId) {
      // 房间 WebSocket → 交给房间管理器
      roomManager.handleRoomWebSocket(ws, roomId);
    } else {
      // 大厅 WebSocket → 处理大厅逻辑
      handleLobbyWebSocket(ws, roomManager);
    }
  });

  // 所有其他路由 → index.html（SPA 支持）
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// 大厅 WebSocket 处理
function handleLobbyWebSocket(ws, roomManager) {
  roomManager.addConnection(ws);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const event = msg.event || msg[0];
      const payload = msg.payload || msg[1];

      if (event === 'create_room' || event === 'join_room') {
        const rid = payload || Math.random().toString(36).slice(2, 8).toUpperCase();
        ws.send(JSON.stringify({
          event: 'redirect_room',
          data: { roomId: rid, action: event === 'create_room' ? 'create' : 'join' }
        }));
      } else if (event === 'reconnect_room') {
        const rid = payload?.roomId;
        if (rid) {
          ws.send(JSON.stringify({
            event: 'redirect_room',
            data: { roomId: rid, action: 'reconnect', color: payload.color }
          }));
        }
      } else if (event === 'ping') {
        try { ws.send(JSON.stringify({ event: 'pong' })); } catch (e) {}
      }
    } catch (e) {
      console.error('Lobby WebSocket error:', e);
    }
  });

  ws.on('close', () => {
    roomManager.removeConnection(ws);
  });
}

startup().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  closeDB(db);
  server.close();
  process.exit(0);
});