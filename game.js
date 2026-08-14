const PIECE_NAMES = {
  king: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '馬', black: '馬' },
  rook: { red: '車', black: '車' },
  cannon: { red: '炮', black: '砲' },
  pawn: { red: '兵', black: '卒' },
};

const PIECE_VALUES = {
  king: 10000, rook: 600, cannon: 300, horse: 300,
  elephant: 120, advisor: 120, pawn: 30,
};

let socket = null;
let socketConnected = false;
const engine = new ChessEngine();

let gameMode = 'local';
let myColor = null;
let myRoomId = null;
let gameStarted = false;
let selectedPiece = null;
let validMoves = [];
let capturedRed = [];
let capturedBlack = [];
let timerInterval = null;
let gameSeconds = 0;
let boardScale = 1;
let boardOffsetX = 0;
let boardOffsetY = 0;
let cellSize = 0;
let padding = 0;

const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const boardCanvas = document.getElementById('board-canvas');
const piecesLayer = document.getElementById('pieces-layer');
const highlightsLayer = document.getElementById('highlights-layer');
const messageToast = document.getElementById('message-toast');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');
const connStatus = document.getElementById('connection-status');

let toastTimer = null;

function showToast(msg, duration = 2000) {
  messageToast.textContent = msg;
  messageToast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => messageToast.classList.remove('show'), duration);
}

function showOverlay(html) {
  overlayContent.innerHTML = html;
  overlay.style.display = 'flex';
}

function hideOverlay() {
  overlay.style.display = 'none';
}

function switchScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (screen === 'lobby') {
    lobbyScreen.classList.add('active');
  } else {
    gameScreen.classList.add('active');
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function startTimer() {
  stopTimer();
  gameSeconds = 0;
  document.getElementById('game-timer').textContent = '00:00';
  timerInterval = setInterval(() => {
    gameSeconds++;
    document.getElementById('game-timer').textContent = formatTime(gameSeconds);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function drawBoard() {
  const canvas = boardCanvas;
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('board-container');
  const rect = container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * (window.devicePixelRatio || 1);
  canvas.height = h * (window.devicePixelRatio || 1);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  padding = w * 0.06;
  const boardW = w - padding * 2;
  const boardH = h - padding * 2;
  cellSize = boardW / 8;

  boardScale = cellSize;
  boardOffsetX = padding;
  boardOffsetY = padding;

  ctx.fillStyle = '#e8c97a';
  ctx.fillRect(padding - cellSize * 0.15, padding - cellSize * 0.15,
    boardW + cellSize * 0.3, boardH + cellSize * 0.3);

  ctx.fillStyle = '#d4a056';
  ctx.fillRect(padding, padding, boardW, boardH);

  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 1.2;

  for (let row = 0; row < 10; row++) {
    const y = padding + row * (boardH / 9);
    if (row === 0 || row === 9) {
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + boardW, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + boardW / 2, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding + boardW / 2, y);
      ctx.lineTo(padding + boardW, y);
      ctx.stroke();
    }
  }

  for (let col = 0; col < 9; col++) {
    const x = padding + col * (boardW / 8);
    if (col === 0 || col === 8) {
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, padding + boardH);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, padding + boardH * 4 / 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, padding + boardH * 5 / 9);
      ctx.lineTo(x, padding + boardH);
      ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.moveTo(padding + boardW * 3 / 8, padding);
  ctx.lineTo(padding + boardW * 5 / 8, padding + boardH * 2 / 9);
  ctx.moveTo(padding + boardW * 5 / 8, padding);
  ctx.lineTo(padding + boardW * 3 / 8, padding + boardH * 2 / 9);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(padding + boardW * 3 / 8, padding + boardH * 7 / 9);
  ctx.lineTo(padding + boardW * 5 / 8, padding + boardH);
  ctx.moveTo(padding + boardW * 5 / 8, padding + boardH * 7 / 9);
  ctx.lineTo(padding + boardW * 3 / 8, padding + boardH);
  ctx.stroke();

  ctx.font = `bold ${cellSize * 0.28}px "KaiTi", "STKaiti", "楷体", "PingFang SC", serif`;
  ctx.fillStyle = '#5a3a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('楚  河', padding + boardW / 2, padding + boardH * 8.5 / 18);
  ctx.fillText('汉  界', padding + boardW / 2, padding + boardH * 9.5 / 18);
}

function getBoardPos(row, col) {
  const boardW = cellSize * 8;
  const boardH = cellSize * 9;
  const x = boardOffsetX + col * (boardW / 8);
  const y = boardOffsetY + row * (boardH / 9);
  return { x, y };
}

function renderPieces() {
  piecesLayer.innerHTML = '';
  const board = engine.board;

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (!piece) continue;

      const { x, y } = getBoardPos(row, col);
      const size = cellSize * 0.84;
      const fontSize = cellSize * 0.4;

      const el = document.createElement('div');
      el.className = `piece-element ${piece.color}-piece`;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.fontSize = fontSize + 'px';
      el.style.lineHeight = size + 'px';
      el.style.top = y + 'px';
      el.style.left = x + 'px';
      el.textContent = PIECE_NAMES[piece.type][piece.color];
      el.dataset.row = row;
      el.dataset.col = col;

      if (selectedPiece && selectedPiece.row === row && selectedPiece.col === col) {
        el.classList.add('selected');
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPieceClick(row, col);
      });

      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPieceClick(row, col);
      });

      piecesLayer.appendChild(el);
    }
  }
}

function renderHighlights() {
  highlightsLayer.innerHTML = '';

  for (const move of validMoves) {
    const { x, y } = getBoardPos(move.row, move.col);
    const dot = document.createElement('div');
    const targetPiece = engine.getPiece(move.row, move.col);

    if (targetPiece) {
      const size = cellSize * 0.84;
      dot.className = 'highlight-dot capture-hint';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.top = y + 'px';
      dot.style.left = x + 'px';
    } else {
      const size = cellSize * 0.22;
      dot.className = 'highlight-dot move-hint';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.top = y + 'px';
      dot.style.left = x + 'px';
    }

    highlightsLayer.appendChild(dot);
  }

  if (selectedPiece) {
    const { x, y } = getBoardPos(selectedPiece.row, selectedPiece.col);
    const dot = document.createElement('div');
    const size = cellSize * 0.84;
    dot.className = 'highlight-dot';
    dot.style.width = size + 'px';
    dot.style.height = size + 'px';
    dot.style.top = y + 'px';
    dot.style.left = x + 'px';
    dot.style.background = 'rgba(241,196,15,0.3)';
    dot.style.borderRadius = '50%';
    dot.style.boxShadow = '0 0 12px rgba(241,196,15,0.5)';
    highlightsLayer.appendChild(dot);
  }

  if (engine.moveHistory.length > 0) {
    const lastMove = engine.moveHistory[engine.moveHistory.length - 1];
    for (const pos of [{ row: lastMove.fromRow, col: lastMove.fromCol }, { row: lastMove.toRow, col: lastMove.toCol }]) {
      const { x, y } = getBoardPos(pos.row, pos.col);
      const dot = document.createElement('div');
      const size = cellSize * 0.84;
      dot.className = 'highlight-dot last-move';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.top = y + 'px';
      dot.style.left = x + 'px';
      highlightsLayer.appendChild(dot);
    }
  }
}

function onPieceClick(row, col) {
  if (!gameStarted || engine.gameOver) return;

  const piece = engine.getPiece(row, col);
  const clickableColor = (gameMode === 'local') ? engine.currentTurn : myColor;

  if (piece && piece.color === clickableColor && piece.color === engine.currentTurn) {
    if (selectedPiece && selectedPiece.row === row && selectedPiece.col === col) {
      selectedPiece = null;
      validMoves = [];
    } else {
      selectedPiece = { row, col };
      validMoves = engine.getLegalMoves(row, col);
    }
  } else if (selectedPiece && validMoves.some(m => m.row === row && m.col === col)) {
    makeMove(selectedPiece.row, selectedPiece.col, row, col);
    return;
  } else if (piece && piece.color !== clickableColor) {
    selectedPiece = null;
    validMoves = [];
  }

  renderAll();
}

function makeMove(fromRow, fromCol, toRow, toCol) {
  const result = engine.move(fromRow, fromCol, toRow, toCol);
  if (!result) return;

  if (result.captured) {
    if (result.captured.color === 'red') {
      capturedRed.push(result.captured);
    } else {
      capturedBlack.push(result.captured);
    }
    updateCaptured();
  }

  selectedPiece = null;
  validMoves = [];
  renderAll();
  updateTurnIndicator();

  if (gameMode === 'online' && socketConnected) {
    socket.emit('make_move', {
      fromRow, fromCol, toRow, toCol,
      captured: result.captured,
      currentTurn: engine.currentTurn,
      gameOver: engine.gameOver,
      winner: engine.winner,
    });
  }

  if (engine.gameOver) {
    onGameEnd(engine.winner);
  }

  if (result.check) {
    showToast('将军!', 1500);
  }
}

function onGameEnd(winner) {
  stopTimer();
  updateTurnIndicator();

  if (winner === 'draw') {
    showOverlay(`
      <h2>🤝 和棋</h2>
      <p>双方握手言和</p>
      <div class="overlay-actions">
        <button class="btn btn-primary btn-sm" onclick="startNewGame()">新游戏</button>
        <button class="btn btn-secondary btn-sm" onclick="hideOverlay()">关闭</button>
      </div>
    `);
    return;
  }

  const winnerText = winner === 'red' ? '红方' : '黑方';
  const isWin = (gameMode === 'local') ? false : (winner === myColor);

  showOverlay(`
    <h2>🏆 ${winnerText}获胜!</h2>
    <p>恭喜${winnerText}!</p>
    <div class="overlay-actions">
      <button class="btn btn-primary btn-sm" onclick="startNewGame()">新游戏</button>
      <button class="btn btn-secondary btn-sm" onclick="hideOverlay()">关闭</button>
    </div>
  `);
}

function updateTurnIndicator() {
  const turnDot = document.querySelector('.turn-dot');
  const turnText = document.getElementById('turn-text');
  const redStatus = document.getElementById('red-status');
  const blackStatus = document.getElementById('black-status');

  if (engine.gameOver) {
    turnText.textContent = '对局结束';
    redStatus.classList.remove('active-turn');
    blackStatus.classList.remove('active-turn');
    if (engine.winner === 'draw') {
      redStatus.textContent = '和棋';
      blackStatus.textContent = '和棋';
    } else {
      redStatus.textContent = engine.winner === 'red' ? '胜利!' : '失败';
      blackStatus.textContent = engine.winner === 'black' ? '胜利!' : '失败';
    }
    return;
  }

  turnDot.className = 'turn-dot ' + (engine.currentTurn === 'red' ? 'red-turn' : 'black-turn');
  turnText.textContent = engine.currentTurn === 'red' ? '红方走棋' : '黑方走棋';

  if (gameMode === 'local') {
    redStatus.textContent = '红方';
    blackStatus.textContent = '黑方';
  } else if (gameMode === 'online') {
    redStatus.textContent = myColor === 'red' ? '你 (红方)' : '对手';
    blackStatus.textContent = myColor === 'black' ? '你 (黑方)' : '对手';
  }

  redStatus.classList.toggle('active-turn', engine.currentTurn === 'red');
  blackStatus.classList.toggle('active-turn', engine.currentTurn === 'black');

  document.getElementById('red-name').textContent = gameMode === 'local' ? '红方' : (myColor === 'red' ? '你 (红方)' : '对手 (红方)');
  document.getElementById('black-name').textContent = gameMode === 'local' ? '黑方' : (myColor === 'black' ? '你 (黑方)' : '对手 (黑方)');
}

function updateCaptured() {
  const sortPieces = (pieces) => {
    return [...pieces].sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);
  };

  const blackDiv = document.getElementById('captured-black');
  const redDiv = document.getElementById('captured-red');

  blackDiv.innerHTML = '<span class="captured-label">被吃:</span>';
  for (const p of sortPieces(capturedBlack)) {
    const span = document.createElement('span');
    span.className = 'captured-piece black-captured';
    span.textContent = PIECE_NAMES[p.type][p.color];
    blackDiv.appendChild(span);
  }

  redDiv.innerHTML = '<span class="captured-label">被吃:</span>';
  for (const p of sortPieces(capturedRed)) {
    const span = document.createElement('span');
    span.className = 'captured-piece red-captured';
    span.textContent = PIECE_NAMES[p.type][p.color];
    redDiv.appendChild(span);
  }
}

function renderAll() {
  renderPieces();
  renderHighlights();
}

function resizeBoard() {
  if (gameScreen.classList.contains('active')) {
    drawBoard();
    renderAll();
  }
}

function startNewGame() {
  hideOverlay();
  engine.initBoard();
  engine.currentTurn = 'red';
  engine.gameOver = false;
  engine.winner = null;
  engine.moveHistory = [];
  capturedRed = [];
  capturedBlack = [];
  selectedPiece = null;
  validMoves = [];
  gameStarted = true;

  updateCaptured();
  updateTurnIndicator();
  drawBoard();
  renderAll();
  startTimer();
}

function startLocalGame() {
  gameMode = 'local';
  myColor = null;
  myRoomId = null;

  document.getElementById('mode-badge').textContent = '本地对弈';
  document.getElementById('btn-draw').style.display = 'none';

  engine.initBoard();
  engine.currentTurn = 'red';
  engine.gameOver = false;
  engine.winner = null;
  engine.moveHistory = [];
  capturedRed = [];
  capturedBlack = [];
  selectedPiece = null;
  validMoves = [];
  gameStarted = true;

  updateCaptured();
  updateTurnIndicator();
  switchScreen('game');
  drawBoard();
  renderAll();
  startTimer();
}

function initOnlineGame(color, roomId) {
  gameMode = 'online';
  myColor = color;
  myRoomId = roomId;

  document.getElementById('mode-badge').textContent = '房间: ' + roomId;
  document.getElementById('btn-draw').style.display = 'inline-flex';

  engine.initBoard();
  engine.currentTurn = 'red';
  engine.gameOver = false;
  engine.winner = null;
  engine.moveHistory = [];
  capturedRed = [];
  capturedBlack = [];
  selectedPiece = null;
  validMoves = [];
  gameStarted = false;

  updateCaptured();
  updateTurnIndicator();
  switchScreen('game');
  drawBoard();
  renderAll();
}

function leaveGame() {
  stopTimer();
  myColor = null;
  myRoomId = null;
  gameMode = 'local';
  gameStarted = false;
  selectedPiece = null;
  validMoves = [];
  capturedRed = [];
  capturedBlack = [];
  engine.initBoard();
  switchScreen('lobby');
  hideOverlay();
}

function connectSocket() {
  if (socket && socket.connected) return;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  updateConnStatus('connecting');

  try {
    socket = io({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      socketConnected = true;
      updateConnStatus('connected');
    });

    socket.on('disconnect', () => {
      socketConnected = false;
      updateConnStatus('disconnected');
    });

    socket.on('connect_error', () => {
      socketConnected = false;
      updateConnStatus('disconnected');
    });

    socket.on('room_created', (data) => {
      document.getElementById('lobby-status').innerHTML = `
        房间号: <strong style="font-size:24px;color:#d4a843;letter-spacing:4px;">${data.roomId}</strong>
        <br>等待对手加入...
      `;
      initOnlineGame(data.color, data.roomId);
      document.getElementById('turn-text').textContent = '等待对手加入...';
    });

    socket.on('room_joined', (data) => {
      document.getElementById('lobby-status').textContent = '';
      initOnlineGame(data.color, data.roomId);
      document.getElementById('turn-text').textContent = '等待对手加入...';
    });

    socket.on('game_start', (data) => {
      gameStarted = true;
      updateTurnIndicator();
      showToast('对手已加入,对局开始!', 2000);
      startTimer();
      renderAll();
    });

    socket.on('opponent_move', (data) => {
      if (data.fromRow !== undefined) {
        engine.move(data.fromRow, data.fromCol, data.toRow, data.toCol);
        if (data.captured) {
          if (data.captured.color === 'red') capturedRed.push(data.captured);
          else capturedBlack.push(data.captured);
          updateCaptured();
        }
        selectedPiece = null;
        validMoves = [];
        renderAll();
        updateTurnIndicator();

        if (data.gameOver) {
          onGameEnd(data.winner);
        }
      }
    });

    socket.on('game_over', (data) => {
      stopTimer();
      if (data.reason === 'resign') {
        showOverlay(`
          <h2>${engine.winner === myColor ? '🎉 胜利' : '😔 失败'}</h2>
          <p>对方认输, ${engine.winner === 'red' ? '红方' : '黑方'}获胜!</p>
          <div class="overlay-actions">
            <button class="btn btn-primary btn-sm" onclick="startNewGame()">新游戏</button>
            <button class="btn btn-secondary btn-sm" onclick="hideOverlay()">关闭</button>
          </div>
        `);
      } else if (data.reason === 'draw') {
        onGameEnd('draw');
      }
      renderAll();
      updateTurnIndicator();
    });

    socket.on('player_disconnected', () => {
      showToast('对手已断开连接', 3000);
    });

    socket.on('draw_requested', () => {
      showOverlay(`
        <h2>🤝 求和请求</h2>
        <p>对手请求和棋</p>
        <div class="overlay-actions">
          <button class="btn btn-success btn-sm" onclick="acceptDraw()">同意</button>
          <button class="btn btn-danger btn-sm" onclick="rejectDraw()">拒绝</button>
        </div>
      `);
    });

    socket.on('draw_rejected', () => {
      showToast('对方拒绝了求和');
    });

    socket.on('spectator_joined', (data) => {
      initOnlineGame(null, data.roomId);
      document.getElementById('turn-text').textContent = '观战模式';
      gameStarted = true;
      updateTurnIndicator();
      drawBoard();
      renderAll();
      showToast('房间已满,进入观战模式', 2000);
    });

    socket.on('error', (msg) => {
      showToast(msg, 3000);
      document.getElementById('lobby-status').textContent = msg;
    });
  } catch (e) {
    socketConnected = false;
    updateConnStatus('disconnected');
  }
}

function updateConnStatus(status) {
  connStatus.className = 'connection-status ' + status;
  if (status === 'connected') {
    connStatus.textContent = '● 服务器已连接';
  } else if (status === 'connecting') {
    connStatus.textContent = '◌ 正在连接服务器...';
  } else {
    connStatus.textContent = '○ 未连接服务器 (仍可使用本地模式)';
  }
}

function acceptDraw() {
  hideOverlay();
  if (socketConnected) socket.emit('accept_draw');
  engine.gameOver = true;
  engine.winner = 'draw';
  onGameEnd('draw');
  renderAll();
}

function rejectDraw() {
  hideOverlay();
  if (socketConnected) socket.emit('reject_draw');
}

document.getElementById('btn-local').addEventListener('click', () => {
  startLocalGame();
});

document.getElementById('btn-create').addEventListener('click', () => {
  if (!socketConnected) {
    showToast('服务器未连接,请稍后重试或使用本地模式', 2500);
    return;
  }
  document.getElementById('lobby-status').textContent = '正在创建房间...';
  socket.emit('create_room');
});

document.getElementById('btn-join').addEventListener('click', () => {
  if (!socketConnected) {
    showToast('服务器未连接,请稍后重试或使用本地模式', 2500);
    return;
  }
  const roomId = document.getElementById('room-input').value.trim().toUpperCase();
  if (!roomId) {
    showToast('请输入房间号');
    return;
  }
  document.getElementById('lobby-status').textContent = '正在加入房间...';
  socket.emit('join_room', roomId);
});

document.getElementById('room-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-join').click();
  }
});

document.getElementById('btn-resign').addEventListener('click', () => {
  if (!gameStarted || engine.gameOver) return;
  showOverlay(`
    <h2>确认认输?</h2>
    <p>认输后对方获胜</p>
    <div class="overlay-actions">
      <button class="btn btn-danger btn-sm" onclick="doResign()">确认认输</button>
      <button class="btn btn-secondary btn-sm" onclick="hideOverlay()">取消</button>
    </div>
  `);
});

function doResign() {
  hideOverlay();
  engine.gameOver = true;
  engine.winner = engine.currentTurn === 'red' ? 'black' : 'red';
  if (gameMode === 'online' && socketConnected) {
    socket.emit('resign');
  }
  onGameEnd(engine.winner);
}

document.getElementById('btn-draw').addEventListener('click', () => {
  if (!gameStarted || engine.gameOver) return;
  if (socketConnected) {
    socket.emit('request_draw');
  }
  showToast('已发送求和请求');
});

document.getElementById('btn-newgame').addEventListener('click', startNewGame);
document.getElementById('btn-leave').addEventListener('click', leaveGame);

window.addEventListener('resize', resizeBoard);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeBoard, 300);
});

document.addEventListener('DOMContentLoaded', () => {
  switchScreen('lobby');
  connectSocket();
  drawBoard();
});