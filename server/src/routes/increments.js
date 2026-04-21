import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// DELETE /api/increments/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.floorIncrement.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Floor increment not found' });
    next(err);
  }
});

export default router;
