import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// PATCH /api/increments/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { fromFloor, toFloor, incrementPSF } = req.body;
    const increment = await prisma.floorIncrement.update({
      where: { id: req.params.id },
      data: {
        ...(fromFloor    !== undefined && { fromFloor:    Number(fromFloor) }),
        ...(toFloor      !== undefined && { toFloor:      Number(toFloor) }),
        ...(incrementPSF !== undefined && { incrementPSF: incrementPSF !== null && incrementPSF !== '' ? Number(incrementPSF) : null }),
      },
    });
    res.json(increment);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Floor increment not found' });
    next(err);
  }
});

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
