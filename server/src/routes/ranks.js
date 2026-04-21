import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/ranks?projectId=xxx
router.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const ranks = await prisma.rank.findMany({
      where: projectId ? { projectId } : undefined,
      include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } },
      orderBy: { rankNumber: 'asc' },
    });
    res.json(ranks);
  } catch (err) {
    next(err);
  }
});

// GET /api/ranks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const rank = await prisma.rank.findUnique({
      where: { id: req.params.id },
      include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } },
    });
    if (!rank) return res.status(404).json({ error: 'Rank not found' });
    res.json(rank);
  } catch (err) {
    next(err);
  }
});

// POST /api/ranks
router.post('/', async (req, res, next) => {
  try {
    const { projectId, rankNumber, labelEn, labelZh, basePSF, rankDifferential, floorIncrements } = req.body;
    if (!projectId || !labelEn || !labelZh || basePSF === undefined) {
      return res.status(400).json({ error: 'projectId, labelEn, labelZh, and basePSF are required' });
    }
    const rank = await prisma.rank.create({
      data: {
        projectId,
        rankNumber: rankNumber ?? 1,
        labelEn,
        labelZh,
        basePSF: Number(basePSF),
        rankDifferential: rankDifferential ? Number(rankDifferential) : 0,
        floorIncrements: floorIncrements
          ? { create: floorIncrements.map(fi => ({
              fromFloor: Number(fi.fromFloor),
              toFloor: Number(fi.toFloor),
              incrementPSF: Number(fi.incrementPSF),
            })) }
          : undefined,
      },
      include: { floorIncrements: true },
    });
    res.status(201).json(rank);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/ranks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { rankNumber, labelEn, labelZh, basePSF, rankDifferential } = req.body;
    const rank = await prisma.rank.update({
      where: { id: req.params.id },
      data: {
        ...(rankNumber !== undefined && { rankNumber: Number(rankNumber) }),
        ...(labelEn !== undefined && { labelEn }),
        ...(labelZh !== undefined && { labelZh }),
        ...(basePSF !== undefined && { basePSF: Number(basePSF) }),
        ...(rankDifferential !== undefined && { rankDifferential: Number(rankDifferential) }),
      },
      include: { floorIncrements: true },
    });
    res.json(rank);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Rank not found' });
    next(err);
  }
});

// DELETE /api/ranks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.rank.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Rank not found' });
    next(err);
  }
});

// POST /api/ranks/:rankId/increments — add a floor increment band to a rank
router.post('/:rankId/increments', async (req, res, next) => {
  try {
    const { rankId } = req.params;
    const { fromFloor, toFloor, incrementPSF } = req.body;
    if (fromFloor === undefined || toFloor === undefined || incrementPSF === undefined) {
      return res.status(400).json({ error: 'fromFloor, toFloor, and incrementPSF are required' });
    }
    const increment = await prisma.floorIncrement.create({
      data: {
        rankId,
        fromFloor:    Number(fromFloor),
        toFloor:      Number(toFloor),
        incrementPSF: Number(incrementPSF),
      },
    });
    res.status(201).json(increment);
  } catch (err) {
    next(err);
  }
});

export default router;
