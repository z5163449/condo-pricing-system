import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

function getBandIncrement(sortedBands, floor) {
  if (!sortedBands || sortedBands.length === 0) return 0;
  const band = sortedBands.find((b, idx) =>
    idx < sortedBands.length - 1
      ? b.fromFloor <= floor && floor < b.toFloor
      : b.fromFloor <= floor && floor <= b.toFloor
  );
  if (band) return band.incrementPSF ?? 0;
  const last = sortedBands[sortedBands.length - 1];
  if (floor > last.toFloor) return last.incrementPSF ?? 0;
  return 0;
}

function getStackBands(stack) {
  if (stack.stackIncrementsLocked && stack.stackIncrements) {
    try {
      return JSON.parse(stack.stackIncrements).sort((a, b) => a.fromFloor - b.fromFloor);
    } catch {
      // fall through to rank increments
    }
  }
  return stack.rank?.floorIncrements ?? [];
}

async function cascadeAbove(stackId, anchorFloor, anchorRawPSF, bands, roundingUnit) {
  const unitsAbove = await prisma.unit.findMany({
    where: { stackId, floor: { gt: anchorFloor } },
    orderBy: { floor: 'asc' },
  });

  if (unitsAbove.length === 0) return;

  let prevRawPSF = anchorRawPSF;
  const updates = [];

  for (const unit of unitsAbove) {
    if (unit.isManualOverride) {
      prevRawPSF = unit.sizeSqft > 0 ? unit.finalPrice / unit.sizeSqft : unit.finalPSF;
      continue;
    }
    const increment  = getBandIncrement(bands, unit.floor);
    const rawPSF     = prevRawPSF + increment;
    const finalPrice = unit.sizeSqft > 0
      ? Math.round(rawPSF * unit.sizeSqft / roundingUnit) * roundingUnit
      : 0;
    const finalPSF   = unit.sizeSqft > 0 ? finalPrice / unit.sizeSqft : rawPSF;

    updates.push({ id: unit.id, finalPSF, finalPrice });
    prevRawPSF = rawPSF;
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(u => prisma.unit.update({
        where: { id: u.id },
        data:  { finalPSF: u.finalPSF, finalPrice: u.finalPrice },
      }))
    );
  }
}

// ─── PATCH /api/units/:id ─────────────────────────────────────────────────────
// Apply (or clear) a manual override on a single unit, then cascade upward.
router.patch('/:id', async (req, res, next) => {
  try {
    const { finalPSF, finalPrice, isManualOverride } = req.body;

    const data = {};
    if (finalPSF !== undefined) {
      data.finalPSF          = Number(finalPSF);
      data.manualOverridePSF = Number(finalPSF);
    }
    if (finalPrice !== undefined) {
      data.finalPrice          = Number(finalPrice);
      data.manualOverridePrice = Number(finalPrice);
    }
    if (isManualOverride !== undefined) {
      data.isManualOverride = Boolean(isManualOverride);
    }

    const unit = await prisma.unit.update({ where: { id: req.params.id }, data });

    if (data.isManualOverride === true) {
      try {
        const updatedUnit = await prisma.unit.findUnique({
          where: { id: req.params.id },
          include: {
            stack: {
              include: {
                rank: { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } },
                block: { include: { project: { include: { pricingParameters: true } } } },
              },
            },
          },
        });
        const project      = updatedUnit.stack.block.project;
        const roundingUnit = project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100;
        const bands        = getStackBands(updatedUnit.stack);
        const anchorRawPSF = updatedUnit.sizeSqft > 0
          ? updatedUnit.finalPrice / updatedUnit.sizeSqft
          : updatedUnit.finalPSF;
        await cascadeAbove(updatedUnit.stackId, updatedUnit.floor, anchorRawPSF, bands, roundingUnit);
      } catch (cascadeErr) {
        console.error('cascade error:', cascadeErr);
      }
    }

    const freshUnit = await prisma.unit.findUnique({ where: { id: req.params.id } });
    res.json(freshUnit);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    next(err);
  }
});

// ─── PATCH /api/units/:id/reset ──────────────────────────────────────────────
// Restore a unit to its solver-calculated values, clear the manual override,
// then re-chain all non-manual floors above it in the same stack.
router.patch('/:id/reset', async (req, res, next) => {
  try {
    const existing = await prisma.unit.findUnique({
      where:   { id: req.params.id },
      include: {
        stack: {
          include: {
            rank:  { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } },
            block: { include: { project: { include: { pricingParameters: true } } } },
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: 'Unit not found' });

    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data: {
        finalPSF:            existing.calculatedPSF,
        finalPrice:          existing.calculatedPrice,
        isManualOverride:    false,
        manualOverridePSF:   null,
        manualOverridePrice: null,
      },
    });

    const project      = existing.stack.block.project;
    const roundingUnit = project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100;
    const bands        = getStackBands(existing.stack);
    const anchorRawPSF = existing.sizeSqft > 0 ? existing.calculatedPrice / existing.sizeSqft : existing.calculatedPSF;
    await cascadeAbove(existing.stackId, existing.floor, anchorRawPSF, bands, roundingUnit);

    res.json(unit);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    next(err);
  }
});

export default router;
