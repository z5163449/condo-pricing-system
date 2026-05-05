import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import projectRoutes from './routes/projects.js';
import blockRoutes from './routes/blocks.js';
import rankRoutes from './routes/ranks.js';
import stackRoutes from './routes/stacks.js';
import incrementRoutes from './routes/increments.js';
import unitRoutes from './routes/units.js';
import { projectScenariosRouter, scenariosRouter } from './routes/scenarios.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.CLIENT_URL
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectScenariosRouter);
app.use('/api/blocks', blockRoutes);
app.use('/api/ranks', rankRoutes);
app.use('/api/stacks', stackRoutes);
app.use('/api/increments', incrementRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/scenarios', scenariosRouter);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
