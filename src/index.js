const express = require('express');
const { loadAiData, saveAiData } = require('./db');
const { createBoard, getMoves, evaluate, minimax, getBestMove, applyMove, PV } = require('./ai-engine');

// AI 权重（默认值）
const defaultAiWeights = {
  attackKing: 70, limitKingMob: 35, approach: 30, mobility: 5,
  rookNotMoved: 5, rookCrossed: 110, rookDeveloped: 90,
  horseDeveloped: 25, cannonDeveloped: 15,
  pieceSafety: 80, hangingPenalty: 80, tradeAccuracy: 120,
  pawnPromotion: 50, checkBonus: 130, centerControl: 20,
  rookCoordination: 60, kingSafety: 40
};

function createAppRouter(db, roomManager) {
  const router = express.Router();

  // 加载 AI 数据
  const aiData = loadAiData();
  const aiWeights = aiData.weights || { ...defaultAiWeights };
  const aiTotalStats = aiData.stats || { games: 0, redWins: 0, blkWins: 0, draws: 0 };

  // 服务端训练状态
  let serverTraining = false;
  let serverTrainingStop = false;
  let serverTrainSession = { games: 0, redWins: 0, blkWins: 0, draws: 0 };

  // CORS
  router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // AI 数据库检查
  router.get('/ai/db-check', (req, res) => {
    res.json({ aiTotalStats });
  });

  // 服务端 AI 最佳走法
  router.post('/ai/bestmove', (req, res) => {
    try {
      const { fen, color } = req.body;
      const board = createBoard();
      if (fen) {
        // 支持从fen字符串恢复棋盘（简化版：只支持标准开局）
        // 如果有完整的 fen 解析逻辑，这里可以扩展
      }
      const colorToMove = color || 'red';
      const move = getBestMove(board, colorToMove);
      res.json({ success: true, move });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 服务端训练循环
  function runServerTrainingGame() {
    if (!serverTraining || serverTrainingStop) return;
    const board = createBoard();
    const maxMoves = 200;
    let moves = 0;
    let currentTurn = 'red';

    function makeNextMove() {
      if (!serverTraining || serverTrainingStop) return;
      if (moves >= maxMoves) {
        serverTrainSession.games++;
        serverTrainSession.draws++;
        aiTotalStats.games++;
        aiTotalStats.draws++;
        saveAiData(aiWeights, aiTotalStats);
        setImmediate(runServerTrainingGame);
        return;
      }

      const move = getBestMove(board, currentTurn);
      if (!move) {
        const winner = currentTurn === 'red' ? 'black' : 'red';
        serverTrainSession.games++;
        if (winner === 'red') { serverTrainSession.redWins++; aiTotalStats.redWins++; }
        else { serverTrainSession.blkWins++; aiTotalStats.blkWins++; }
        aiTotalStats.games++;
        saveAiData(aiWeights, aiTotalStats);
        setImmediate(runServerTrainingGame);
        return;
      }

      applyMove(board, move.fromRow, move.fromCol, move.toRow, move.toCol);
      moves++;
      currentTurn = currentTurn === 'red' ? 'black' : 'red';

      // 检查是否吃了对方将/帅
      const kingCount = { red: 0, black: 0 };
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = board[r][c];
          if (p && p.type === 'king') kingCount[p.color]++;
        }
      }
      if (kingCount.red === 0 || kingCount.black === 0) {
        const winner = kingCount.red === 0 ? 'black' : 'red';
        serverTrainSession.games++;
        if (winner === 'red') { serverTrainSession.redWins++; aiTotalStats.redWins++; }
        else { serverTrainSession.blkWins++; aiTotalStats.blkWins++; }
        aiTotalStats.games++;
        saveAiData(aiWeights, aiTotalStats);
        setImmediate(runServerTrainingGame);
        return;
      }

      setImmediate(makeNextMove);
    }

    makeNextMove();
  }

  // 训练控制
  router.post('/train/start', (req, res) => {
    if (serverTraining) {
      return res.json({ success: true, message: '训练已在运行中' });
    }
    serverTraining = true;
    serverTrainingStop = false;
    serverTrainSession = { games: 0, redWins: 0, blkWins: 0, draws: 0 };
    setImmediate(runServerTrainingGame);
    res.json({ success: true, message: '服务端训练已启动' });
  });

  router.post('/train/stop', (req, res) => {
    serverTrainingStop = true;
    serverTraining = false;
    res.json({ success: true, message: '训练已停止' });
  });

  router.get('/train/status', (req, res) => {
    res.json({
      training: serverTraining,
      serverSession: serverTrainSession,
      total: aiTotalStats,
      weights: aiWeights
    });
  });

  // AI 数据读写
  router.get('/ai/data', (req, res) => {
    res.json({ weights: aiWeights, trainStats: aiTotalStats });
  });

  router.post('/ai/data', (req, res) => {
    try {
      const data = req.body;
      if (data.weights) {
        const mergeFactor = data.isDelta ? 0.3 : 0.5;
        for (const k in data.weights) {
          if (aiWeights[k] !== undefined) {
            aiWeights[k] = aiWeights[k] * (1 - mergeFactor) + data.weights[k] * mergeFactor;
          }
        }
      }
      if (data.stats) {
        for (const k in data.stats) {
          if (aiTotalStats[k] !== undefined) {
            aiTotalStats[k] += (data.stats[k] || 0);
          }
        }
      }
      const saved = saveAiData(aiWeights, aiTotalStats);
      res.json({ success: true, weights: aiWeights, total: aiTotalStats, saved });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 房间列表
  router.get('/rooms', (req, res) => {
    res.json({ rooms: [] });
  });

  // 在线人数
  router.get('/online', (req, res) => {
    res.json({ count: roomManager.getOnlineCount() });
  });

  // 创建房间
  router.get('/create-room', (req, res) => {
    const customId = req.query.id;
    const roomId = customId || Math.random().toString(36).slice(2, 8).toUpperCase();
    res.json({ roomId });
  });

  return router;
}

module.exports = { createAppRouter };