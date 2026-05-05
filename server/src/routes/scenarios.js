import { Router } from 'express';
import prisma from '../lib/prisma.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function collectUnitSnapshots(projectId) {
  const units = await prisma.unit.findMany({
    where:  { stack: { block: { projectId } } },
    select: {
      id: true, floor: true, stackId: true,
      unitNumber: true, sizeSqft: true,
      finalPSF: true, finalPrice: true, isManualOverride: true,
    },
  });
  return units
    .filter(u => u.finalPSF != null && u.finalPrice != null)
    .map(u => ({
      unitId:          u.id,
      floor:           u.floor,
      stackId:         u.stackId,
      unitNumber:      u.unitNumber,
      sizeSqft:        u.sizeSqft,
      finalPSF:        u.finalPSF,
      finalPrice:      u.finalPrice,
      isManualOverride: u.isManualOverride,
    }));
}

// ─── Project-scoped routes  (mount at /api/projects) ─────────────────────────
export const projectScenariosRouter = Router();

// GET /api/projects/:projectId/scenarios
projectScenariosRouter.get('/:projectId/scenarios', async (req, res, next) => {
  try {
    const scenarios = await prisma.pricingScenario.findMany({
      where:   { projectId: req.params.projectId },
      include: { _count: { select: { snapshots: true } } },
      orderBy: [{ isBase: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(scenarios);
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/scenarios  — create new snapshot
projectScenariosRouter.post('/:projectId/scenarios', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { name, notes, isLocked = false } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const snapshots = await collectUnitSnapshots(projectId);

    const scenario = await prisma.pricingScenario.create({
      data: {
        projectId,
        name:     name.trim(),
        notes:    notes?.trim() || null,
        isLocked: Boolean(isLocked),
        snapshots: { create: snapshots },
      },
      include: { _count: { select: { snapshots: true } } },
    });
    res.status(201).json(scenario);
  } catch (err) {
    next(err);
  }
});

// ─── Scenario-scoped routes  (mount at /api/scenarios) ───────────────────────
export const scenariosRouter = Router();

// GET /api/scenarios/:id
scenariosRouter.get('/:id', async (req, res, next) => {
  try {
    const scenario = await prisma.pricingScenario.findUnique({
      where:   { id: req.params.id },
      include: { snapshots: true },
    });
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json(scenario);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/scenarios/:id  — update name / notes / isLocked
scenariosRouter.patch('/:id', async (req, res, next) => {
  try {
    const { name, notes, isLocked } = req.body;
    const data = {};
    if (name     !== undefined) data.name     = name;
    if (notes    !== undefined) data.notes    = notes;
    if (isLocked !== undefined) data.isLocked = Boolean(isLocked);

    const scenario = await prisma.pricingScenario.update({
      where: { id: req.params.id },
      data,
    });
    res.json(scenario);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Scenario not found' });
    next(err);
  }
});

// DELETE /api/scenarios/:id  — only if not locked
scenariosRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.pricingScenario.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Scenario not found' });
    if (existing.isLocked) return res.status(403).json({ error: 'Cannot delete a locked scenario' });

    await prisma.pricingScenario.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Scenario not found' });
    next(err);
  }
});

// POST /api/scenarios/:id/restore  — copy snapshot values back to live units
scenariosRouter.post('/:id/restore', async (req, res, next) => {
  try {
    const scenario = await prisma.pricingScenario.findUnique({
      where:   { id: req.params.id },
      include: { snapshots: true },
    });
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    if (scenario.isLocked) return res.status(403).json({ error: 'Cannot restore a locked scenario' });

    // updateMany silently skips unit IDs that no longer exist (stale after regeneration)
    await prisma.$transaction(
      scenario.snapshots.map(snap =>
        prisma.unit.updateMany({
          where: { id: snap.unitId },
          data:  {
            finalPSF:         snap.finalPSF,
            finalPrice:       snap.finalPrice,
            isManualOverride: snap.isManualOverride,
          },
        })
      )
    );

    res.json({ restoredCount: scenario.snapshots.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/scenarios/:id/save  — overwrite snapshots with current live units
scenariosRouter.post('/:id/save', async (req, res, next) => {
  try {
    const scenario = await prisma.pricingScenario.findUnique({ where: { id: req.params.id } });
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    if (scenario.isLocked) return res.status(403).json({ error: 'Cannot save to a locked scenario' });

    const snapshots = await collectUnitSnapshots(scenario.projectId);

    await prisma.$transaction([
      prisma.unitSnapshot.deleteMany({ where: { scenarioId: scenario.id } }),
      prisma.unitSnapshot.createMany({
        data: snapshots.map(s => ({ ...s, scenarioId: scenario.id })),
      }),
    ]);
    await prisma.pricingScenario.update({
      where: { id: scenario.id },
      data:  { updatedAt: new Date() },
    });

    const updated = await prisma.pricingScenario.findUnique({
      where:   { id: scenario.id },
      include: { _count: { select: { snapshots: true } } },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
