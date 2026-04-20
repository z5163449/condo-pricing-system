import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/stacks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const stack = await prisma.stack.findUnique({
      where: { id: req.params.id },
      include: { rank: true, units: { orderBy: { floor: 'asc' } } },
    });
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    res.json(stack);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stacks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const {
      stackNumber, unitTypeCode, bedroomType, standardSizeSqft,
      facing, notes, rankId, hasPenthouse, penthouseUse, penthouseSizeSqft,
      stackStartingFloor, stackExcludedFloors,
    } = req.body;

    const stack = await prisma.stack.update({
      where: { id: req.params.id },
      data: {
        ...(stackNumber          !== undefined && { stackNumber: Number(stackNumber) }),
        ...(unitTypeCode         !== undefined && { unitTypeCode }),
        ...(bedroomType          !== undefined && { bedroomType }),
        ...(standardSizeSqft     !== undefined && { standardSizeSqft: Number(standardSizeSqft) }),
        ...(facing               !== undefined && { facing: facing || null }),
        ...(notes                !== undefined && { notes: notes || null }),
        ...(rankId               !== undefined && { rankId: rankId || null }),
        ...(hasPenthouse         !== undefined && { hasPenthouse }),
        ...(penthouseUse         !== undefined && { penthouseUse: penthouseUse || null }),
        ...(penthouseSizeSqft    !== undefined && {
          penthouseSizeSqft: penthouseSizeSqft ? Number(penthouseSizeSqft) : null,
        }),
        ...(stackStartingFloor   !== undefined && {
          stackStartingFloor: stackStartingFloor != null && stackStartingFloor !== '' ? Number(stackStartingFloor) : null,
        }),
        ...(stackExcludedFloors  !== undefined && {
          stackExcludedFloors: stackExcludedFloors != null ? JSON.stringify(stackExcludedFloors) : null,
        }),
      },
      include: { rank: true },
    });
    res.json(stack);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Stack not found' });
    next(err);
  }
});

// DELETE /api/stacks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.stack.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Stack not found' });
    next(err);
  }
});

export default router;
