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
      stackStartingPSF, stackStartingPSFLocked, stackIncrements, stackIncrementsLocked,
      typeCodeId,
    } = req.body;

    const stack = await prisma.stack.update({
      where: { id: req.params.id },
      data: {
        ...(stackNumber            !== undefined && { stackNumber: Number(stackNumber) }),
        ...(unitTypeCode           !== undefined && { unitTypeCode }),
        ...(bedroomType            !== undefined && { bedroomType }),
        ...(standardSizeSqft       !== undefined && { standardSizeSqft: Number(standardSizeSqft) }),
        ...(typeCodeId             !== undefined && { typeCodeId: typeCodeId || null }),
        ...(facing                 !== undefined && { facing: facing || null }),
        ...(notes                  !== undefined && { notes: notes || null }),
        ...(rankId                 !== undefined && { rankId: rankId || null }),
        ...(hasPenthouse           !== undefined && { hasPenthouse }),
        ...(penthouseUse           !== undefined && { penthouseUse: penthouseUse || null }),
        ...(penthouseSizeSqft      !== undefined && {
          penthouseSizeSqft: penthouseSizeSqft ? Number(penthouseSizeSqft) : null,
        }),
        ...(stackStartingFloor     !== undefined && {
          stackStartingFloor: stackStartingFloor != null && stackStartingFloor !== '' ? Number(stackStartingFloor) : null,
        }),
        ...(stackExcludedFloors    !== undefined && {
          stackExcludedFloors: stackExcludedFloors != null ? JSON.stringify(stackExcludedFloors) : null,
        }),
        ...(stackStartingPSF       !== undefined && {
          stackStartingPSF: stackStartingPSF != null ? Number(stackStartingPSF) : null,
        }),
        ...(stackStartingPSFLocked !== undefined && { stackStartingPSFLocked: Boolean(stackStartingPSFLocked) }),
        ...(stackIncrements        !== undefined && {
          stackIncrements: stackIncrements == null ? null
            : typeof stackIncrements === 'string' ? stackIncrements
            : JSON.stringify(stackIncrements),
        }),
        ...(stackIncrementsLocked  !== undefined && { stackIncrementsLocked: Boolean(stackIncrementsLocked) }),
      },
      include: { rank: { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } } },
    });
    res.json(stack);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Stack not found' });
    next(err);
  }
});

// POST /api/stacks/:id/regenerate
// Targeted in-place update: recalculates only finalPSF/finalPrice based on what changed.
// NEVER writes to calculatedPSF or calculatedPrice — those are owned by generate-units only.
router.post('/:id/regenerate', async (req, res, next) => {
  try {
    const stack = await prisma.stack.findUnique({
      where: { id: req.params.id },
      include: {
        rank: { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } },
        block: {
          include: {
            project: { include: { pricingParameters: true } },
          },
        },
        units: { orderBy: { floor: 'asc' } },
      },
    });
    if (!stack) return res.status(404).json({ error: 'Stack not found' });

    const startingPSFChanged = stack.stackStartingPSFLocked === true && stack.stackStartingPSF != null;
    const bandsChanged       = stack.stackIncrementsLocked === true;

    // Nothing to do — reset handles restoring calculatedPSF values separately
    if (!startingPSFChanged && !bandsChanged) {
      return res.json({ updatedCount: 0, units: stack.units });
    }

    const block        = stack.block;
    const project      = block.project;
    const params       = project.pricingParameters;
    const roundingUnit = params?.roundingUnit ?? project.roundingUnit ?? 100;

    // Custom bands if locked, otherwise fall back to rank defaults
    let effectiveIncs;
    if (bandsChanged && stack.stackIncrements) {
      try {
        effectiveIncs = JSON.parse(stack.stackIncrements).sort((a, b) => a.fromFloor - b.fromFloor);
      } catch {
        effectiveIncs = stack.rank?.floorIncrements ?? [];
      }
    } else {
      effectiveIncs = stack.rank?.floorIncrements ?? [];
    }

    function getBandIncrement(sortedIncs, floor) {
      const band = sortedIncs.find(fi => fi.fromFloor <= floor && floor <= fi.toFloor);
      return band ? (band.incrementPSF ?? 0) : 0;
    }

    const units = stack.units; // already ordered by floor
    if (units.length === 0) return res.json({ updatedCount: 0, units: [] });

    const updates    = [];
    let prevFinalPSF = null;

    for (const unit of units) {
      if (unit.isManualOverride) {
        prevFinalPSF = unit.finalPSF;
        continue;
      }

      let finalPrice, finalPSF;

      if (prevFinalPSF === null) {
        // First non-manual unit — the effective starting floor
        if (startingPSFChanged) {
          const rawPSF = stack.stackStartingPSF;
          finalPrice   = Math.round(rawPSF * unit.sizeSqft / roundingUnit) * roundingUnit;
          finalPSF     = unit.sizeSqft > 0 ? finalPrice / unit.sizeSqft : rawPSF;
        } else {
          // Only bands changed — preserve starting floor value, use as chain anchor
          prevFinalPSF = unit.finalPSF;
          continue;
        }
      } else {
        // Subsequent floor: chain from previous finalPSF + band increment
        const rawPSF = prevFinalPSF + getBandIncrement(effectiveIncs, unit.floor);
        finalPrice   = Math.round(rawPSF * unit.sizeSqft / roundingUnit) * roundingUnit;
        finalPSF     = unit.sizeSqft > 0 ? finalPrice / unit.sizeSqft : rawPSF;
      }

      updates.push({ id: unit.id, finalPSF, finalPrice });
      prevFinalPSF = finalPSF;
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(u => prisma.unit.update({
          where: { id: u.id },
          data:  { finalPSF: u.finalPSF, finalPrice: u.finalPrice },
        }))
      );
    }

    const allUnits = await prisma.unit.findMany({
      where:   { stackId: stack.id },
      orderBy: { floor: 'asc' },
    });

    res.json({ updatedCount: updates.length, units: allUnits });
  } catch (err) {
    next(err);
  }
});

// POST /api/stacks/:id/reset
// Clear custom stack overrides and restore non-manual units to their stored calculated values.
router.post('/:id/reset', async (req, res, next) => {
  try {
    // 1. Clear all custom flags on the stack
    await prisma.stack.update({
      where: { id: req.params.id },
      data: {
        stackStartingPSF:       null,
        stackStartingPSFLocked: false,
        stackIncrements:        null,
        stackIncrementsLocked:  false,
      },
    });

    // 2. Restore all non-manual-override units to their stored calculatedPSF/calculatedPrice
    const units = await prisma.unit.findMany({
      where: { stackId: req.params.id },
    });

    for (const unit of units) {
      if (unit.isManualOverride) continue;
      await prisma.unit.update({
        where: { id: unit.id },
        data: {
          finalPSF:   unit.calculatedPSF,
          finalPrice: unit.calculatedPrice,
        },
      });
    }

    // 3. Return updated units
    const updatedUnits = await prisma.unit.findMany({
      where:   { stackId: req.params.id },
      orderBy: { floor: 'asc' },
    });

    res.json({ resetCount: units.length, units: updatedUnits });
  } catch (err) {
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
