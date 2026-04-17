import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/blocks?projectId=xxx
router.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const blocks = await prisma.block.findMany({
      where: projectId ? { projectId } : undefined,
      include: { stacks: { include: { rank: true, _count: { select: { units: true } } } } },
      orderBy: { blockName: 'asc' },
    });
    res.json(blocks);
  } catch (err) {
    next(err);
  }
});

// GET /api/blocks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const block = await prisma.block.findUnique({
      where: { id: req.params.id },
      include: { stacks: { include: { units: true, rank: true } } },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
  } catch (err) {
    next(err);
  }
});

// POST /api/blocks
router.post('/', async (req, res, next) => {
  try {
    const { projectId, blockName, totalStoreys, startingFloor, excludedFloors } = req.body;
    if (!projectId || !blockName || !totalStoreys) {
      return res.status(400).json({ error: 'projectId, blockName, and totalStoreys are required' });
    }
    const block = await prisma.block.create({
      data: {
        projectId,
        blockName,
        totalStoreys: Number(totalStoreys),
        startingFloor: startingFloor ?? 1,
        excludedFloors: JSON.stringify(excludedFloors ?? []),
      },
    });
    res.status(201).json(block);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/blocks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { blockName, totalStoreys, startingFloor, excludedFloors } = req.body;
    const block = await prisma.block.update({
      where: { id: req.params.id },
      data: {
        ...(blockName !== undefined && { blockName }),
        ...(totalStoreys !== undefined && { totalStoreys: Number(totalStoreys) }),
        ...(startingFloor !== undefined && { startingFloor: Number(startingFloor) }),
        ...(excludedFloors !== undefined && { excludedFloors: JSON.stringify(excludedFloors) }),
      },
    });
    res.json(block);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Block not found' });
    next(err);
  }
});

// DELETE /api/blocks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.block.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Block not found' });
    next(err);
  }
});

export default router;
