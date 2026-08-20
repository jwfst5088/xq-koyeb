const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initDB, closeDB, saveRoomState, loadRoomState } = require('./src/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingTimeout: 8000,
  pingInterval: 4000,
  connectTimeout: 45000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const rooms = new Map();
const disconnectedPlayers = new Map();
let db;

function broadcastOnlineCount() {
  io.emit('online_count', io.engine.clientsCount);
}

function createRoom() {
  let roomId;
  do {
    roomId = generateRoomId();
  } while (rooms.has(roomId));
  rooms.set(roomId, {
    id: roomId,
    players: new Map(),
    spectators: new Set(),
    currentTurn: 'red',
    gameOver: false,
    winner: null,
    redTime: 900,
    blkTime: 900,
    moveHistory: [],
    capturedRed: [],
    capturedBlack: [],
    gameStarted: false,
    createdAt: Date.now(),
  });
  return roomId;
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms.has(id)) return generateRoomId();
  return id;
}

function getRoomState(room) {
  return {
    roomId: room.id,
    playerCount: room.players.size,
    currentTurn: room.currentTurn,
    gameOver: room.gameOver,
    winner: room.winner,
    moveHistory: room.moveHistory,
    gameStarted: room.gameStarted || false,
    capturedRed: room.capturedRed || [],
    capturedBlack: room.capturedBlack || [],
    redTime: room.redTime != null ? room.redTime : 900,
    blkTime: room.blkTime != null ? room.blkTime : 900,
  };
}

function startRoomTimer(room) {
  if (room._timer) clearInterval(room._timer);
  room._timer = setInterval(function() {
    if (room.gameOver) { clearInterval(room._timer); room._timer = null; return; }
    if (room.currentTurn === 'red') {
      room.redTime = Math.max(0, room.redTime - 1);
      if (room.redTime <= 0) { 
        room.gameOver = true; 
        room.winner = 'black'; 
        room._gameEndedAt = Date.now(); 
        clearInterval(room._timer); 
        room._timer = null; 
        io.to(room.id).emit('timeout', { winner: 'black' }); 
      }
    } else {
      room.blkTime = Math.max(0, room.blkTime - 1);
      if (room.blkTime <= 0) { 
        room.gameOver = true; 
        room.winner = 'red'; 
        room._gameEndedAt = Date.now(); 
        clearInterval(room._timer); 
        room._timer = null; 
        io.to(room.id).emit('timeout', { winner: 'red' }); 
      }
    }
  }, 1000);
}

io.on('connection', (socket) => {
  broadcastOnlineCount();
  console.log(`[连接] ${socket.id}`);

  socket.on('create_room', (customId) => {
    if (rooms.size >= 20) {
      socket.emit('error', '房间数已达上限(20个)，请稍后再试');
      return;
    }
    var roomId;
    if (customId && typeof customId === 'string' && /^[A-Z0-9]{1,6}$/.test(customId)) {
      if (rooms.has(customId)) {
        socket.emit('error', '该房间号已被占用，请换一个');
        return;
      }
      roomId = customId;
      rooms.set(roomId, {
        id: roomId,
        players: new Map(),
        spectators: new Set(),
        currentTurn: 'red',
        gameOver: false,
        winner: null,
        redTime: 900,
        blkTime: 900,
        moveHistory: [],
        capturedRed: [],
        capturedBlack: [],
        gameStarted: false,
        createdAt: Date.now()
      });
    } else {
      roomId = createRoom();
    }
    const room = rooms.get(roomId);
    var myColor = Math.random() < 0.5 ? 'red' : 'black';
    room.players.set(socket.id, { id: socket.id, color: myColor });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = myColor;
    socket.emit('room_created', { roomId, color: myColor });
    console.log(`[房间] ${roomId} 创建, ${myColor}方: ${socket.id}`);
  });

  socket.on('join_room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', '房间不存在');
      return;
    }
    if (room.players.size >= 2) {
      socket.emit('error', '房间已满,进入观战模式');
      room.spectators.add(socket.id);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.spectator = true;
      socket.emit('spectator_joined', { roomId, moveHistory: room.moveHistory });
      return;
    }

    let color;
    const colors = ['red', 'black'];
    if (room.players.size === 0) {
      color = colors[Math.floor(Math.random() * 2)];
    } else {
      const existingPlayer = [...room.players.values()][0];
      color = existingPlayer.color === 'red' ? 'black' : 'red';
    }

    room.players.set(socket.id, { id: socket.id, color });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = color;

    socket.emit('room_joined', { roomId, color });
    io.to(roomId).emit('room_state', getRoomState(room));
    io.to(roomId).emit('game_start', { currentTurn: room.currentTurn });
    room.gameStarted = true;
    startRoomTimer(room);
    console.log(`[房间] ${roomId} 加入, ${color}方: ${socket.id}`);
  });

  socket.on('make_move', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.gameOver) return;
    // 重连过渡期：若游戏已开始（有走棋记录），允许 players.size < 2 时继续走棋
    if (room.players.size < 2 && room.moveHistory.length === 0) return;

    const move = {
      ...data,
      playerId: socket.id,
      timestamp: Date.now(),
    };

    room.moveHistory.push(move);

    if (data.captured) {
      if (!room.capturedRed) room.capturedRed = [];
      if (!room.capturedBlack) room.capturedBlack = [];
      if (data.captured.color === 'red') room.capturedRed.push(data.captured);
      else room.capturedBlack.push(data.captured);
    }

    if (data.currentTurn !== undefined) {
      room.currentTurn = data.currentTurn;
    }
    if (data.redLeft !== undefined) room.redTime = data.redLeft;
    if (data.blkLeft !== undefined) room.blkTime = data.blkLeft;
    if (data.gameOver) {
      room.gameOver = true;
      room._gameEndedAt = Date.now();
      room.winner = data.winner;
    }

    const opponentMove = { ...move, redLeft: room.redTime, blkLeft: room.blkTime };
    socket.to(roomId).emit('opponent_move', opponentMove);
    io.to(roomId).emit('room_state', getRoomState(room));
    
    // 保存房间状态到数据库
    if (db) {
      try {
        saveRoomState(db, room.id, {
          currentTurn: room.currentTurn,
          gameOver: room.gameOver,
          winner: room.winner,
          redTime: room.redTime,
          blkTime: room.blkTime,
          moveHistory: room.moveHistory,
          capturedRed: room.capturedRed,
          capturedBlack: room.capturedBlack,
          createdAt: room.createdAt,
        });
      } catch (e) {
        console.error('保存房间状态失败:', e);
      }
    }
  });

  socket.on('resign', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameOver = true;
    room._gameEndedAt = Date.now();
    room.winner = socket.data.color === 'red' ? 'black' : 'red';
    if (room._timer) { clearInterval(room._timer); room._timer = null; }
    io.to(roomId).emit('game_over', { winner: room.winner, reason: 'resign' });
    io.to(roomId).emit('room_state', getRoomState(room));
  });

  socket.on('request_draw', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('draw_requested', { from: socket.id });
  });

  socket.on('accept_draw', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameOver = true;
    room._gameEndedAt = Date.now();
    room.winner = 'draw';
    if (room._timer) { clearInterval(room._timer); room._timer = null; }
    io.to(roomId).emit('game_over', { winner: 'draw', reason: 'draw' });
    io.to(roomId).emit('room_state', getRoomState(room));
  });

  socket.on('reject_draw', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('draw_rejected');
  });

  socket.on('chat', (message) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit('chat', {
      from: socket.id.slice(0, 6),
      color: socket.data.color,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on('rematch', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.players.size < 2) return;

    room.gameOver = false;
    room._gameEndedAt = null;
    room.winner = null;
    room.currentTurn = 'red';
    room.gameStarted = true;
    room.redTime = 900;
    room.blkTime = 900;
    room.moveHistory = [];
    room.capturedRed = [];
    room.capturedBlack = [];

    // 红黑交替轮换：交换两个玩家的颜色
    const playerEntries = [...room.players.entries()];
    if (playerEntries.length >= 2) {
      const [sid1, player1] = playerEntries[0];
      const [sid2, player2] = playerEntries[1];
      const tempColor = player1.color;
      player1.color = player2.color;
      player2.color = tempColor;
      // 更新 socket.data.color 以便后续操作正确
      const socket1 = io.sockets.sockets.get(sid1);
      const socket2 = io.sockets.sockets.get(sid2);
      if (socket1) socket1.data.color = player1.color;
      if (socket2) socket2.data.color = player2.color;
    }

    startRoomTimer(room);
    // 红黑交替轮换：单独通知每个玩家自己的新颜色（客户端据此更新 myCl/boardFlip）
    for (const [sid, player] of room.players) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('rematch_start', { color: player.color });
    }
    io.to(roomId).emit('room_state', getRoomState(room));
  });

  socket.on('request_undo', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.moveHistory.length === 0 || room.gameOver) return;
    const last = room.moveHistory[room.moveHistory.length - 1];
    if (last.pieceColor !== socket.data.color) return;
    socket.to(roomId).emit('undo_requested');
  });

  socket.on('accept_undo', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.moveHistory.length === 0) return;
    room.moveHistory.pop();
    room.gameOver = false;
    room.winner = null;
    socket.to(roomId).emit('undo_accepted');
  });

  socket.on('reject_undo', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('undo_rejected');
  });

  socket.on('leave_room', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const color = socket.data.color;
    if (color) {
      for (const [sid, player] of room.players) {
        if (player.color === color) {
          room.players.delete(sid);
          break;
        }
      }
    }
    room.spectators && room.spectators.delete(socket.id);

    if (room.players.size > 0) {
      socket.to(roomId).emit('opponent_left');
    }
    if (room._timer) { clearInterval(room._timer); room._timer = null; }
    rooms.delete(roomId);
    disconnectedPlayers.delete(roomId);
    console.log(`[房间] ${roomId} 已解散（${color}方主动退出）`);

    socket.data.roomId = null;
    socket.data.color = null;
    socket.data.spectator = null;
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    broadcastOnlineCount();

    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (socket.data.spectator) {
      room.spectators.delete(socket.id);
      return;
    }

    const color = socket.data.color;
    // 房间仅1个玩家
    if (room.players.size < 2) {
      if (room.moveHistory.length > 0) {
        // 游戏已开始（有走棋记录），保留房间等待重连（参考 xq-vps）
        if (!disconnectedPlayers.has(roomId)) {
          disconnectedPlayers.set(roomId, {});
        }
        disconnectedPlayers.get(roomId)[color] = Date.now();
        // 保存房间状态到数据库，防止容器重启后丢失
        if (db) {
          try {
            saveRoomState(db, roomId, {
              currentTurn: room.currentTurn,
              gameOver: room.gameOver,
              winner: room.winner,
              redTime: room.redTime,
              blkTime: room.blkTime,
              moveHistory: room.moveHistory,
              capturedRed: room.capturedRed,
              capturedBlack: room.capturedBlack,
              createdAt: room.createdAt,
            });
          } catch (e) {
            console.error('断线保存房间状态失败:', e);
          }
        }
        socket.to(roomId).emit('player_disconnected', { color });
        console.log(`[断开] ${socket.id} (${roomId}, ${color}方, 游戏已开始, 等待重连...)`);
      } else {
        // 游戏未开始，直接删除房间
        rooms.delete(roomId);
        disconnectedPlayers.delete(roomId);
        if (room._timer) { clearInterval(room._timer); room._timer = null; }
        console.log(`[清理] 房间 ${roomId} 仅1人断线已解散`);
      }
      socket.data.roomId = null;
      socket.data.color = null;
      return;
    }

    if (!disconnectedPlayers.has(roomId)) {
      disconnectedPlayers.set(roomId, {});
    }
    disconnectedPlayers.get(roomId)[color] = Date.now();
    socket.to(roomId).emit('player_disconnected', { color });
    console.log(`[断开] ${socket.id} (${roomId}, ${color}方, 等待重连...)`);
  });

  socket.on('reconnect_room', (data) => {
    const roomId = data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) { 
      // 尝试从数据库恢复
      if (db) {
        try {
          const saved = loadRoomState(db, roomId);
          if (saved) {
            rooms.set(roomId, {
              ...saved,
              players: new Map(),
              spectators: new Set(),
              _timer: null,
            });
            const restoredRoom = rooms.get(roomId);
            let color = data.color;
            if (!color) {
              // 尝试从房间状态推断颜色
              const dp = disconnectedPlayers.get(roomId);
              if (dp && dp.red) color = 'red';
              else if (dp && dp.black) color = 'black';
            }
            if (!color) color = 'red';
            
            restoredRoom.players.set(socket.id, { id: socket.id, color });
            socket.join(roomId);
            socket.data.roomId = roomId;
            socket.data.color = color;
            
            const gameInProgress = restoredRoom.moveHistory.length > 0;
            socket.emit('game_state', {
              roomId, color,
              moveHistory: restoredRoom.moveHistory,
              currentTurn: restoredRoom.currentTurn,
              gameOver: restoredRoom.gameOver,
              winner: restoredRoom.winner,
              redTime: restoredRoom.redTime != null ? restoredRoom.redTime : 900,
              blkTime: restoredRoom.blkTime != null ? restoredRoom.blkTime : 900,
              capturedRed: restoredRoom.capturedRed || [],
              capturedBlack: restoredRoom.capturedBlack || [],
              gameStarted: gameInProgress || restoredRoom.players.size >= 2
            });
            
            if (gameInProgress && !restoredRoom.gameOver) {
              socket.emit('game_start', { currentTurn: restoredRoom.currentTurn });
            }
            
            if (!restoredRoom.gameOver && restoredRoom.players.size >= 2) {
              startRoomTimer(restoredRoom);
            }
            
            socket.to(roomId).emit('player_reconnected', { color });
            console.log(`[重连] ${socket.id} 从数据库恢复房间 ${roomId} (${color}方)`);
            return;
          }
        } catch (e) {
          console.error('从数据库恢复失败:', e);
        }
      }
      socket.emit('error', '房间已不存在'); 
      return; 
    }

    const dp = disconnectedPlayers.get(roomId);
    let color = data.color;

    // 如果 disconnectedPlayers 中没有记录，尝试从 room.players 中匹配
    if (dp) {
      if (color && dp[color]) {
        // 正常情况：从 disconnectedPlayers 中找到匹配
      } else if (!color || !dp[color]) {
        // color 未指定或不匹配，尝试从 dp 中获取
        if (dp.red) color = 'red';
        else if (dp.black) color = 'black';
      }
    }

    if (!color) {
      // 最后尝试从 room.players 中找（按socket.id匹配不到，按颜色也匹配不到，说明无法重连）
      socket.emit('error', '无法重连，请重新加入房间');
      return;
    }

    // 清理 disconnectedPlayers 中的记录
    if (dp) {
      delete dp[color];
      if (!dp.red && !dp.black) disconnectedPlayers.delete(roomId);
    }

    // 移除旧连接（同一颜色的旧socket）
    for (const [sid, player] of room.players) {
      if (player.color === color && sid !== socket.id) {
        room.players.delete(sid);
        break;
      }
    }
    room.players.set(socket.id, { id: socket.id, color });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = color;

    // 发送完整游戏状态，包含 gameStarted: true（游戏已开始且有走棋记录时）
    const gameInProgress = room.moveHistory.length > 0;
    socket.emit('game_state', {
      roomId, color,
      moveHistory: room.moveHistory,
      currentTurn: room.currentTurn,
      gameOver: room.gameOver,
      winner: room.winner,
      redTime: room.redTime != null ? room.redTime : 900,
      blkTime: room.blkTime != null ? room.blkTime : 900,
      capturedRed: room.capturedRed || [],
      capturedBlack: room.capturedBlack || [],
      gameStarted: gameInProgress || room.players.size >= 2
    });

    // 游戏已开始且有走棋记录时，通知客户端恢复对局
    if (gameInProgress && !room.gameOver) {
      socket.emit('game_start', { currentTurn: room.currentTurn });
    }

    if (!room.gameOver && room.players.size >= 2) {
      startRoomTimer(room);
    }

    socket.to(roomId).emit('player_reconnected', { color });
    console.log(`[重连] ${socket.id} 重连到房间 ${roomId} (${color}方)`);
  });
});

// 定期清理无用房间：双方都断线 或 游戏结束后5分钟无人活动
const ROOM_CLEANUP_INTERVAL = 60 * 1000; // 每60秒检查一次
const GAME_OVER_GRACE = 5 * 60 * 1000;   // 游戏结束后5分钟宽限期

setInterval(function() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    // 双方都断线 → 清理
    const dp = disconnectedPlayers.get(roomId);
    if (dp && dp.red && dp.black) {
      rooms.delete(roomId);
      disconnectedPlayers.delete(roomId);
      if (room._timer) { clearInterval(room._timer); room._timer = null; }
      console.log('[清理] 房间 ' + roomId + ' 双方断线已解散');
      continue;
    }
    // 游戏结束且超过宽限期 → 清理
    if (room.gameOver && room._gameEndedAt && (now - room._gameEndedAt > GAME_OVER_GRACE)) {
      rooms.delete(roomId);
      disconnectedPlayers.delete(roomId);
      if (room._timer) { clearInterval(room._timer); room._timer = null; }
      console.log('[清理] 房间 ' + roomId + ' 游戏结束超时已解散');
      continue;
    }
    // 房间无玩家无观众 → 清理
    if (room.players.size === 0 && (!room.spectators || room.spectators.size === 0)) {
      rooms.delete(roomId);
      disconnectedPlayers.delete(roomId);
      if (room._timer) { clearInterval(room._timer); room._timer = null; }
      console.log('[清理] 房间 ' + roomId + ' 空房间已解散');
    }
  }
}, ROOM_CLEANUP_INTERVAL);

app.get('/favicon.ico',(req,res)=>{
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
async function startup() {
  db = initDB();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  });
}

startup().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  closeDB(db);
  server.close();
  process.exit(0);
});
