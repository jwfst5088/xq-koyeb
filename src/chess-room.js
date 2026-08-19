const { saveRoomState, loadRoomState, deleteRoomState } = require('./db');

// 全局在线计数
const activeConnections = new Set();
let onlineCount = 0;

function broadcastOnlineCount() {
  const msg = JSON.stringify({ event: 'online_count', data: onlineCount });
  for (const ws of activeConnections) {
    try { ws.send(msg); } catch (e) {}
  }
}

class ChessRoomManager {
  constructor(db) {
    this.db = db;
    this.rooms = new Map(); // roomId → roomData
  }

  addConnection(ws) {
    onlineCount++;
    activeConnections.add(ws);
    ws.send(JSON.stringify({ event: 'online_count', data: onlineCount }));
    broadcastOnlineCount();
  }

  removeConnection(ws) {
    onlineCount--;
    activeConnections.delete(ws);
    broadcastOnlineCount();
  }

  getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      // 尝试从数据库恢复
      const saved = loadRoomState(roomId);
      const room = {
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
        createdAt: Date.now(),
        _timer: null,
        _timerLastTick: null,
        _disconnectTimer: null,
        disconnected: {}
      };
      
      if (saved && saved.createdAt && (Date.now() - saved.createdAt < 3600000)) {
        room.currentTurn = saved.currentTurn || 'red';
        room.gameOver = saved.gameOver || false;
        room.winner = saved.winner || null;
        room.redTime = saved.redTime != null ? saved.redTime : 900;
        room.blkTime = saved.blkTime != null ? saved.blkTime : 900;
        room.moveHistory = saved.moveHistory || [];
        room.capturedRed = saved.capturedRed || [];
        room.capturedBlack = saved.capturedBlack || [];
        room.createdAt = saved.createdAt;
      }
      
      this.rooms.set(roomId, room);
    }
    return this.rooms.get(roomId);
  }

  handleRoomWebSocket(ws, roomId) {
    const room = this.getOrCreateRoom(roomId);
    const socketData = { color: null, spectator: false, replaced: false };
    let heartbeatTimer = null;
    let heartbeatTimeout = null;

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
        try { ws.send(JSON.stringify({ event: 'ping' })); } catch (e) {}
        heartbeatTimeout = setTimeout(() => {
          try { ws.close(); } catch (e) {}
        }, 60000);
      }, 30000);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
    };

    // 在线计数
    onlineCount++;
    activeConnections.add(ws);
    startHeartbeat();

    const broadcastToRoom = (msg) => {
      for (const ws of room.players.keys()) {
        try { ws.send(msg); } catch (e) {}
      }
      for (const ws of room.spectators) {
        try { ws.send(msg); } catch (e) {}
      }
    };

    const broadcastToPlayers = (msg) => {
      for (const ws of room.players.keys()) {
        try { ws.send(msg); } catch (e) {}
      }
    };

    const broadcastToOpponent = (ws, msg) => {
      for (const [pws, player] of room.players) {
        if (pws !== ws) {
          try { pws.send(msg); } catch (e) {}
        }
      }
    };

    const broadcastToSpectators = (msg) => {
      for (const ws of room.spectators) {
        try { ws.send(msg); } catch (e) {}
      }
    };

    const broadcastRoomState = () => {
      const baseState = getRoomState();
      for (const [ws, player] of room.players) {
        try { ws.send(JSON.stringify({ event: 'room_state', data: { ...baseState, color: player.color } })); } catch (e) {}
      }
      for (const ws of room.spectators) {
        try { ws.send(JSON.stringify({ event: 'room_state', data: baseState })); } catch (e) {}
      }
    };

    const broadcastRoomStateToOpponent = (ws) => {
      const baseState = getRoomState();
      for (const [pws, player] of room.players) {
        if (pws !== ws) {
          try { pws.send(JSON.stringify({ event: 'room_state', data: { ...baseState, color: player.color } })); } catch (e) {}
        }
      }
    };

    const getRoomState = () => ({
      roomId: room.id,
      playerCount: room.players.size,
      currentTurn: room.currentTurn,
      gameOver: room.gameOver,
      winner: room.winner,
      moveHistory: room.moveHistory,
      redTime: room.redTime,
      blkTime: room.blkTime,
      capturedRed: room.capturedRed,
      capturedBlack: room.capturedBlack,
      gameStarted: room.players.size >= 2
    });

    const startRoomTimer = () => {
      if (room._timer) clearInterval(room._timer);
      room._timerLastTick = Date.now();

      room._timer = setInterval(() => {
        if (room.gameOver) {
          clearInterval(room._timer);
          room._timer = null;
          return;
        }
        const now = Date.now();
        const elapsed = Math.max(1, Math.round((now - room._timerLastTick) / 1000));
        room._timerLastTick = now;

        if (room.currentTurn === 'red') {
          room.redTime = Math.max(0, room.redTime - elapsed);
          if (room.redTime <= 0) {
            room.gameOver = true;
            room.winner = 'black';
            clearInterval(room._timer);
            room._timer = null;
            broadcastToRoom(JSON.stringify({ event: 'timeout', data: { winner: 'black' } }));
            broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'black', reason: 'timeout' } }));
            saveRoomState(room.id, getSerializableState());
          }
        } else {
          room.blkTime = Math.max(0, room.blkTime - elapsed);
          if (room.blkTime <= 0) {
            room.gameOver = true;
            room.winner = 'red';
            clearInterval(room._timer);
            room._timer = null;
            broadcastToRoom(JSON.stringify({ event: 'timeout', data: { winner: 'red' } }));
            broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'red', reason: 'timeout' } }));
            saveRoomState(room.id, getSerializableState());
          }
        }
      }, 1000);
    };

    const getSerializableState = () => ({
      currentTurn: room.currentTurn,
      gameOver: room.gameOver,
      winner: room.winner,
      redTime: room.redTime,
      blkTime: room.blkTime,
      moveHistory: room.moveHistory.slice(-200),
      capturedRed: room.capturedRed || [],
      capturedBlack: room.capturedBlack || [],
      createdAt: room.createdAt
    });

    ws.on('message', (event) => {
      try {
        const data = JSON.parse(event.toString());
        const eventName = data.event || data[0];
        const payload = data.payload || data[1];

        if (eventName === 'pong') {
          if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
        } else if (eventName === 'ping') {
          try { ws.send(JSON.stringify({ event: 'pong' })); } catch (e) {}
        } else if (eventName === 'create_room') {
          if (room.players.size > 0) {
            const existingColor = [...room.players.values()][0].color;
            const myColor = existingColor === 'red' ? 'black' : 'red';
            room.players.set(ws, { id: Math.random().toString(36).slice(2), color: myColor });
            socketData.color = myColor;
            ws.send(JSON.stringify({ event: 'room_created', data: { roomId: room.id, color: myColor } }));
          } else {
            const myColor = Math.random() < 0.5 ? 'red' : 'black';
            room.players.set(ws, { id: Math.random().toString(36).slice(2), color: myColor });
            socketData.color = myColor;
            ws.send(JSON.stringify({ event: 'room_created', data: { roomId: room.id, color: myColor } }));
          }
        } else if (eventName === 'join_room') {
          if (room.players.size === 0) {
            ws.send(JSON.stringify({ event: 'error', data: '房间不存在' }));
            return;
          }
          if (room.players.size >= 2) {
            room.spectators.add(ws);
            socketData.spectator = true;
            ws.send(JSON.stringify({ event: 'spectator_joined', data: { roomId: room.id, moveHistory: room.moveHistory } }));
            return;
          }
          let color = [...room.players.values()][0].color === 'red' ? 'black' : 'red';
          room.players.set(ws, { id: Math.random().toString(36).slice(2), color });
          socketData.color = color;
          ws.send(JSON.stringify({ event: 'room_joined', data: { roomId: room.id, color } }));
          broadcastRoomState();
          broadcastToPlayers(JSON.stringify({ event: 'game_start', data: { currentTurn: room.currentTurn } }));
          startRoomTimer();
        } else if (eventName === 'make_move') {
          if (!room || room.gameOver) {
            ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'invalid_state' } }));
            return;
          }
          // 重连过渡期：若游戏已开始（有走棋记录），允许 players.size < 2 时继续走棋，
          // 因为对手的 WS 可能暂时在 onclose→reconnect_room 的间隙中。
          // 若游戏尚未开始（无走棋记录），players.size < 2 说明对手还没加入，拒绝走棋。
          if (room.players.size < 2 && room.moveHistory.length === 0) {
            ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'invalid_state' } }));
            return;
          }
          // 容错：如果 socketData.color 未设置（例如 WS 刚连接但 reconnect_room 还没处理完），
          // 从 players 查找该 WS 对应的颜色
          if (!socketData.color) {
            for (const [pws, player] of room.players) {
              if (pws === ws) {
                socketData.color = player.color;
                break;
              }
            }
          }
          if (!socketData.color) {
            ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'no_color' } }));
            return;
          }
          // 幂等判断：如果该步已在历史末尾，直接回复确认
          const lastMv = room.moveHistory[room.moveHistory.length - 1];
          if (lastMv && lastMv.fromRow === payload.fromRow && lastMv.fromCol === payload.fromCol &&
              lastMv.toRow === payload.toRow && lastMv.toCol === payload.toCol) {
            ws.send(JSON.stringify({ event: 'move_ack', data: { moveHistoryLen: room.moveHistory.length, lastMove: { fromRow: lastMv.fromRow, fromCol: lastMv.fromCol, toRow: lastMv.toRow, toCol: lastMv.toCol }, currentTurn: room.currentTurn } }));
            return;
          }
          // 回合校验
          if (room.currentTurn !== socketData.color) {
            ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'not_your_turn' } }));
            return;
          }
          const move = { ...payload, timestamp: Date.now() };
          room.moveHistory.push(move);
          if (move.captured) {
            if (!room.capturedRed) room.capturedRed = [];
            if (!room.capturedBlack) room.capturedBlack = [];
            if (move.captured.color === 'red') room.capturedRed.push(move.captured);
            else room.capturedBlack.push(move.captured);
          }
          if (move.currentTurn !== undefined) room.currentTurn = move.currentTurn;
          if (move.redLeft !== undefined) room.redTime = move.redLeft;
          if (move.blkLeft !== undefined) room.blkTime = move.blkLeft;
          if (move.gameOver) {
            room.gameOver = true;
            room.winner = move.winner;
            if (room._timer) { clearInterval(room._timer); room._timer = null; }
          }
          const opponentMove = { ...move, redLeft: room.redTime, blkLeft: room.blkTime };
          // 向走棋方发送确认
          ws.send(JSON.stringify({ event: 'move_ack', data: { moveHistoryLen: room.moveHistory.length, lastMove: { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol }, currentTurn: room.currentTurn } }));
          // 向对手发送走棋事件
          broadcastToOpponent(ws, JSON.stringify({ event: 'opponent_move', data: opponentMove }));
          broadcastRoomStateToOpponent(ws);
          broadcastToSpectators(JSON.stringify({ event: 'opponent_move', data: opponentMove }));
          saveRoomState(room.id, getSerializableState());
        } else if (eventName === 'resign') {
          room.gameOver = true;
          room.winner = socketData.color === 'red' ? 'black' : 'red';
          if (room._timer) { clearInterval(room._timer); room._timer = null; }
          broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: room.winner, reason: 'resign' } }));
          saveRoomState(room.id, getSerializableState());
        } else if (eventName === 'request_draw') {
          broadcastToOpponent(ws, JSON.stringify({ event: 'draw_requested', data: { from: socketData.color } }));
        } else if (eventName === 'accept_draw') {
          room.gameOver = true;
          room.winner = 'draw';
          if (room._timer) { clearInterval(room._timer); room._timer = null; }
          broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'draw', reason: 'draw' } }));
          saveRoomState(room.id, getSerializableState());
        } else if (eventName === 'reject_draw') {
          broadcastToOpponent(ws, JSON.stringify({ event: 'draw_rejected', data: {} }));
        } else if (eventName === 'chat') {
          const msg = { from: socketData.color || 'spectator', color: socketData.color, message: payload, timestamp: Date.now() };
          broadcastToRoom(JSON.stringify({ event: 'chat', data: msg }));
        } else if (eventName === 'rematch_request') {
          broadcastToOpponent(ws, JSON.stringify({ event: 'rematch_requested', data: {} }));
        } else if (eventName === 'accept_rematch') {
          if (room.players.size < 2) return;
          // 换先：交换双方颜色，实现红黑轮换交替（上一盘执红者本盘执黑）
          const playerEntries = [...room.players.entries()];
          if (playerEntries.length === 2) {
            const [wsA, dataA] = playerEntries[0];
            const [wsB, dataB] = playerEntries[1];
            const tmpColor = dataA.color;
            dataA.color = dataB.color;
            dataB.color = tmpColor;
          }
          room.gameOver = false;
          room.winner = null;
          room.currentTurn = 'red';
          room.redTime = 900;
          room.blkTime = 900;
          room.moveHistory = [];
          room.capturedRed = [];
          room.capturedBlack = [];
          room.createdAt = Date.now();
          startRoomTimer();
          broadcastToRoom(JSON.stringify({ event: 'rematch_start', data: {} }));
          broadcastRoomState();
          saveRoomState(room.id, getSerializableState());
        } else if (eventName === 'request_undo') {
          if (room.moveHistory.length === 0 || room.gameOver) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'undo_requested', data: {} }));
        } else if (eventName === 'accept_undo') {
          if (room.moveHistory.length === 0) return;
          const lastMove = room.moveHistory.pop();
          room.gameOver = false;
          room.winner = null;
          // 恢复 currentTurn 为走棋前的颜色
          room.currentTurn = lastMove.currentTurn === 'red' ? 'black' : 'red';
          if (lastMove.captured) {
            if (lastMove.captured.color === 'red' && room.capturedRed && room.capturedRed.length > 0) {
              room.capturedRed.pop();
            } else if (lastMove.captured.color === 'black' && room.capturedBlack && room.capturedBlack.length > 0) {
              room.capturedBlack.pop();
            }
          }
          broadcastToOpponent(ws, JSON.stringify({ event: 'undo_accepted', data: {} }));
          broadcastRoomState();
        } else if (eventName === 'reject_undo') {
          broadcastToOpponent(ws, JSON.stringify({ event: 'undo_rejected', data: {} }));
        } else if (eventName === 'reconnect_room') {
          let color = payload?.color;
          if (!color) {
            const existingColors = [...room.players.values()].map(p => p.color);
            if (existingColors.includes('red')) color = 'black';
            else if (existingColors.includes('black')) color = 'red';
            else if (room.disconnected?.red) color = 'red';
            else if (room.disconnected?.black) color = 'black';
          }
          if (!color) {
            ws.send(JSON.stringify({ event: 'error', data: '无法重连' }));
            return;
          }
          if (room.disconnected?.[color]) delete room.disconnected[color];
          if (room._disconnectTimer) { clearTimeout(room._disconnectTimer); room._disconnectTimer = null; }
          for (const [pws, player] of room.players) {
            if (player.color === color && pws !== ws) {
              if (pws._socketData) pws._socketData.replaced = true;
              room.players.delete(pws);
              break;
            }
          }
          room.players.set(ws, { id: Math.random().toString(36).slice(2), color });
          socketData.color = color;
          ws.send(JSON.stringify({
            event: 'room_state', data: {
              roomId: room.id, color,
              moveHistory: room.moveHistory, currentTurn: room.currentTurn,
              gameOver: room.gameOver, winner: room.winner,
              redTime: room.redTime != null ? room.redTime : 900,
              blkTime: room.blkTime != null ? room.blkTime : 900,
              capturedRed: room.capturedRed || [], capturedBlack: room.capturedBlack || [],
              gameStarted: true
            }
          }));
          broadcastRoomState();
          if (!room.gameOver && room.players.size >= 2) startRoomTimer();
          broadcastToOpponent(ws, JSON.stringify({ event: 'player_reconnected', data: { color } }));
        } else if (eventName === 'leave_room') {
          if (socketData.spectator) {
            room.spectators.delete(ws);
            return;
          }
          // 先清理定时器和连接，再销毁房间
          if (room._timer) { clearInterval(room._timer); room._timer = null; }
          if (room._disconnectTimer) { clearTimeout(room._disconnectTimer); room._disconnectTimer = null; }
          // 标记 replaced 防止 onclose 误触发断线逻辑
          socketData.replaced = true;
          room.players.delete(ws);
          for (const [pws] of room.players) {
            try { pws.send(JSON.stringify({ event: 'opponent_left', data: {} })); } catch (e) {}
          }
          room.players.forEach((p, pws) => { try { pws.close(); } catch (e) {} });
          room.spectators.forEach(s => { try { s.close(); } catch (e) {} });
          try { ws.close(); } catch (e) {}
          deleteRoomState(room.id);
          this.rooms.delete(room.id);
          room.disconnected = {};
        }
      } catch (e) {
        console.error('Room WebSocket message error:', e);
      }
    });

    ws.on('close', () => {
      stopHeartbeat();
      onlineCount--;
      activeConnections.delete(ws);

      if (socketData.spectator) {
        room.spectators.delete(ws);
        broadcastOnlineCount();
        return;
      }
      if (!room || !socketData.color) return;
      if (socketData.replaced) return;

      room.players.delete(ws);
      if (room._timer) { clearInterval(room._timer); room._timer = null; }

      // 如果玩家全部离开，立即销毁房间（处理 leave_room + disconnect 的竞态问题）
      if (room.players.size === 0) {
        if (room._disconnectTimer) { clearTimeout(room._disconnectTimer); room._disconnectTimer = null; }
        room.spectators.forEach(s => { try { s.close(); } catch (e) {} });
        room.spectators.clear();
        deleteRoomState(room.id);
        this.rooms.delete(room.id);
        room.disconnected = {};
        broadcastOnlineCount();
        return;
      }

      if (!room.disconnected) room.disconnected = {};
      room.disconnected[socketData.color] = Date.now();
      broadcastToOpponent(ws, JSON.stringify({ event: 'player_disconnected', data: { color: socketData.color } }));
      saveRoomState(room.id, getSerializableState());

      if (!room._disconnectTimer) {
        room._disconnectTimer = setTimeout(() => {
          if (!room || room.gameOver) return;
          const now = Date.now();
          for (const color of ['red', 'black']) {
            if (room.disconnected?.[color] && (now - room.disconnected[color] > 180000)) {
              room.gameOver = true;
              room.winner = color === 'red' ? 'black' : 'red';
              broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: room.winner, reason: 'disconnect_timeout' } }));
              broadcastToRoom(JSON.stringify({ event: 'room_timeout', data: {} }));
              if (room._timer) { clearInterval(room._timer); room._timer = null; }
              saveRoomState(room.id, getSerializableState());
              break;
            }
          }
          room._disconnectTimer = null;
        }, 183000);
      }
      broadcastOnlineCount();
    });

    ws.on('error', stopHeartbeat);
  }

  // 获取房间信息
  getRoomState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      roomId: room.id,
      playerCount: room.players.size,
      exists: true
    };
  }

  getOnlineCount() {
    return onlineCount;
  }
}

module.exports = { ChessRoomManager };