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

// ─── POST /api/projects/:id/generate-units ────────────────────────────────────
// Generate (or regenerate) all Unit records for a project
router.post('/:id/generate-units', async (req, res, next) => {
  try {
    const { id: projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        pricingParameters: true,
        blocks: {
          include: {
            stacks: {
              include: {
                rank: { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } },
              },
            },
          },
          orderBy: { blockName: 'asc' },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const roundingUnit       = project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100;
    const penthouseMult      = project.pricingParameters?.penthouseMultiplier ?? 1.0;

    // ── Delete all existing units for this project in one shot ────────────────
    const existingStacks = await prisma.stack.findMany({
      where: { block: { projectId } },
      select: { id: true },
    });
    if (existingStacks.length > 0) {
      await prisma.unit.deleteMany({
        where: { stackId: { in: existingStacks.map(s => s.id) } },
      });
    }

    // ── Build units ───────────────────────────────────────────────────────────
    const unitsToCreate = [];
    const byBlock       = [];

    function roundTo(value, unit) {
      return Math.round(value / unit) * unit;
    }

    for (const block of project.blocks) {
      let blockUnitCount  = 0;
      const blockExcluded = new Set(JSON.parse(block.excludedFloors || '[]'));
      const maxFloor      = block.startingFloor + block.totalStoreys - 1;

      for (const stack of block.stacks) {
        const stackExcluded  = new Set(JSON.parse(stack.stackExcludedFloors || '[]'));
        const combinedExcl   = new Set([...blockExcluded, ...stackExcluded]);
        const effectiveStart = stack.stackStartingFloor ?? block.startingFloor;

        // Collect valid floors in ascending order
        const validFloors = [];
        for (let f = effectiveStart; f <= maxFloor; f++) {
          if (!combinedExcl.has(f)) validFloors.push(f);
        }
        if (validFloors.length === 0) continue;

        const rank        = stack.rank;
        const basePSF     = rank?.basePSF ?? 0;
        const increments  = rank?.floorIncrements ?? [];
        const stackNumStr = stack.stackNumber.toString().padStart(2, '0');

        let prevCalcPSF   = null;  // cumulative PSF carried floor-to-floor
        let prevCalcPrice = null;  // price of previous floor (for penthouse premium base)

        for (let idx = 0; idx < validFloors.length; idx++) {
          const floor       = validFloors[idx];
          const isTop       = idx === validFloors.length - 1;
          const isPenthouse = isTop && stack.hasPenthouse && stack.penthouseSizeSqft > 0;

          // Increment for this specific floor (from whichever band covers it, or 0)
          const incrPSF = increments
            .filter(fi => fi.fromFloor <= floor && floor <= fi.toFloor)
            .reduce((s, fi) => s + fi.incrementPSF, 0);

          // First floor = basePSF (no increment); each subsequent floor adds its increment
          const calcPSF   = prevCalcPSF === null ? basePSF : prevCalcPSF + incrPSF;
          const calcPrice = roundTo(calcPSF * stack.standardSizeSqft, roundingUnit);

          let sizeSqft, finalPSF, finalPrice;

          if (isPenthouse) {
            sizeSqft = stack.penthouseSizeSqft;
            const priceBelow = prevCalcPrice ?? calcPrice;
            const premium    = basePSF * penthouseMult * (stack.penthouseSizeSqft - stack.standardSizeSqft);
            finalPrice       = roundTo(priceBelow + premium, roundingUnit);
            finalPSF         = sizeSqft > 0 ? finalPrice / sizeSqft : 0;
          } else {
            sizeSqft   = stack.standardSizeSqft;
            finalPSF   = calcPSF;
            finalPrice = calcPrice;
          }

          unitsToCreate.push({
            stackId:         stack.id,
            unitNumber:      `#${floor.toString().padStart(2, '0')}-${stackNumStr}`,
            floor,
            sizeSqft,
            isPenthouse,
            calculatedPSF:   calcPSF,
            calculatedPrice: calcPrice,
            finalPSF,
            finalPrice,
            isManualOverride: false,
          });

          prevCalcPSF   = calcPSF;
          prevCalcPrice = calcPrice;
          blockUnitCount++;
        }
      }

      byBlock.push({ blockName: block.blockName, unitCount: blockUnitCount });
    }

    // ── Bulk insert ───────────────────────────────────────────────────────────
    await prisma.unit.createMany({ data: unitsToCreate });

    res.json({ totalUnits: unitsToCreate.length, byBlock });
  } catch (err) {
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
