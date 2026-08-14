const express = require('express');
const { loadAiData, saveAiData } = require('./db');

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

  // 训练控制
  router.post('/train/start', (req, res) => {
    res.json({ success: true });
  });

  router.post('/train/stop', (req, res) => {
    res.json({ success: true });
  });

  router.get('/train/status', (req, res) => {
    res.json({
      training: false,
      session: { games: 0, redWins: 0, blkWins: 0, draws: 0 },
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