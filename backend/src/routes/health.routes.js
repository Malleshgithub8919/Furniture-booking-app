import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();
router.get('/health', (req, res) => res.json({ success: true, status: 'ok', service: 'furniture-marketplace-api' }));
router.get('/ready', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({ success: databaseReady, api: 'ready', database: databaseReady ? 'connected' : 'not_connected' });
});
export default router;
