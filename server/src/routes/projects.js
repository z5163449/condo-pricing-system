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

// ─── GET /api/projects/:id/pricing-parameters ────────────────────────────────
router.get('/:id/pricing-parameters', async (req, res, next) => {
  try {
    const params = await prisma.pricingParameters.findUnique({
      where: { projectId: req.params.id },
    });
    res.json(params ?? null);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/projects/:id/pricing-parameters ─────────────────────────────────
router.put('/:id/pricing-parameters', async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const {
      targetOverallAvgPSF,
      targetBedroomPSF,
      penthouseMultiplier,
      roundingUnit,
    } = req.body;

    const data = {
      ...(targetOverallAvgPSF !== undefined && { targetOverallAvgPSF: targetOverallAvgPSF != null ? Number(targetOverallAvgPSF) : null }),
      ...(targetBedroomPSF   !== undefined && { targetBedroomPSF: typeof targetBedroomPSF === 'string' ? targetBedroomPSF : JSON.stringify(targetBedroomPSF) }),
      ...(penthouseMultiplier !== undefined && { penthouseMultiplier: Number(penthouseMultiplier) }),
      ...(roundingUnit        !== undefined && { roundingUnit:        Number(roundingUnit) }),
    };

    const params = await prisma.pricingParameters.upsert({
      where:  { projectId },
      update: data,
      create: { projectId, ...data },
    });
    res.json(params);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects/:id/generate-units ────────────────────────────────────
// Auto-solver: works backwards from target PSF parameters to generate optimal pricing
router.post('/:id/generate-units', async (req, res, next) => {
  try {
    const { id: projectId } = req.params;

    // ── Step 1: Load all data ─────────────────────────────────────────────────
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
        ranks: {
          include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } },
          orderBy: { rankNumber: 'asc' },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const params       = project.pricingParameters;
    const roundingUnit = params?.roundingUnit ?? project.roundingUnit ?? 100;
    const penthouseMult = params?.penthouseMultiplier ?? 1.0;
    const targetOverallAvgPSF = params?.targetOverallAvgPSF ?? null;

    // ── Validate: targetOverallAvgPSF must be set ─────────────────────────────
    if (targetOverallAvgPSF == null || targetOverallAvgPSF <= 0) {
      return res.status(400).json({ error: 'Please set an overall target avg PSF in pricing parameters before generating' });
    }

    // ── Validate: rank band coverage (only for ranks with bands defined) ──────
    if (project.blocks.length > 0) {
      const projMinFloor = Math.min(...project.blocks.map(b => b.startingFloor));
      const projMaxFloor = Math.max(...project.blocks.map(b => b.startingFloor + b.totalStoreys - 1));
      for (const rank of project.ranks) {
        if (rank.floorIncrements.length === 0) continue;
        const sorted = [...rank.floorIncrements].sort((a, b) => a.fromFloor - b.fromFloor);
        const uncovered = [];
        let expected = projMinFloor;
        for (const band of sorted) {
          for (let f = expected; f < band.fromFloor; f++) uncovered.push(f);
          expected = Math.max(expected, band.toFloor + 1);
        }
        for (let f = expected; f <= projMaxFloor; f++) uncovered.push(f);
        if (uncovered.length > 0) {
          const display = uncovered.length > 8
            ? `${uncovered.slice(0, 8).join(', ')} and ${uncovered.length - 8} more`
            : uncovered.join(', ');
          return res.status(400).json({ error: `Rank "${rank.labelEn}": floor bands have gaps — floors not covered: ${display}` });
        }
      }
    }

    // ── Full reset: clear all custom stack adjustments and manual overrides ─────
    await prisma.stack.updateMany({
      where: { block: { projectId } },
      data: {
        stackStartingPSF:       null,
        stackStartingPSFLocked: false,
        stackIncrements:        null,
        stackIncrementsLocked:  false,
      },
    });
    await prisma.unit.updateMany({
      where: { stack: { block: { projectId } } },
      data: { isManualOverride: false, cumulativeAdjustment: 1.0 },
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function parseExcl(str) {
      try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
    }
    function roundTo(value, unit) {
      return Math.round(value / unit) * unit;
    }
    // Returns the incrementPSF for the single band that owns `floor`.
    // Bands are pre-sorted by fromFloor (Prisma orderBy). Upper boundary is
    // exclusive for every band except the last, preventing a shared boundary
    // floor from being counted in two bands simultaneously.
    function getBandIncrement(sortedIncrements, floor) {
      const band = sortedIncrements.find(fi => fi.fromFloor <= floor && floor <= fi.toFloor);
      return band ? (band.incrementPSF ?? 0) : 0;
    }
    function countValidFloors(block, stack) {
      const blockExcl  = parseExcl(block.excludedFloors);
      const stackExcl  = parseExcl(stack.stackExcludedFloors);
      const combined   = new Set([...blockExcl, ...stackExcl]);
      const start      = stack.stackStartingFloor ?? block.startingFloor;
      const maxFloor   = block.startingFloor + block.totalStoreys - 1;
      let count = 0;
      for (let f = start; f <= maxFloor; f++) {
        if (!combined.has(f)) count++;
      }
      return count;
    }

    // ── Pre-compute unit counts per rank ──────────────────────────────────────
    // rankUnitCounts:    { rankId → totalValidFloors }
    // rankBedroomCounts: { rankId → { bedroomType → count } }
    const rankUnitCounts    = {};
    const rankBedroomCounts = {};
    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        if (!stack.rankId) continue;
        const n = countValidFloors(block, stack);
        if (n === 0) continue;
        rankUnitCounts[stack.rankId] = (rankUnitCounts[stack.rankId] || 0) + n;
        if (!rankBedroomCounts[stack.rankId]) rankBedroomCounts[stack.rankId] = {};
        const br = stack.bedroomType || 'Unknown';
        rankBedroomCounts[stack.rankId][br] = (rankBedroomCounts[stack.rankId][br] || 0) + n;
      }
    }

    // ── Build bedroom target map ──────────────────────────────────────────────
    const brTargetMap = {};
    if (params) {
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMap[k] = Number(v);
        }
      } catch { /* ignore */ }
    }

    // ── Step 2: Target avg PSF per rank ──────────────────────────────────────
    // Unit-count-weighted blend of bedroom type PSF targets for this rank's bedroom
    // mix. Falls back to targetOverallAvgPSF (then 0) if no bedroom targets apply.
    const targetRankAvgPSFs = {};  // rankId → target avg PSF

    for (const rank of project.ranks) {
      const brCounts   = rankBedroomCounts[rank.id] || {};
      const totalCount = Object.values(brCounts).reduce((s, c) => s + c, 0);

      let targetRankAvgPSF = targetOverallAvgPSF ?? 0;
      if (totalCount > 0 && Object.keys(brTargetMap).length > 0) {
        const hasTarget = Object.keys(brCounts).some(br => brTargetMap[br]);
        if (hasTarget) {
          let wt = 0;
          for (const [br, count] of Object.entries(brCounts)) {
            wt += (brTargetMap[br] ?? targetOverallAvgPSF ?? 0) * count;
          }
          targetRankAvgPSF = wt / totalCount;
        }
      }
      targetRankAvgPSFs[rank.id] = targetRankAvgPSF;
    }

    // ── Step 3: Solve startingPSF per rank ──────────────────────────────────
    // startingPSF is the PSF at the lowest valid floor such that the arithmetic
    // mean of (startingPSF + cumulative band offsets) across all valid floors
    // equals the rank's target avg PSF.
    //   startingPSF = target − avgCumulativeOffset
    // avgCumulativeOffset = mean of per-floor cumulative increments (floor[0] = 0)
    // across every stack in the rank.
    const solvedStartingPSFs = {};  // rankId → PSF at floor-0 of each stack

    for (const rank of project.ranks) {
      const target = targetRankAvgPSFs[rank.id] ?? 0;

      if (rank.floorIncrements.length > 0) {
        let totalOffsetSum = 0, totalUnitCount = 0;
        for (const block of project.blocks) {
          const blockExcl = parseExcl(block.excludedFloors);
          const maxFloor  = block.startingFloor + block.totalStoreys - 1;
          for (const stack of block.stacks) {
            if (stack.rankId !== rank.id) continue;
            const stackExcl   = parseExcl(stack.stackExcludedFloors);
            const combined    = new Set([...blockExcl, ...stackExcl]);
            const start       = stack.stackStartingFloor ?? block.startingFloor;
            const validFloors = [];
            for (let f = start; f <= maxFloor; f++) {
              if (!combined.has(f)) validFloors.push(f);
            }
            let cumOffset = 0;
            for (let idx = 0; idx < validFloors.length; idx++) {
              if (idx > 0) {
                cumOffset += getBandIncrement(rank.floorIncrements, validFloors[idx]);
              }
              totalOffsetSum += cumOffset;
              totalUnitCount++;
            }
          }
        }
        const avgOffset = totalUnitCount > 0 ? totalOffsetSum / totalUnitCount : 0;
        solvedStartingPSFs[rank.id] = target - avgOffset;
      } else {
        // No bands — all floors get the same PSF = target
        solvedStartingPSFs[rank.id] = target;
      }
    }

    // ── Step 5: Preserve manual overrides, delete generated units ────────────
    const rankRevenue = {};  // rankId → { revenue, sqft } for per-rank accuracy check

    const allStackIds = project.blocks.flatMap(b => b.stacks.map(s => s.id));
    const manualUnits = allStackIds.length > 0
      ? await prisma.unit.findMany({
          where: { stackId: { in: allStackIds }, isManualOverride: true },
        })
      : [];
    const manualUnitMap = new Map(manualUnits.map(u => [`${u.stackId}-${u.floor}`, u]));

    if (allStackIds.length > 0) {
      await prisma.unit.deleteMany({
        where: { stackId: { in: allStackIds }, isManualOverride: false },
      });
    }

    const unitsToCreate = [];
    const byBlock       = [];
    const brFinalPSFSum = {};  // bedroomType → { sum, count }
    const blockSummary  = {};  // blockName → { sum, count }

    for (const block of project.blocks) {
      let blockUnitCount = 0;
      const blockExcl    = parseExcl(block.excludedFloors);
      const maxFloor     = block.startingFloor + block.totalStoreys - 1;

      for (const stack of block.stacks) {
        const stackExcl      = parseExcl(stack.stackExcludedFloors);
        const combinedExcl   = new Set([...blockExcl, ...stackExcl]);
        const effectiveStart = stack.stackStartingFloor ?? block.startingFloor;

        const validFloors = [];
        for (let f = effectiveStart; f <= maxFloor; f++) {
          if (!combinedExcl.has(f)) validFloors.push(f);
        }
        if (validFloors.length === 0) continue;

        const rank        = stack.rank;
        const rankId      = stack.rankId;
        const increments  = rank?.floorIncrements ?? [];
        const stackNumStr = stack.stackNumber.toString().padStart(2, '0');

        const solvedStart = rankId ? (solvedStartingPSFs[rankId] ?? 0) : 0;
        const startingPSF = stack.stackStartingPSFLocked && stack.stackStartingPSF != null
          ? stack.stackStartingPSF
          : solvedStart;

        let prevCalcPSF   = null;
        let prevCalcPrice = null;

        for (let idx = 0; idx < validFloors.length; idx++) {
          const floor       = validFloors[idx];
          const isTop       = idx === validFloors.length - 1;
          const isPenthouse = isTop && stack.hasPenthouse && (stack.penthouseSizeSqft ?? 0) > 0;

          const calcPSF   = prevCalcPSF === null
            ? startingPSF
            : prevCalcPSF + getBandIncrement(increments, floor);
          const calcPrice = roundTo(calcPSF * stack.standardSizeSqft, roundingUnit);

          // If this floor has a manual override, preserve it and keep the chain going
          const manualKey      = `${stack.id}-${floor}`;
          const existingManual = manualUnitMap.get(manualKey);
          if (existingManual) {
            unitsToCreate.push({ ...existingManual, _isManual: true });
            const brM = stack.bedroomType || 'Unknown';
            if (!brFinalPSFSum[brM]) brFinalPSFSum[brM] = { sum: 0, count: 0 };
            brFinalPSFSum[brM].sum   += existingManual.finalPSF ?? 0;
            brFinalPSFSum[brM].count += 1;
            if (!blockSummary[block.blockName]) blockSummary[block.blockName] = { sum: 0, count: 0 };
            blockSummary[block.blockName].sum   += existingManual.finalPSF ?? 0;
            blockSummary[block.blockName].count += 1;
            prevCalcPSF   = existingManual.finalPSF ?? calcPSF;
            prevCalcPrice = existingManual.finalPrice ?? calcPrice;
            blockUnitCount++;
            continue;
          }

          // Back-calculate PSF from the rounded price so stored PSF and price are consistent
          const calcPSFRounded = stack.standardSizeSqft > 0 ? calcPrice / stack.standardSizeSqft : calcPSF;

          let sizeSqft, finalPSF, finalPrice;
          if (isPenthouse) {
            sizeSqft = stack.penthouseSizeSqft;
            const priceBelow = prevCalcPrice ?? calcPrice;
            const premium    = startingPSF * penthouseMult * ((stack.penthouseSizeSqft ?? 0) - stack.standardSizeSqft);
            finalPrice = roundTo(priceBelow + premium, roundingUnit);
            finalPSF   = sizeSqft > 0 ? finalPrice / sizeSqft : 0;
          } else {
            sizeSqft   = stack.standardSizeSqft;
            finalPrice = calcPrice;
            finalPSF   = calcPSFRounded;
          }

          unitsToCreate.push({
            stackId:          stack.id,
            unitNumber:       `#${floor.toString().padStart(2, '0')}-${stackNumStr}`,
            floor,
            sizeSqft,
            isPenthouse,
            calculatedPSF:    finalPSF,
            calculatedPrice:  finalPrice,
            finalPSF,
            finalPrice,
            isManualOverride: false,
          });

          const br = stack.bedroomType || 'Unknown';
          if (!brFinalPSFSum[br]) brFinalPSFSum[br] = { sum: 0, count: 0 };
          brFinalPSFSum[br].sum   += finalPSF ?? 0;
          brFinalPSFSum[br].count += 1;
          if (!blockSummary[block.blockName]) blockSummary[block.blockName] = { sum: 0, count: 0 };
          blockSummary[block.blockName].sum   += finalPSF ?? 0;
          blockSummary[block.blockName].count += 1;
          if (rankId) {
            if (!rankRevenue[rankId]) rankRevenue[rankId] = { revenue: 0, sqft: 0 };
            rankRevenue[rankId].revenue += (finalPSF ?? 0) * sizeSqft;
            rankRevenue[rankId].sqft    += sizeSqft;
          }

          prevCalcPSF   = calcPSF;       // keep raw for next floor's increment chain
          prevCalcPrice = calcPrice;
          blockUnitCount++;
        }
      }

      byBlock.push({
        blockName:      block.blockName,
        unitCount:      blockUnitCount,
        achievedAvgPSF: blockSummary[block.blockName]?.count > 0
          ? blockSummary[block.blockName].sum / blockSummary[block.blockName].count
          : null,
      });
    }

    // ── Step 7: Correction pass ───────────────────────────────────────────────
    // Iteratively shift all non-locked, non-manual units by (target − achieved)
    // until the overall sqft-weighted avg PSF is within ±$1 of the target.
    const lockedStackIds = new Set(
      project.blocks.flatMap(b =>
        b.stacks.filter(s => s.stackStartingPSFLocked).map(s => s.id)
      )
    );

    let correctionWarning = null;
    const MAX_ITERATIONS  = 20;
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      const nonManual    = unitsToCreate.filter(u => !u.isManualOverride);
      const totalRevenue = nonManual.reduce((sum, u) => sum + u.finalPrice, 0);
      const totalSqft    = nonManual.reduce((sum, u) => sum + u.sizeSqft, 0);
      if (totalSqft === 0) break;
      const achievedAvg = totalRevenue / totalSqft;

      const diff = targetOverallAvgPSF - achievedAvg;
      if (Math.abs(diff) <= 1) break;

      for (const unit of unitsToCreate) {
        if (unit.isManualOverride || lockedStackIds.has(unit.stackId)) continue;
        const newPrice       = Math.round((unit.finalPSF + diff) * unit.sizeSqft / roundingUnit) * roundingUnit;
        unit.finalPrice      = newPrice;
        unit.finalPSF        = newPrice / unit.sizeSqft;
        unit.calculatedPSF   = unit.finalPSF;
        unit.calculatedPrice = unit.finalPrice;
      }

      iteration++;
    }

    {
      const nonManual     = unitsToCreate.filter(u => !u.isManualOverride);
      const totalSqft     = nonManual.reduce((s, u) => s + u.sizeSqft, 0);
      const finalAchieved = totalSqft > 0
        ? nonManual.reduce((s, u) => s + u.finalPrice, 0) / totalSqft
        : 0;
      if (totalSqft > 0 && Math.abs(finalAchieved - targetOverallAvgPSF) > 1) {
        correctionWarning = `Cannot reach target within ±$1. Achieved: $${Math.round(finalAchieved)}, Target: $${targetOverallAvgPSF}`;
      }
    }

    // Skip manual override units (already in DB), strip temp field
    await prisma.unit.createMany({
      data: unitsToCreate
        .filter(u => !u._isManual)
        .map(({ _isManual, ...u }) => u),
    });

    // ── Auto-create / overwrite "Base (Auto-generated)" scenario ─────────────
    {
      const freshUnits = await prisma.unit.findMany({
        where:  { stack: { block: { projectId } } },
        select: {
          id: true, floor: true, stackId: true,
          unitNumber: true, sizeSqft: true,
          finalPSF: true, finalPrice: true, isManualOverride: true,
        },
      });
      const baseSnapshots = freshUnits
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

      const existingBase = await prisma.pricingScenario.findFirst({
        where: { projectId, isBase: true },
      });
      if (existingBase) {
        await prisma.unitSnapshot.deleteMany({ where: { scenarioId: existingBase.id } });
        await prisma.unitSnapshot.createMany({
          data: baseSnapshots.map(s => ({ ...s, scenarioId: existingBase.id })),
        });
        await prisma.pricingScenario.update({
          where: { id: existingBase.id },
          data:  { updatedAt: new Date() },
        });
      } else {
        await prisma.pricingScenario.create({
          data: {
            projectId,
            name:     'Base (Auto-generated)',
            isBase:   true,
            isLocked: false,
            snapshots: { create: baseSnapshots },
          },
        });
      }
    }

    // ── Step 6: Build solver summary ──────────────────────────────────────────
    const totalSqftFinal = unitsToCreate.reduce((s, u) => s + u.sizeSqft, 0);
    const achievedOverallAvgPSF = totalSqftFinal > 0
      ? unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0) * u.sizeSqft, 0) / totalSqftFinal
      : null;

    const brTargetMapSummary = {};
    if (params) {
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMapSummary[k] = Number(v);
        }
      } catch { /* ignore */ }
    }

    const byBedroomType = Object.entries(brFinalPSFSum).map(([type, { sum, count }]) => ({
      type,
      targetPSF:   brTargetMapSummary[type] ?? null,
      achievedPSF: count > 0 ? sum / count : null,
      unitCount:   count,
    }));

    const byRank = project.ranks.map(r => ({
      rankLabel:   r.labelEn,
      startingPSF: solvedStartingPSFs[r.id] ?? null,
      unitCount:   rankUnitCounts[r.id] || 0,
    }));

    res.json({
      totalUnits: unitsToCreate.length,
      manualOverrideCount: manualUnits.length,
      achievedOverallAvgPSF,
      targetOverallAvgPSF,
      byBedroomType,
      byRank,
      byBlock,
      correctionWarning,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects/:id/adjust/preview ───────────────────────────────────
// Dry-run of adjust: returns projected avg PSFs without writing to the DB.
router.post('/:id/adjust/preview', async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { scope, adjustments } = req.body;

    if (!scope || !adjustments || typeof adjustments !== 'object') {
      return res.status(400).json({ error: 'scope and adjustments are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        pricingParameters: true,
        blocks: {
          include: {
            stacks: { include: { units: true } },
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const roundingUnit = project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100;

    const current   = [];
    const projected = [];
    let affectedCount = 0;

    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        for (const unit of stack.units) {
          if (unit.calculatedPrice == null || unit.sizeSqft == null || unit.sizeSqft <= 0) continue;
          if (unit.finalPrice == null) continue;

          const base = {
            finalPrice:  unit.finalPrice,
            sizeSqft:    unit.sizeSqft,
            bedroomType: stack.bedroomType || 'Unknown',
            blockId:     block.id,
            blockName:   block.blockName,
          };
          current.push(base);

          let pct = null;
          switch (scope) {
            case 'all':
              pct = adjustments['all'] != null ? Number(adjustments['all']) : null;
              break;
            case 'bedroomType':
              pct = stack.bedroomType && adjustments[stack.bedroomType] != null
                ? Number(adjustments[stack.bedroomType]) : null;
              break;
            case 'block':
              pct = adjustments[block.id] != null ? Number(adjustments[block.id]) : null;
              break;
            case 'rank':
              pct = stack.rankId && adjustments[stack.rankId] != null
                ? Number(adjustments[stack.rankId]) : null;
              break;
            case 'typeCode':
              pct = stack.unitTypeCode && adjustments[stack.unitTypeCode] != null
                ? Number(adjustments[stack.unitTypeCode]) : null;
              break;
          }

          if (pct != null && isFinite(pct) && pct !== 0) {
            const newFactor = (unit.cumulativeAdjustment ?? 1.0) * (1 + pct / 100);
            const projPrice = Math.round(unit.calculatedPrice * newFactor / roundingUnit) * roundingUnit;
            projected.push({ ...base, finalPrice: projPrice });
            affectedCount++;
          } else {
            projected.push({ ...base });
          }
        }
      }
    }

    function wAvgPSF(data) {
      const rev  = data.reduce((s, u) => s + u.finalPrice, 0);
      const sqft = data.reduce((s, u) => s + u.sizeSqft,  0);
      return sqft > 0 ? rev / sqft : null;
    }

    function groupPSF(data, keyField, nameField) {
      const m = {};
      for (const u of data) {
        const k = u[keyField];
        if (!m[k]) m[k] = { name: u[nameField], rev: 0, sqft: 0 };
        m[k].rev  += u.finalPrice;
        m[k].sqft += u.sizeSqft;
      }
      return m;
    }

    const curBR  = groupPSF(current,   'bedroomType', 'bedroomType');
    const projBR = groupPSF(projected, 'bedroomType', 'bedroomType');
    const byBedroomType = Object.keys(curBR).sort().map(br => ({
      type:         br,
      currentPSF:   curBR[br].sqft  > 0 ? curBR[br].rev  / curBR[br].sqft  : null,
      projectedPSF: projBR[br]?.sqft > 0 ? projBR[br].rev / projBR[br].sqft : null,
    }));

    const curBlk  = groupPSF(current,   'blockId', 'blockName');
    const projBlk = groupPSF(projected, 'blockId', 'blockName');
    const byBlock = Object.keys(curBlk)
      .sort((a, b) => curBlk[a].name.localeCompare(curBlk[b].name, undefined, { numeric: true }))
      .map(id => ({
        blockName:    curBlk[id].name,
        currentPSF:   curBlk[id].sqft  > 0 ? curBlk[id].rev  / curBlk[id].sqft  : null,
        projectedPSF: projBlk[id]?.sqft > 0 ? projBlk[id].rev / projBlk[id].sqft : null,
      }));

    res.json({
      overall: {
        currentAvgPSF:   wAvgPSF(current),
        projectedAvgPSF: wAvgPSF(projected),
      },
      byBedroomType,
      byBlock,
      affectedCount,
      totalCount: current.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects/:id/adjust ───────────────────────────────────────────
// Apply a % adjustment to finalPSF/finalPrice for non-manual units.
// scope: "all" | "bedroomType" | "block" | "rank" | "typeCode"
// adjustments: { [key]: number }  e.g. { "all": 2.5 } or { "2BR": 1.5, "3BR": 2.0 }
// NEVER writes to calculatedPSF or calculatedPrice. NEVER touches manual-override units.
router.post('/:id/adjust', async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { scope, adjustments } = req.body;

    if (!scope || !adjustments || typeof adjustments !== 'object') {
      return res.status(400).json({ error: 'scope and adjustments are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        pricingParameters: true,
        blocks: {
          include: {
            stacks: { include: { units: true } },
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const roundingUnit = project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100;

    const updates = [];
    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        for (const unit of stack.units) {
          if (unit.calculatedPrice == null || unit.sizeSqft == null || unit.sizeSqft <= 0) continue;

          let pct = null;
          switch (scope) {
            case 'all':
              pct = adjustments['all'] != null ? Number(adjustments['all']) : null;
              break;
            case 'bedroomType':
              pct = stack.bedroomType && adjustments[stack.bedroomType] != null
                ? Number(adjustments[stack.bedroomType]) : null;
              break;
            case 'block':
              pct = adjustments[block.id] != null ? Number(adjustments[block.id]) : null;
              break;
            case 'rank':
              pct = stack.rankId && adjustments[stack.rankId] != null
                ? Number(adjustments[stack.rankId]) : null;
              break;
            case 'typeCode':
              pct = stack.unitTypeCode && adjustments[stack.unitTypeCode] != null
                ? Number(adjustments[stack.unitTypeCode]) : null;
              break;
          }

          if (pct == null || !isFinite(pct) || pct === 0) continue;

          const newFactor     = (unit.cumulativeAdjustment ?? 1.0) * (1 + pct / 100);
          const newFinalPrice = Math.round(unit.calculatedPrice * newFactor / roundingUnit) * roundingUnit;
          const newFinalPSF   = newFinalPrice / unit.sizeSqft;
          updates.push({
            id: unit.id, finalPSF: newFinalPSF, finalPrice: newFinalPrice,
            cumulativeAdjustment: newFactor,
            sizeSqft: unit.sizeSqft, bedroomType: stack.bedroomType, blockId: block.id, blockName: block.blockName,
          });
        }
      }
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(u => prisma.unit.update({
          where: { id: u.id },
          data:  { finalPSF: u.finalPSF, finalPrice: u.finalPrice, cumulativeAdjustment: u.cumulativeAdjustment },
        }))
      );
    }

    // Build summary from in-memory updated values (avoids a second DB round-trip)
    const updateMap = new Map(updates.map(u => [u.id, u]));
    const allData = [];
    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        for (const unit of stack.units) {
          const upd = updateMap.get(unit.id);
          allData.push({
            finalPrice:  upd ? upd.finalPrice  : unit.finalPrice,
            sizeSqft:    unit.sizeSqft,
            bedroomType: stack.bedroomType || 'Unknown',
            blockId:     block.id,
            blockName:   block.blockName,
          });
        }
      }
    }

    const priced     = allData.filter(u => u.finalPrice != null && u.sizeSqft > 0);
    const totalRev   = priced.reduce((s, u) => s + u.finalPrice, 0);
    const totalSqft  = priced.reduce((s, u) => s + u.sizeSqft, 0);
    const achievedOverallAvgPSF = totalSqft > 0 ? totalRev / totalSqft : null;

    const brMap = {};
    for (const u of priced) {
      const br = u.bedroomType;
      if (!brMap[br]) brMap[br] = { revenue: 0, sqft: 0, count: 0 };
      brMap[br].revenue += u.finalPrice;
      brMap[br].sqft    += u.sizeSqft;
      brMap[br].count++;
    }
    const byBedroomType = Object.entries(brMap).map(([type, { revenue, sqft, count }]) => ({
      type, achievedPSF: sqft > 0 ? revenue / sqft : null, unitCount: count,
    }));

    const blkMap = {};
    for (const u of priced) {
      if (!blkMap[u.blockId]) blkMap[u.blockId] = { blockName: u.blockName, revenue: 0, sqft: 0, count: 0 };
      blkMap[u.blockId].revenue += u.finalPrice;
      blkMap[u.blockId].sqft    += u.sizeSqft;
      blkMap[u.blockId].count++;
    }
    const byBlock = Object.entries(blkMap).map(([, { blockName, revenue, sqft, count }]) => ({
      blockName, achievedPSF: sqft > 0 ? revenue / sqft : null, unitCount: count,
    }));

    res.json({ updatedCount: updates.length, achievedOverallAvgPSF, byBedroomType, byBlock });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/projects/:id/stacks/bulk-update ──────────────────────────────
// Update stackStartingPSF / stackIncrements on all stacks matching rankId + typeCode.
router.patch('/:id/stacks/bulk-update', async (req, res, next) => {
  try {
    const { rankId, typeCode, stackStartingPSF, stackStartingPSFLocked, stackIncrements, stackIncrementsLocked } = req.body;
    if (!rankId || !typeCode) {
      return res.status(400).json({ error: 'rankId and typeCode are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        blocks: {
          include: {
            stacks: { where: { rankId, unitTypeCode: typeCode } },
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const stackIds = project.blocks.flatMap(b => b.stacks.map(s => s.id));
    if (stackIds.length === 0) {
      return res.json({ updatedCount: 0, stackIds: [] });
    }

    const incrementsValue = stackIncrements == null ? null
      : typeof stackIncrements === 'string' ? stackIncrements
      : JSON.stringify(stackIncrements);

    await prisma.stack.updateMany({
      where: { id: { in: stackIds } },
      data: {
        ...(stackStartingPSF       !== undefined && {
          stackStartingPSF: stackStartingPSF != null ? Number(stackStartingPSF) : null,
        }),
        ...(stackStartingPSFLocked !== undefined && { stackStartingPSFLocked: Boolean(stackStartingPSFLocked) }),
        ...(stackIncrements        !== undefined && { stackIncrements: incrementsValue }),
        ...(stackIncrementsLocked  !== undefined && { stackIncrementsLocked: Boolean(stackIncrementsLocked) }),
      },
    });

    res.json({ updatedCount: stackIds.length, stackIds });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/projects/:id/recalculate-above ───────────────────────────────
// After a manual override, recalculate all non-overridden units above that floor
// in the same stack, using the override's finalPSF as the new chain anchor.
router.patch('/:id/recalculate-above', async (req, res, next) => {
  try {
    const { stackId, fromFloor } = req.body;
    if (!stackId || fromFloor == null) {
      return res.status(400).json({ error: 'stackId and fromFloor are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
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
        },
        ranks: { include: { floorIncrements: { orderBy: { fromFloor: 'asc' } } } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const targetBlock = project.blocks.find(b => b.stacks.some(s => s.id === stackId));
    const targetStack = targetBlock?.stacks.find(s => s.id === stackId);
    if (!targetStack) return res.status(404).json({ error: 'Stack not found' });

    const rank = targetStack.rank;
    if (!rank || rank.floorIncrements.length === 0) {
      return res.json({ updatedCount: 0 });
    }

    const params       = project.pricingParameters;
    const roundingUnit = params?.roundingUnit ?? project.roundingUnit ?? 100;

    // Re-derive targetRankAvgPSF (same logic as generate-units Step 2)
    const targetOverallAvgPSF = params?.targetOverallAvgPSF ?? null;
    const brTargetMap = {};
    if (params) {
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMap[k] = Number(v);
        }
      } catch { /* ignore */ }
    }

    function parseExclR(str) {
      try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
    }
    function getBandIncrementR(sortedIncrements, floor) {
      const band = sortedIncrements.find(fi => fi.fromFloor <= floor && floor <= fi.toFloor);
      return band ? (band.incrementPSF ?? 0) : 0;
    }

    // Count units per bedroom type for this rank (to compute targetRankAvgPSF)
    const brCounts = {};
    let totalCount = 0;
    for (const blk of project.blocks) {
      const blockExcl = parseExclR(blk.excludedFloors);
      const maxFloor  = blk.startingFloor + blk.totalStoreys - 1;
      for (const stk of blk.stacks) {
        if (stk.rankId !== rank.id) continue;
        const stackExcl = parseExclR(stk.stackExcludedFloors);
        const combined  = new Set([...blockExcl, ...stackExcl]);
        const start     = stk.stackStartingFloor ?? blk.startingFloor;
        let n = 0;
        for (let f = start; f <= maxFloor; f++) if (!combined.has(f)) n++;
        if (n === 0) continue;
        const br = stk.bedroomType || 'Unknown';
        brCounts[br] = (brCounts[br] || 0) + n;
        totalCount  += n;
      }
    }

    let targetRankAvgPSF = targetOverallAvgPSF ?? 0;
    if (totalCount > 0 && Object.keys(brTargetMap).length > 0) {
      const hasTarget = Object.keys(brCounts).some(br => brTargetMap[br]);
      if (hasTarget) {
        let wt = 0;
        for (const [br, count] of Object.entries(brCounts)) {
          wt += (brTargetMap[br] ?? targetOverallAvgPSF ?? 0) * count;
        }
        targetRankAvgPSF = wt / totalCount;
      }
    }

    const basePSF = targetRankAvgPSF ?? 0;

    // Compute avgCumContrib at k=1 for this rank
    let cumContribSum = 0, simUnitCount = 0;
    for (const blk of project.blocks) {
      const blockExcl = parseExclR(blk.excludedFloors);
      const maxFloor  = blk.startingFloor + blk.totalStoreys - 1;
      for (const stk of blk.stacks) {
        if (stk.rankId !== rank.id) continue;
        const stackExcl   = parseExclR(stk.stackExcludedFloors);
        const combined    = new Set([...blockExcl, ...stackExcl]);
        const start       = stk.stackStartingFloor ?? blk.startingFloor;
        const validFloors = [];
        for (let f = start; f <= maxFloor; f++) {
          if (!combined.has(f)) validFloors.push(f);
        }
        let cumIncr = 0;
        for (let idx = 0; idx < validFloors.length; idx++) {
          const floor = validFloors[idx];
          if (idx > 0) {
            cumIncr += getBandIncrementR(rank.floorIncrements, floor);
          }
          cumContribSum += cumIncr;
          simUnitCount++;
        }
      }
    }
    const avgCumContrib = simUnitCount > 0 ? cumContribSum / simUnitCount : 0;
    const bandScale     = avgCumContrib > 0 ? (targetRankAvgPSF - basePSF) / avgCumContrib : 0;

    // Load units from this stack at and above fromFloor
    const unitsAbove = await prisma.unit.findMany({
      where:   { stackId, floor: { gte: fromFloor } },
      orderBy: { floor: 'asc' },
    });
    if (unitsAbove.length === 0) return res.json({ updatedCount: 0 });

    const anchorUnit = unitsAbove.find(u => u.floor === fromFloor);
    if (!anchorUnit) return res.status(404).json({ error: 'Anchor unit not found' });

    function roundToR(value, unit) {
      return Math.round(value / unit) * unit;
    }

    let prevPSF = anchorUnit.finalPSF ?? basePSF;
    const updates = [];

    for (const unit of unitsAbove) {
      if (unit.floor === fromFloor) continue; // anchor itself, skip

      if (unit.isManualOverride) {
        // Manual override acts as a new anchor — don't change it, but reset chain from it
        prevPSF = unit.finalPSF ?? prevPSF;
        continue;
      }

      const incrPSF = getBandIncrementR(rank.floorIncrements, unit.floor) * bandScale;

      const calcPSF        = prevPSF + incrPSF;
      const calcPrice      = roundToR(calcPSF * targetStack.standardSizeSqft, roundingUnit);
      const calcPSFRounded = targetStack.standardSizeSqft > 0 ? calcPrice / targetStack.standardSizeSqft : calcPSF;

      updates.push({ id: unit.id, finalPSF: calcPSFRounded, finalPrice: calcPrice, calculatedPSF: calcPSFRounded, calculatedPrice: calcPrice });
      prevPSF = calcPSF;
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(u => prisma.unit.update({
          where: { id: u.id },
          data:  { finalPSF: u.finalPSF, finalPrice: u.finalPrice, calculatedPSF: u.calculatedPSF, calculatedPrice: u.calculatedPrice },
        }))
      );
    }

    res.json({ updatedCount: updates.length });
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
