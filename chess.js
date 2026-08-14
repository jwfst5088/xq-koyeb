class ChessEngine {
  constructor() {
    this.board = [];
    this.currentTurn = 'red';
    this.moveHistory = [];
    this.gameOver = false;
    this.winner = null;
    this.initBoard();
  }

  initBoard() {
    for (let row = 0; row < 10; row++) {
      this.board[row] = [];
      for (let col = 0; col < 9; col++) {
        this.board[row][col] = null;
      }
    }

    const setup = [
      { row: 0, col: 0, type: 'rook', color: 'black' },
      { row: 0, col: 1, type: 'horse', color: 'black' },
      { row: 0, col: 2, type: 'elephant', color: 'black' },
      { row: 0, col: 3, type: 'advisor', color: 'black' },
      { row: 0, col: 4, type: 'king', color: 'black' },
      { row: 0, col: 5, type: 'advisor', color: 'black' },
      { row: 0, col: 6, type: 'elephant', color: 'black' },
      { row: 0, col: 7, type: 'horse', color: 'black' },
      { row: 0, col: 8, type: 'rook', color: 'black' },
      { row: 2, col: 1, type: 'cannon', color: 'black' },
      { row: 2, col: 7, type: 'cannon', color: 'black' },
      { row: 3, col: 0, type: 'pawn', color: 'black' },
      { row: 3, col: 2, type: 'pawn', color: 'black' },
      { row: 3, col: 4, type: 'pawn', color: 'black' },
      { row: 3, col: 6, type: 'pawn', color: 'black' },
      { row: 3, col: 8, type: 'pawn', color: 'black' },
      { row: 9, col: 0, type: 'rook', color: 'red' },
      { row: 9, col: 1, type: 'horse', color: 'red' },
      { row: 9, col: 2, type: 'elephant', color: 'red' },
      { row: 9, col: 3, type: 'advisor', color: 'red' },
      { row: 9, col: 4, type: 'king', color: 'red' },
      { row: 9, col: 5, type: 'advisor', color: 'red' },
      { row: 9, col: 6, type: 'elephant', color: 'red' },
      { row: 9, col: 7, type: 'horse', color: 'red' },
      { row: 9, col: 8, type: 'rook', color: 'red' },
      { row: 7, col: 1, type: 'cannon', color: 'red' },
      { row: 7, col: 7, type: 'cannon', color: 'red' },
      { row: 6, col: 0, type: 'pawn', color: 'red' },
      { row: 6, col: 2, type: 'pawn', color: 'red' },
      { row: 6, col: 4, type: 'pawn', color: 'red' },
      { row: 6, col: 6, type: 'pawn', color: 'red' },
      { row: 6, col: 8, type: 'pawn', color: 'red' },
    ];

    for (const piece of setup) {
      this.board[piece.row][piece.col] = { type: piece.type, color: piece.color };
    }
  }

  getPiece(row, col) {
    if (row < 0 || row > 9 || col < 0 || col > 8) return null;
    return this.board[row][col];
  }

  cloneBoard() {
    const newBoard = [];
    for (let r = 0; r < 10; r++) {
      newBoard[r] = [];
      for (let c = 0; c < 9; c++) {
        if (this.board[r][c]) {
          newBoard[r][c] = { ...this.board[r][c] };
        } else {
          newBoard[r][c] = null;
        }
      }
    }
    return newBoard;
  }

  isWithinBoard(row, col) {
    return row >= 0 && row <= 9 && col >= 0 && col <= 8;
  }

  isInPalace(row, col, color) {
    if (col < 3 || col > 5) return false;
    if (color === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
  }

  hasCrossedRiver(row, color) {
    if (color === 'red') return row <= 4;
    return row >= 5;
  }

  countPiecesBetween(r1, c1, r2, c2) {
    let count = 0;
    if (r1 === r2) {
      const minC = Math.min(c1, c2);
      const maxC = Math.max(c1, c2);
      for (let c = minC + 1; c < maxC; c++) {
        if (this.board[r1][c]) count++;
      }
    } else if (c1 === c2) {
      const minR = Math.min(r1, r2);
      const maxR = Math.max(r1, r2);
      for (let r = minR + 1; r < maxR; r++) {
        if (this.board[r][c1]) count++;
      }
    }
    return count;
  }

  getRawMoves(row, col) {
    const piece = this.getPiece(row, col);
    if (!piece) return [];

    const moves = [];
    const { type, color } = piece;

    if (type === 'king') {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = row + dr;
        const nc = col + dc;
        if (this.isInPalace(nr, nc, color)) {
          const target = this.getPiece(nr, nc);
          if (!target || target.color !== color) {
            moves.push({ row: nr, col: nc });
          }
        }
      }
    }

    if (type === 'advisor') {
      const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dr, dc] of dirs) {
        const nr = row + dr;
        const nc = col + dc;
        if (this.isInPalace(nr, nc, color)) {
          const target = this.getPiece(nr, nc);
          if (!target || target.color !== color) {
            moves.push({ row: nr, col: nc });
          }
        }
      }
    }

    if (type === 'elephant') {
      const elephantMoves = [
        { dr: -2, dc: -2, er: -1, ec: -1 },
        { dr: -2, dc: 2, er: -1, ec: 1 },
        { dr: 2, dc: -2, er: 1, ec: -1 },
        { dr: 2, dc: 2, er: 1, ec: 1 },
      ];
      for (const { dr, dc, er, ec } of elephantMoves) {
        const nr = row + dr;
        const nc = col + dc;
        const eyeR = row + er;
        const eyeC = col + ec;
        if (!this.isWithinBoard(nr, nc)) continue;
        if (this.getPiece(eyeR, eyeC)) continue;
        if (color === 'red' && nr < 5) continue;
        if (color === 'black' && nr > 4) continue;
        const target = this.getPiece(nr, nc);
        if (!target || target.color !== color) {
          moves.push({ row: nr, col: nc });
        }
      }
    }

    if (type === 'horse') {
      const horseMoves = [
        { dr: -2, dc: -1, lr: -1, lc: 0 },
        { dr: -2, dc: 1, lr: -1, lc: 0 },
        { dr: 2, dc: -1, lr: 1, lc: 0 },
        { dr: 2, dc: 1, lr: 1, lc: 0 },
        { dr: -1, dc: -2, lr: 0, lc: -1 },
        { dr: -1, dc: 2, lr: 0, lc: 1 },
        { dr: 1, dc: -2, lr: 0, lc: -1 },
        { dr: 1, dc: 2, lr: 0, lc: 1 },
      ];
      for (const { dr, dc, lr, lc } of horseMoves) {
        const nr = row + dr;
        const nc = col + dc;
        const legR = row + lr;
        const legC = col + lc;
        if (!this.isWithinBoard(nr, nc)) continue;
        if (this.getPiece(legR, legC)) continue;
        const target = this.getPiece(nr, nc);
        if (!target || target.color !== color) {
          moves.push({ row: nr, col: nc });
        }
      }
    }

    if (type === 'rook') {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        let nr = row + dr;
        let nc = col + dc;
        while (this.isWithinBoard(nr, nc)) {
          const target = this.getPiece(nr, nc);
          if (target) {
            if (target.color !== color) {
              moves.push({ row: nr, col: nc });
            }
            break;
          }
          moves.push({ row: nr, col: nc });
          nr += dr;
          nc += dc;
        }
      }
    }

    if (type === 'cannon') {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        let nr = row + dr;
        let nc = col + dc;
        while (this.isWithinBoard(nr, nc)) {
          const target = this.getPiece(nr, nc);
          if (target) {
            nr += dr;
            nc += dc;
            while (this.isWithinBoard(nr, nc)) {
              const t2 = this.getPiece(nr, nc);
              if (t2) {
                if (t2.color !== color) {
                  moves.push({ row: nr, col: nc });
                }
                break;
              }
              nr += dr;
              nc += dc;
            }
            break;
          }
          moves.push({ row: nr, col: nc });
          nr += dr;
          nc += dc;
        }
      }
    }

    if (type === 'pawn') {
      if (color === 'red') {
        const forward = row - 1;
        if (forward >= 0) {
          const target = this.getPiece(forward, col);
          if (!target || target.color !== color) {
            moves.push({ row: forward, col: col });
          }
        }
        if (this.hasCrossedRiver(row, color)) {
          for (const dc of [-1, 1]) {
            const nc = col + dc;
            if (nc >= 0 && nc <= 8) {
              const target = this.getPiece(row, nc);
              if (!target || target.color !== color) {
                moves.push({ row: row, col: nc });
              }
            }
          }
        }
      } else {
        const forward = row + 1;
        if (forward <= 9) {
          const target = this.getPiece(forward, col);
          if (!target || target.color !== color) {
            moves.push({ row: forward, col: col });
          }
        }
        if (this.hasCrossedRiver(row, color)) {
          for (const dc of [-1, 1]) {
            const nc = col + dc;
            if (nc >= 0 && nc <= 8) {
              const target = this.getPiece(row, nc);
              if (!target || target.color !== color) {
                moves.push({ row: row, col: nc });
              }
            }
          }
        }
      }
    }

    return moves;
  }

  findKing(color) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = this.board[r][c];
        if (piece && piece.type === 'king' && piece.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  isKingFacingKing() {
    const redKing = this.findKing('red');
    const blackKing = this.findKing('black');
    if (!redKing || !blackKing) return false;
    if (redKing.col !== blackKing.col) return false;
    return this.countPiecesBetween(redKing.row, redKing.col, blackKing.row, blackKing.col) === 0;
  }

  isInCheck(color) {
    const king = this.findKing(color);
    if (!king) return true;

    if (this.isKingFacingKing()) return true;

    const opponentColor = color === 'red' ? 'black' : 'red';
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = this.board[r][c];
        if (piece && piece.color === opponentColor) {
          const moves = this.getRawMoves(r, c);
          for (const move of moves) {
            if (move.row === king.row && move.col === king.col) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  simulateMove(fromRow, fromCol, toRow, toCol) {
    const piece = this.board[fromRow][fromCol];
    const captured = this.board[toRow][toCol];
    this.board[toRow][toCol] = piece;
    this.board[fromRow][fromCol] = null;
    return captured;
  }

  undoSimulate(fromRow, fromCol, toRow, toCol, captured) {
    const piece = this.board[toRow][toCol];
    this.board[fromRow][fromCol] = piece;
    this.board[toRow][toCol] = captured;
  }

  isMoveLegal(fromRow, fromCol, toRow, toCol) {
    const piece = this.getPiece(fromRow, fromCol);
    if (!piece) return false;
    if (piece.color !== this.currentTurn) return false;

    const rawMoves = this.getRawMoves(fromRow, fromCol);
    const isValidRaw = rawMoves.some(m => m.row === toRow && m.col === toCol);
    if (!isValidRaw) return false;

    const captured = this.simulateMove(fromRow, fromCol, toRow, toCol);
    const inCheck = this.isInCheck(piece.color);
    this.undoSimulate(fromRow, fromCol, toRow, toCol, captured);

    return !inCheck;
  }

  getLegalMoves(row, col) {
    const piece = this.getPiece(row, col);
    if (!piece || piece.color !== this.currentTurn) return [];

    const rawMoves = this.getRawMoves(row, col);
    return rawMoves.filter(move => this.isMoveLegal(row, col, move.row, move.col));
  }

  move(fromRow, fromCol, toRow, toCol) {
    if (this.gameOver) return null;

    const piece = this.getPiece(fromRow, fromCol);
    if (!piece || piece.color !== this.currentTurn) return null;

    if (!this.isMoveLegal(fromRow, fromCol, toRow, toCol)) return null;

    const captured = this.board[toRow][toCol];
    this.board[toRow][toCol] = piece;
    this.board[fromRow][fromCol] = null;

    this.moveHistory.push({ fromRow, fromCol, toRow, toCol, captured, piece, prevTurn: this.currentTurn });

    const opponentColor = this.currentTurn === 'red' ? 'black' : 'red';
    this.currentTurn = opponentColor;

    if (this.isInCheck(opponentColor)) {
      const hasLegalMoves = this.hasAnyLegalMove(opponentColor);
      if (!hasLegalMoves) {
        this.gameOver = true;
        this.winner = piece.color;
      }
    }

    return { captured, check: this.isInCheck(opponentColor), gameOver: this.gameOver, winner: this.winner };
  }

  hasAnyLegalMove(color) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = this.board[r][c];
        if (piece && piece.color === color) {
          const savedTurn = this.currentTurn;
          this.currentTurn = color;
          const moves = this.getLegalMoves(r, c);
          this.currentTurn = savedTurn;
          if (moves.length > 0) return true;
        }
      }
    }
    return false;
  }

  getState() {
    return {
      board: this.board,
      currentTurn: this.currentTurn,
      gameOver: this.gameOver,
      winner: this.winner,
      moveHistory: this.moveHistory,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChessEngine;
}