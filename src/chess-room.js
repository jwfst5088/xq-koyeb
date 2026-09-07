const { saveRoomState, loadRoomState, deleteRoomState } = require('./db');

// 与 Cloudflare Worker 版（cf-chess2 / x.meaigo.eu.org）完全一致的裸 WebSocket JSON 协议：
// 客户端消息: {event, payload}；服务端消息: {event, data}
const activeConnections = new Set();
let onlineCount = 0;

const WS_OPEN = 1; // Node ws 库: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3

function genPid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

class ChessRoomManager {
  constructor(db) {
    this.db = db;
    this.rooms = new Map(); // roomId → roomData
    // 定期清理：无玩家无观众超过15分钟的房间（保留DB状态1小时内可用于恢复）
    setInterval(() => this.cleanupRooms(), 60 * 1000).unref();
  }

  cleanupRooms() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      const emptySince = room._emptySince || room.createdAt || now;
      const empty = room.players.size === 0 && (!room.spectators || room.spectators.size === 0);
      if (empty && now - emptySince > 15 * 60 * 1000) {
        if (room._timer) clearInterval(room._timer);
        if (room._disconnectTimer) clearTimeout(room._disconnectTimer);
        this.rooms.delete(roomId);
        console.log(`[清理] 空房间 ${roomId} 已回收`);
      }
    }
  }

  // ============ 连接计数（大厅 + 房间统一计数） ============
  addConnection(ws) {
    onlineCount++;
    activeConnections.add(ws);
    this.broadcastOnlineCount();
  }

  removeConnection(ws) {
    if (activeConnections.has(ws)) {
      onlineCount--;
      activeConnections.delete(ws);
      this.broadcastOnlineCount();
    }
  }

  broadcastOnlineCount() {
    const msg = JSON.stringify({ event: 'online_count', data: onlineCount });
    for (const ws of activeConnections) {
      try { ws.send(msg); } catch (e) {}
    }
  }

  getOnlineCount() {
    return onlineCount;
  }

  // ============ 大厅连接（/ws 不带 roomId） ============
  handleLobbyWebSocket(ws) {
    this.addConnection(ws);
    try { ws.send(JSON.stringify({ event: 'online_count', data: onlineCount })); } catch (e) {}

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const eventName = data.event || data[0];
        const payload = data.payload || data[1];
        if (eventName === 'ping') {
          try { ws.send(JSON.stringify({ event: 'pong' })); } catch (e) {}
        } else if (eventName === 'pong') {
          // 客户端对服务端 ping 的回应，无需处理
        } else if (eventName === 'create_room') {
          let lastColor = null;
          let requestedRoomId = null;
          if (payload && typeof payload === 'object') {
            requestedRoomId = payload.roomId;
            lastColor = payload.lastColor;
          } else {
            requestedRoomId = payload;
          }
          const roomId = requestedRoomId || genRoomId();
          ws.send(JSON.stringify({ event: 'redirect_room', data: { roomId, action: 'create', lastColor } }));
        } else if (eventName === 'join_room') {
          const roomId = payload;
          ws.send(JSON.stringify({ event: 'redirect_room', data: { roomId, action: 'join' } }));
        } else if (eventName === 'reconnect_room') {
          const roomId = payload && payload.roomId;
          if (!roomId) return;
          ws.send(JSON.stringify({ event: 'redirect_room', data: { roomId, action: 'reconnect', color: payload.color } }));
        }
      } catch (e) {
        console.error('Lobby WebSocket message error:', e);
      }
    });

    ws.on('close', () => this.removeConnection(ws));
    ws.on('error', () => {});
  }

  // ============ 房间连接（/ws?roomId=xxx） ============
  getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
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
        playerTokens: null,
        gameStarted: false,
        createdAt: Date.now(),
        _timer: null,
        _timerLastTick: null,
        _disconnectTimer: null,
        disconnected: {},
        _emptySince: Date.now(),
      };

      // 从数据库恢复（1小时内有效，与 Worker 版一致）
      try {
        const saved = loadRoomState(this.db, roomId);
        if (saved && saved.createdAt && (Date.now() - saved.createdAt < 36e5)) {
          room.currentTurn = saved.currentTurn || 'red';
          room.gameOver = saved.gameOver || false;
          room.winner = saved.winner || null;
          room.redTime = saved.redTime != null ? saved.redTime : 900;
          room.blkTime = saved.blkTime != null ? saved.blkTime : 900;
          room.moveHistory = saved.moveHistory || [];
          room.capturedRed = saved.capturedRed || [];
          room.capturedBlack = saved.capturedBlack || [];
          room.createdAt = saved.createdAt;
          room.playerTokens = saved.playerTokens || null;
          room.gameStarted = !!saved.gameStarted;
          room._restoredFromDb = true;
        }
      } catch (e) {}

      this.rooms.set(roomId, room);
    }
    const room = this.rooms.get(roomId);
    return room;
  }

  getSerializableState(room) {
    return {
      currentTurn: room.currentTurn,
      gameOver: room.gameOver,
      winner: room.winner,
      redTime: room.redTime,
      blkTime: room.blkTime,
      moveHistory: room.moveHistory.slice(-200),
      capturedRed: room.capturedRed || [],
      capturedBlack: room.capturedBlack || [],
      playerTokens: room.playerTokens || null,
      gameStarted: !!room.gameStarted,
      createdAt: room.createdAt,
    };
  }

  saveRoom(room) {
    if (room._destroyed) return;
    try { saveRoomState(this.db, room.id, this.getSerializableState(room)); } catch (e) {}
  }

  // 清扫僵尸座位：已关闭/半关闭/已被替换的旧连接不再占用颜色
  sweepZombies(room) {
    for (const [pws, p] of [...room.players]) {
      const dead = pws.readyState !== WS_OPEN;
      const rep = pws._socketData && pws._socketData.replaced;
      if (dead || rep) room.players.delete(pws);
    }
  }

  handleRoomWebSocket(ws, roomId) {
    const room = this.getOrCreateRoom(roomId);
    const socketData = { color: null, spectator: false, replaced: false };
    ws._socketData = socketData;
    ws._lastSeen = Date.now();
    this.addConnection(ws);

    // 若房间刚刚重新变空，记录时间供清理使用
    if (room.players.size === 0 && room.spectators.size === 0) room._emptySince = Date.now();

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

    startHeartbeat();

    const broadcastToRoom = (msg) => {
      for (const pws of room.players.keys()) {
        try { pws.send(msg); } catch (e) {}
      }
      for (const sws of room.spectators) {
        try { sws.send(msg); } catch (e) {}
      }
    };

    const broadcastToPlayers = (msg) => {
      for (const pws of room.players.keys()) {
        try { pws.send(msg); } catch (e) {}
      }
    };

    const broadcastToSpectators = (msg) => {
      for (const sws of room.spectators) {
        try { sws.send(msg); } catch (e) {}
      }
    };

    const broadcastToOpponent = (self, msg) => {
      for (const [pws, player] of room.players) {
        if (pws !== self) {
          try { pws.send(msg); } catch (e) {}
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
      gameStarted: room.players.size >= 2,
    });

    const broadcastRoomState = () => {
      const baseState = getRoomState();
      for (const [pws, player] of room.players) {
        try { pws.send(JSON.stringify({ event: 'room_state', data: { ...baseState, color: player.color } })); } catch (e) {}
      }
      for (const sws of room.spectators) {
        try { sws.send(JSON.stringify({ event: 'room_state', data: baseState })); } catch (e) {}
      }
    };

    const broadcastRoomStateToOpponent = (self) => {
      const baseState = getRoomState();
      for (const [pws, player] of room.players) {
        if (pws !== self) {
          try { pws.send(JSON.stringify({ event: 'room_state', data: { ...baseState, color: player.color } })); } catch (e) {}
        }
      }
    };

    const startRoomTimer = () => {
      if (room._timer) clearInterval(room._timer);
      room._timerLastTick = Date.now();
      room._timer = setInterval(() => {
        if (!this.rooms.has(room.id)) { clearInterval(room._timer); room._timer = null; return; }
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
            room._gameEndedAt = Date.now();
            clearInterval(room._timer);
            room._timer = null;
            broadcastToRoom(JSON.stringify({ event: 'timeout', data: { winner: 'black' } }));
            broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'black', reason: 'timeout' } }));
            this.saveRoom(room);
          }
        } else {
          room.blkTime = Math.max(0, room.blkTime - elapsed);
          if (room.blkTime <= 0) {
            room.gameOver = true;
            room.winner = 'red';
            room._gameEndedAt = Date.now();
            clearInterval(room._timer);
            room._timer = null;
            broadcastToRoom(JSON.stringify({ event: 'timeout', data: { winner: 'red' } }));
            broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'red', reason: 'timeout' } }));
            this.saveRoom(room);
          }
        }
      }, 1000);
    };

    ws.on('message', (raw) => {
      try {
        ws._lastSeen = Date.now();
        const data = JSON.parse(raw.toString());
        const eventName = data.event || data[0];
        const payload = data.payload || data[1];

        if (eventName === 'pong') {
          if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
        } else if (eventName === 'ping') {
          try { ws.send(JSON.stringify({ event: 'pong' })); } catch (e) {}
        } else if (eventName === 'create_room') {
          this.sweepZombies(room);
          let lastColor = null;
          if (payload && typeof payload === 'object' && payload.lastColor) {
            lastColor = payload.lastColor;
          }
          if (room.players.size > 0) {
            let existingColor = [...room.players.values()][0].color;
            let myColor = existingColor === 'red' ? 'black' : 'red';
            // 最终保险：若目标颜色仍被其他存活连接占用（半开僵尸未被清扫），则取反色；双方都被占则拒绝
            const takenByLive = [...room.players.entries()].some(([pws2, p2]) => p2.color === myColor && pws2 !== ws && !(pws2._socketData && pws2._socketData.replaced));
            if (takenByLive) myColor = myColor === 'red' ? 'black' : 'red';
            const stillTaken = [...room.players.values()].some((p2) => p2.color === myColor);
            if (stillTaken) {
              try { ws.send(JSON.stringify({ event: 'error', data: '房间已满' })); } catch (e) {}
              return;
            }
            const myPid = genPid();
            if (!room.playerTokens) room.playerTokens = {};
            room.playerTokens[myColor] = myPid;
            room.players.set(ws, { id: Math.random().toString(36).slice(2), color: myColor, assignedAt: Date.now() });
            socketData.color = myColor;
            try { ws.send(JSON.stringify({ event: 'room_created', data: { roomId: room.id, color: myColor, pid: myPid } })); } catch (e) {}
          } else {
            let myColor;
            if (lastColor === 'red') {
              myColor = 'black';
            } else if (lastColor === 'black') {
              myColor = 'red';
            } else {
              myColor = Math.random() < 0.5 ? 'red' : 'black';
            }
            const myPid = genPid();
            if (!room.playerTokens) room.playerTokens = {};
            room.playerTokens[myColor] = myPid;
            room.players.set(ws, { id: Math.random().toString(36).slice(2), color: myColor, assignedAt: Date.now() });
            socketData.color = myColor;
            try { ws.send(JSON.stringify({ event: 'room_created', data: { roomId: room.id, color: myColor, pid: myPid } })); } catch (e) {}
          }
          room._emptySince = null;
        } else if (eventName === 'join_room') {
          this.sweepZombies(room);
          if (room.players.size === 0) {
            try { ws.send(JSON.stringify({ event: 'error', data: '房间不存在' })); } catch (e) {}
            return;
          }
          if (room.players.size >= 2) {
            room.spectators.add(ws);
            socketData.spectator = true;
            try { ws.send(JSON.stringify({ event: 'spectator_joined', data: { roomId: room.id, moveHistory: room.moveHistory } })); } catch (e) {}
            return;
          }
          let color = [...room.players.values()][0].color === 'red' ? 'black' : 'red';
          const joinPid = genPid();
          if (!room.playerTokens) room.playerTokens = {};
          room.playerTokens[color] = joinPid;
          room.players.set(ws, { id: Math.random().toString(36).slice(2), color, assignedAt: Date.now() });
          socketData.color = color;
          if (room.players.size >= 2) room.gameStarted = true;
          try { ws.send(JSON.stringify({ event: 'room_joined', data: { roomId: room.id, color, pid: joinPid } })); } catch (e) {}
          broadcastRoomState();
          broadcastToPlayers(JSON.stringify({ event: 'game_start', data: { currentTurn: room.currentTurn } }));
          startRoomTimer();
          room._emptySince = null;
        } else if (eventName === 'make_move') {
          if (!room || room.gameOver) {
            try { ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'invalid_state' } })); } catch (e) {}
            return;
          }
          if (room.players.size < 2 && room.moveHistory.length === 0 && !room.gameStarted) {
            try { ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'invalid_state' } })); } catch (e) {}
            return;
          }
          if (!socketData.color) {
            for (const [pws, player] of room.players) {
              if (pws === ws) {
                socketData.color = player.color;
                break;
              }
            }
          }
          if (!socketData.color) {
            try { ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'no_color' } })); } catch (e) {}
            return;
          }
          const lastMv = room.moveHistory[room.moveHistory.length - 1];
          if (lastMv && payload && lastMv.fromRow === payload.fromRow && lastMv.fromCol === payload.fromCol && lastMv.toRow === payload.toRow && lastMv.toCol === payload.toCol) {
            try {
              ws.send(JSON.stringify({ event: 'move_ack', data: { moveHistoryLen: room.moveHistory.length, lastMove: { fromRow: lastMv.fromRow, fromCol: lastMv.fromCol, toRow: lastMv.toRow, toCol: lastMv.toCol }, currentTurn: room.currentTurn } }));
            } catch (e) {}
            return;
          }
          if (room.currentTurn !== socketData.color) {
            try { ws.send(JSON.stringify({ event: 'move_rejected', data: { reason: 'not_your_turn' } })); } catch (e) {}
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
          room.currentTurn = socketData.color === 'red' ? 'black' : 'red';
          if (move.redLeft !== undefined) room.redTime = move.redLeft;
          if (move.blkLeft !== undefined) room.blkTime = move.blkLeft;
          if (move.gameOver) {
            room.gameOver = true;
            room._gameEndedAt = Date.now();
            room.winner = move.winner;
            if (room._timer) {
              clearInterval(room._timer);
              room._timer = null;
            }
          }
          const opponentMove = { ...move, redLeft: room.redTime, blkLeft: room.blkTime };
          const ackData = { moveHistoryLen: room.moveHistory.length, lastMove: { fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol }, currentTurn: room.currentTurn };
          try {
            ws.send(JSON.stringify({ event: 'move_ack', data: ackData }));
          } catch (e) {}
          broadcastToOpponent(ws, JSON.stringify({ event: 'opponent_move', data: opponentMove }));
          broadcastRoomStateToOpponent(ws);
          broadcastToSpectators(JSON.stringify({ event: 'opponent_move', data: opponentMove }));
          this.saveRoom(room);
        } else if (eventName === 'resign') {
          if (!room) return;
          room.gameOver = true;
          room._gameEndedAt = Date.now();
          room.winner = socketData.color === 'red' ? 'black' : 'red';
          if (room._timer) {
            clearInterval(room._timer);
            room._timer = null;
          }
          broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: room.winner, reason: 'resign' } }));
          this.saveRoom(room);
        } else if (eventName === 'request_draw') {
          if (!room) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'draw_requested', data: { from: socketData.color } }));
        } else if (eventName === 'accept_draw') {
          if (!room) return;
          room.gameOver = true;
          room._gameEndedAt = Date.now();
          room.winner = 'draw';
          if (room._timer) {
            clearInterval(room._timer);
            room._timer = null;
          }
          broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: 'draw', reason: 'draw' } }));
          this.saveRoom(room);
        } else if (eventName === 'reject_draw') {
          if (!room) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'draw_rejected', data: {} }));
        } else if (eventName === 'chat') {
          if (!room) return;
          const msg = { from: socketData.color || 'spectator', color: socketData.color, message: payload, timestamp: Date.now() };
          broadcastToRoom(JSON.stringify({ event: 'chat', data: msg }));
        } else if (eventName === 'rematch_request') {
          if (!room || room.players.size < 2) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'rematch_requested', data: {} }));
        } else if (eventName === 'accept_rematch') {
          if (!room || room.players.size < 2) return;
          const playerEntries = [...room.players.entries()];
          if (playerEntries.length === 2) {
            const [wsA, dataA] = playerEntries[0];
            const [wsB, dataB] = playerEntries[1];
            const tmpColor = dataA.color;
            dataA.color = dataB.color;
            dataB.color = tmpColor;
            if (wsA._socketData) wsA._socketData.color = dataA.color;
            if (wsB._socketData) wsB._socketData.color = dataB.color;
          }
          if (room.playerTokens && room.playerTokens.red && room.playerTokens.black) {
            const tmpTok = room.playerTokens.red;
            room.playerTokens.red = room.playerTokens.black;
            room.playerTokens.black = tmpTok;
          }
          room.gameOver = false;
          room._gameEndedAt = null;
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
          this.saveRoom(room);
        } else if (eventName === 'request_undo') {
          if (!room || room.moveHistory.length === 0 || room.gameOver) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'undo_requested', data: {} }));
        } else if (eventName === 'accept_undo') {
          if (!room || room.moveHistory.length === 0) return;
          const lastMove = room.moveHistory.pop();
          room.gameOver = false;
          room.winner = null;
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
          this.saveRoom(room);
        } else if (eventName === 'reject_undo') {
          if (!room) return;
          broadcastToOpponent(ws, JSON.stringify({ event: 'undo_rejected', data: {} }));
        } else if (eventName === 'reconnect_room') {
          // 座位仲裁（与 Worker 版一致）：pid 匹配 > 持有者已死/被替换 > 持有者闲置>25s > 旧主人回归
          const otherEntries = [...room.players.entries()].filter(([pws]) => pws !== ws);
          const isReplaceable = (c) => otherEntries.some(([pws, p]) => p.color === c && (pws.readyState !== WS_OPEN || (room.disconnected && room.disconnected[c])));
          const isFree = (c) => !otherEntries.some(([, p]) => p.color === c);
          if (payload && payload.pid && room.playerTokens) {
            const tokColor = room.playerTokens.red === payload.pid ? 'red' : room.playerTokens.black === payload.pid ? 'black' : null;
            if (tokColor) {
              payload.color = tokColor;
            }
          }
          let color = payload && payload.color;
          if (color) {
            if (!isFree(color)) {
              const sameColorEntry = otherEntries.find(([, p]) => p.color === color);
              if (sameColorEntry) {
                const [hws, seat] = sameColorEntry;
                const pidMatches = !!(payload && payload.pid && room.playerTokens && room.playerTokens[color] === payload.pid);
                const holderDead = hws.readyState !== WS_OPEN || (hws._socketData && hws._socketData.replaced);
                const holderIdle = !hws._lastSeen || Date.now() - hws._lastSeen > 25000;
                const preDiscSeat = !!(room.disconnected && room.disconnected[color] && seat.assignedAt && room.disconnected[color] > seat.assignedAt);
                if (!pidMatches && !holderDead && !holderIdle && !preDiscSeat) {
                  const alt = color === 'red' ? 'black' : 'red';
                  if (isFree(alt) || isReplaceable(alt)) {
                    color = alt;
                  } else {
                    try { ws.send(JSON.stringify({ event: 'error', data: '房间已满，无法重连' })); } catch (e) {}
                    try { ws.close(); } catch (e) {}
                    return;
                  }
                }
              } else {
                const alt = color === 'red' ? 'black' : 'red';
                if (isFree(alt) || isReplaceable(alt)) {
                  color = alt;
                } else {
                  try { ws.send(JSON.stringify({ event: 'error', data: '房间已满，无法重连' })); } catch (e) {}
                  try { ws.close(); } catch (e) {}
                  return;
                }
              }
            }
          }
          if (!color) {
            const existingColors = [...room.players.values()].map((p) => p.color);
            if (existingColors.includes('red')) color = 'black';
            else if (existingColors.includes('black')) color = 'red';
            else if (room.disconnected && room.disconnected.red) color = 'red';
            else if (room.disconnected && room.disconnected.black) color = 'black';
          }
          if (!color) {
            try { ws.send(JSON.stringify({ event: 'error', data: '无法重连' })); } catch (e) {}
            return;
          }
          if (room.disconnected && room.disconnected[color]) delete room.disconnected[color];
          if (room._disconnectTimer) {
            clearTimeout(room._disconnectTimer);
            room._disconnectTimer = null;
          }
          // 身份自愈：若来者 pid 与该座位令牌不符，接管座位时轮换令牌并在 room_state 中下发新 pid
          let rotatedPid = null;
          const pidMatches = !!(payload && payload.pid && room.playerTokens && room.playerTokens[color] === payload.pid);
          if (!pidMatches) {
            rotatedPid = genPid();
            if (!room.playerTokens) room.playerTokens = {};
            room.playerTokens[color] = rotatedPid;
          }
          for (const [pws, player] of room.players) {
            if (player.color === color && pws !== ws) {
              if (pws._socketData) pws._socketData.replaced = true;
              room.players.delete(pws);
              break;
            }
          }
          room.players.set(ws, { id: Math.random().toString(36).slice(2), color, assignedAt: Date.now() });
          socketData.color = color;
          if (room.players.size >= 2) room.gameStarted = true;
          const gameInProgress = !room.gameOver && room.moveHistory.length > 0;
          try {
            ws.send(JSON.stringify({ event: 'room_state', data: {
              roomId: room.id,
              color,
              moveHistory: room.moveHistory,
              currentTurn: room.currentTurn,
              gameOver: room.gameOver,
              winner: room.winner,
              redTime: room.redTime,
              blkTime: room.blkTime,
              capturedRed: room.capturedRed,
              capturedBlack: room.capturedBlack,
              gameStarted: true,
              pid: rotatedPid || (payload && payload.pid) || undefined,
            } }));
          } catch (e) {}
          broadcastRoomState();
          if (!room.gameOver && room.players.size >= 2) {
            startRoomTimer();
          }
          broadcastToOpponent(ws, JSON.stringify({ event: 'player_reconnected', data: { color } }));
          room._emptySince = null;
        } else if (eventName === 'leave_room') {
          if (!room) return;
          if (socketData.spectator) {
            room.spectators.delete(ws);
            return;
          }
          if (room._timer) {
            clearInterval(room._timer);
            room._timer = null;
          }
          if (room._disconnectTimer) {
            clearTimeout(room._disconnectTimer);
            room._disconnectTimer = null;
          }
          socketData.replaced = true;
          room.players.delete(ws);
          for (const [pws] of room.players) {
            try { pws.send(JSON.stringify({ event: 'opponent_left', data: {} })); } catch (e) {}
          }
          for (const [pws] of room.players) {
            try { pws.close(); } catch (e) {}
          }
          for (const sws of room.spectators) {
            try { sws.close(); } catch (e) {}
          }
          try { ws.close(); } catch (e) {}
          try { deleteRoomState(this.db, room.id); } catch (e) {}
          room._destroyed = true; // 与 Worker 版一致：销毁后禁止 close 事件再次保存状态（否则旧盘面会复活）
          this.rooms.delete(room.id);
          room.disconnected = {};
        }
      } catch (e) {
        console.error('Room WebSocket message error:', e);
      }
    });

    ws.on('close', () => {
      stopHeartbeat();
      this.removeConnection(ws);

      // 房间已被 leave_room 销毁：与 Worker 版 if (!this.room) return 语义一致，禁止复活状态
      if (room._destroyed) return;

      if (socketData.spectator) {
        room.spectators.delete(ws);
        return;
      }
      if (!room || !socketData.color) return;
      if (socketData.replaced) return;

      room.players.delete(ws);
      if (room._timer) {
        clearInterval(room._timer);
        room._timer = null;
      }

      if (room.players.size === 0 && room.spectators.size === 0) {
        room._emptySince = Date.now();
      }

      room.disconnected[socketData.color] = Date.now();
      broadcastToOpponent(ws, JSON.stringify({ event: 'player_disconnected', data: { color: socketData.color } }));
      this.saveRoom(room);

      if (!room._disconnectTimer) {
        room._disconnectTimer = setTimeout(() => {
          if (!room || room._destroyed || room.gameOver) return;
          const now = Date.now();
          for (const color of ['red', 'black']) {
            if (room.disconnected[color] && now - room.disconnected[color] > 18e4) {
              room.gameOver = true;
              room._gameEndedAt = now;
              room.winner = color === 'red' ? 'black' : 'red';
              broadcastToRoom(JSON.stringify({ event: 'game_over', data: { winner: room.winner, reason: 'disconnect_timeout' } }));
              broadcastToRoom(JSON.stringify({ event: 'room_timeout', data: {} }));
              if (room._timer) {
                clearInterval(room._timer);
                room._timer = null;
              }
              this.saveRoom(room);
              break;
            }
          }
          room._disconnectTimer = null;
        }, 183e3);
      }
    });

    ws.on('error', () => {
      stopHeartbeat();
    });
  }
}

module.exports = { ChessRoomManager };
