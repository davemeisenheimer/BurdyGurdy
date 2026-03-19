import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { cache } from './cache';
import birdsRouter from './routes/birds';
import quizRouter from './routes/quiz';
import blockedPhotosRouter from './routes/blockedPhotos';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use('/api/birds', birdsRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/blocked-photos', blockedPhotosRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Secret cache-clear endpoint — token must match ADMIN_TOKEN env var
app.post('/api/admin/cache-clear', (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.query.token !== token) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  cache.clear();
  res.json({ ok: true, message: 'Server cache cleared' });
});

// Serve frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));

app.listen(PORT, () => {
  console.log(`BurdyGurdy backend running on http://localhost:${PORT}`);
});
