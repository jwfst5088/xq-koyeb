const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { initDB, closeDB } = require('./src/db');
const { createAppRouter } = require('./src/index');
const { ChessRoomManager } = require('./src/chess-room');

const app = express();
const server = http.createServer(app);

// 静态资源（新版前端：index.html + js/pikafish* + pikafish.nnue.part* 等）
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // 棋盘页面不缓存，保证更新立即生效
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  },
}));
app.use(express.json());

// 初始化 SQLite 与房间管理器，挂载 /api/* 路由（train/ai/rooms/online/create-room）
const db = initDB();
const roomManager = new ChessRoomManager(db);
app.use('/api', createAppRouter(db, roomManager));

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// 裸 WebSocket（与 Worker 版一致）：/ws 大厅，/ws?roomId=xxx 房间
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, 'http://localhost');
  } catch (e) {
    socket.destroy();
    return;
  }
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    const roomId = url.searchParams.get('roomId');
    if (roomId) {
      roomManager.handleRoomWebSocket(ws, roomId);
    } else {
      roomManager.handleLobbyWebSocket(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  closeDB(db);
  server.close();
  process.exit(0);
});
