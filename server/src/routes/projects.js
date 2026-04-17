import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// ─── GET /api/projects ────────────────────────────────────────────────────────
// List all projects (summary, no deep relations)
router.get('/', async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { blocks: true, sessions: true } },
      },
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
// Get a single project with its blocks and ranks
router.get('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        blocks: {
          include: {
            stacks: { include: { units: true, rank: true } },
          },
        },
        ranks: { include: { floorIncrements: true } },
        pricingParameters: true,
        sessions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects ───────────────────────────────────────────────────────
// Create a new project
router.post('/', async (req, res, next) => {
  try {
    const { nameEn, nameZh, description, totalUnitsExpected, roundingUnit, status } = req.body;

    if (!nameEn || !nameZh) {
      return res.status(400).json({ error: 'nameEn and nameZh are required' });
    }

    const project = await prisma.project.create({
      data: {
        nameEn,
        nameZh,
        description: description ?? null,
        totalUnitsExpected: totalUnitsExpected ?? null,
        roundingUnit: roundingUnit ?? 100,
        status: status ?? 'draft',
      },
    });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/projects/:id ──────────────────────────────────────────────────
// Update a project's fields
router.patch('/:id', async (req, res, next) => {
  try {
    const { nameEn, nameZh, description, totalUnitsExpected, roundingUnit, status } = req.body;

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...(nameEn !== undefined && { nameEn }),
        ...(nameZh !== undefined && { nameZh }),
        ...(description !== undefined && { description }),
        ...(totalUnitsExpected !== undefined && { totalUnitsExpected }),
        ...(roundingUnit !== undefined && { roundingUnit }),
        ...(status !== undefined && { status }),
      },
    });
    res.json(project);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    next(err);
  }
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
// Delete a project (cascades to all child records)
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    next(err);
  }
});

export default router;
