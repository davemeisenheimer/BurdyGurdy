import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Stored at the backend root so the path is stable across dev (src/) and prod (dist/) builds
const DATA_FILE = path.resolve(__dirname, '../../blocked-photos.json');

function loadFromFile(): string[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

const blockedUrls = new Set<string>(loadFromFile());

function saveToFile() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify([...blockedUrls], null, 2));
  } catch (err) {
    console.warn('blocked-photos: failed to write to file:', (err as Error).message);
  }
}

// GET /api/blocked-photos — public, no auth required
router.get('/', (_req, res) => {
  res.json([...blockedUrls]);
});

// POST /api/blocked-photos — requires Authorization: Bearer <CURATION_TOKEN>
router.post('/', (req, res) => {
  const token = process.env.CURATION_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required' });
  }
  const added = !blockedUrls.has(url);
  blockedUrls.add(url);
  if (added) saveToFile();
  res.json({ ok: true, total: blockedUrls.size });
});

export default router;
