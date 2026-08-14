// ===== 服务端 AI 引擎 =====
// 从 xq-cloudflare 移植的象棋引擎（createBoard / getMoves / evaluate / minimax / getBestMove）
// 用于服务端训练和 AI 走棋

const PV = { king: 10000, rook: 600, cannon: 300, horse: 300, elephant: 120, advisor: 120, pawn: 30 };

function createBoard() {
  const board = [];
  for (let r = 0; r < 10; r++) { board[r] = []; for (let c = 0; c < 9; c++) board[r][c] = null; }
  const pieces = [
    { r: 0, c: 0, t: 'rook', cl: 'black' }, { r: 0, c: 1, t: 'horse', cl: 'black' },
    { r: 0, c: 2, t: 'elephant', cl: 'black' }, { r: 0, c: 3, t: 'advisor', cl: 'black' },
    { r: 0, c: 4, t: 'king', cl: 'black' }, { r: 0, c: 5, t: 'advisor', cl: 'black' },
    { r: 0, c: 6, t: 'elephant', cl: 'black' }, { r: 0, c: 7, t: 'horse', cl: 'black' },
    { r: 0, c: 8, t: 'rook', cl: 'black' },
    { r: 2, c: 1, t: 'cannon', cl: 'black' }, { r: 2, c: 7, t: 'cannon', cl: 'black' },
    { r: 3, c: 0, t: 'pawn', cl: 'black' }, { r: 3, c: 2, t: 'pawn', cl: 'black' },
    { r: 3, c: 4, t: 'pawn', cl: 'black' }, { r: 3, c: 6, t: 'pawn', cl: 'black' },
    { r: 3, c: 8, t: 'pawn', cl: 'black' },
    { r: 9, c: 0, t: 'rook', cl: 'red' }, { r: 9, c: 1, t: 'horse', cl: 'red' },
    { r: 9, c: 2, t: 'elephant', cl: 'red' }, { r: 9, c: 3, t: 'advisor', cl: 'red' },
    { r: 9, c: 4, t: 'king', cl: 'red' }, { r: 9, c: 5, t: 'advisor', cl: 'red' },
    { r: 9, c: 6, t: 'elephant', cl: 'red' }, { r: 9, c: 7, t: 'horse', cl: 'red' },
    { r: 9, c: 8, t: 'rook', cl: 'red' },
    { r: 7, c: 1, t: 'cannon', cl: 'red' }, { r: 7, c: 7, t: 'cannon', cl: 'red' },
    { r: 6, c: 0, t: 'pawn', cl: 'red' }, { r: 6, c: 2, t: 'pawn', cl: 'red' },
    { r: 6, c: 4, t: 'pawn', cl: 'red' }, { r: 6, c: 6, t: 'pawn', cl: 'red' },
    { r: 6, c: 8, t: 'pawn', cl: 'red' },
  ];
  for (const p of pieces) board[p.r][p.c] = { type: p.t, color: p.cl };
  return board;
}

function getMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const moves = [];
  const tp = p.type, cl = p.color;

  if (tp === 'king') {
    const ds = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const d of ds) {
      const nr = r + d[0], nc = c + d[1];
      if (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
        if ((cl === 'red' && nr >= 7 && nr <= 9 && nc >= 3 && nc <= 5) ||
            (cl === 'black' && nr >= 0 && nr <= 2 && nc >= 3 && nc <= 5)) {
          const t = board[nr][nc];
          if (!t || t.color !== cl) moves.push({ row: nr, col: nc });
        }
      }
    }
  }

  if (tp === 'advisor') {
    const ds = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const d of ds) {
      const nr = r + d[0], nc = c + d[1];
      if (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
        if ((cl === 'red' && nr >= 7 && nr <= 9 && nc >= 3 && nc <= 5) ||
            (cl === 'black' && nr >= 0 && nr <= 2 && nc >= 3 && nc <= 5)) {
          const t = board[nr][nc];
          if (!t || t.color !== cl) moves.push({ row: nr, col: nc });
        }
      }
    }
  }

  if (tp === 'elephant') {
    const em = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
    for (const e of em) {
      const nr = r + e[0], nc = c + e[1];
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      if (board[r + e[0] / 2][c + e[1] / 2]) continue;
      if ((cl === 'red' && nr < 5) || (cl === 'black' && nr > 4)) continue;
      const t = board[nr][nc];
      if (!t || t.color !== cl) moves.push({ row: nr, col: nc });
    }
  }

  if (tp === 'horse') {
    const hm = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]];
    for (const h of hm) {
      const nr = r + h[0], nc = c + h[1];
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      const ob = board[r + h[0] / 2][c + h[1] / 2];
      if (ob) continue;
      const t = board[nr][nc];
      if (!t || t.color !== cl) moves.push({ row: nr, col: nc });
    }
  }

  if (tp === 'rook') {
    const ds = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const d of ds) {
      let nr = r + d[0], nc = c + d[1];
      while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
        const t = board[nr][nc];
        if (!t) { moves.push({ row: nr, col: nc }); }
        else { if (t.color !== cl) moves.push({ row: nr, col: nc }); break; }
        nr += d[0]; nc += d[1];
      }
    }
  }

  if (tp === 'cannon') {
    const ds = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const d of ds) {
      let nr = r + d[0], nc = c + d[1];
      let found = false;
      while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
        const t = board[nr][nc];
        if (!t && !found) { moves.push({ row: nr, col: nc }); }
        else if (t && !found) { found = true; }
        else if (t && found) { if (t.color !== cl) moves.push({ row: nr, col: nc }); break; }
        nr += d[0]; nc += d[1];
      }
    }
  }

  if (tp === 'pawn') {
    const dr = cl === 'red' ? -1 : 1;
    if (r + dr >= 0 && r + dr <= 9) {
      const t = board[r + dr][c];
      if (!t || t.color !== cl) moves.push({ row: r + dr, col: c });
    }
    if ((cl === 'red' && r <= 4) || (cl === 'black' && r >= 5)) {
      if (c > 0 && board[r][c - 1] && board[r][c - 1].color !== cl) moves.push({ row: r, col: c - 1 });
      if (c < 8 && board[r][c + 1] && board[r][c + 1].color !== cl) moves.push({ row: r, col: c + 1 });
    }
  }

  return moves;
}

function evaluate(board) {
  let score = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      const val = PV[p.type];
      const mult = p.color === 'red' ? 1 : -1;
      score += val * mult;
      if (p.type === 'pawn' && ((p.color === 'red' && r <= 4) || (p.color === 'black' && r >= 5))) score += val * 0.5 * mult;
    }
  }
  return score;
}

function minimax(board, depth, alpha, beta, isMax) {
  if (depth === 0) return evaluate(board);
  const color = isMax ? 'red' : 'black';
  let best = isMax ? -Infinity : Infinity;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      const moves = getMoves(board, r, c);
      for (const m of moves) {
        const newBoard = JSON.parse(JSON.stringify(board));
        newBoard[m.row][m.col] = { ...p };
        newBoard[r][c] = null;
        const score = minimax(newBoard, depth - 1, alpha, beta, !isMax);
        if (isMax) { best = Math.max(best, score); alpha = Math.max(alpha, score); }
        else { best = Math.min(best, score); beta = Math.min(beta, score); }
        if (beta <= alpha) break;
      }
      if (beta <= alpha) break;
    }
    if (beta <= alpha) break;
  }
  return best;
}

function getBestMove(board, color) {
  let bestScore = color === 'red' ? -Infinity : Infinity;
  let bestMove = null;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      const moves = getMoves(board, r, c);
      for (const m of moves) {
        const newBoard = JSON.parse(JSON.stringify(board));
        newBoard[m.row][m.col] = { ...p };
        newBoard[r][c] = null;
        const score = minimax(newBoard, 2, -Infinity, Infinity, color === 'black');
        if ((color === 'red' && score > bestScore) || (color === 'black' && score < bestScore)) {
          bestScore = score;
          bestMove = { fromRow: r, fromCol: c, toRow: m.row, toCol: m.col };
        }
      }
    }
  }
  return bestMove;
}

// 快速走棋函数（用于训练）
function applyMove(board, fromRow, fromCol, toRow, toCol) {
  const p = board[fromRow][fromCol];
  if (!p) return null;
  const captured = board[toRow][toCol];
  board[toRow][toCol] = { ...p };
  board[fromRow][fromCol] = null;
  return captured ? { type: captured.type, color: captured.color } : null;
}

module.exports = {
  createBoard,
  getMoves,
  evaluate,
  minimax,
  getBestMove,
  applyMove,
  PV
};