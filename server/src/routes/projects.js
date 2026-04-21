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
      target2BRPSF,
      target3BRPSF,
      target4BRPSF,
      target5BRPSF,
      penthouseMultiplier,
      roundingUnit,
    } = req.body;

    const data = {
      ...(targetOverallAvgPSF !== undefined && { targetOverallAvgPSF: targetOverallAvgPSF != null ? Number(targetOverallAvgPSF) : null }),
      ...(target2BRPSF        !== undefined && { target2BRPSF:        target2BRPSF != null        ? Number(target2BRPSF)        : null }),
      ...(target3BRPSF        !== undefined && { target3BRPSF:        target3BRPSF != null        ? Number(target3BRPSF)        : null }),
      ...(target4BRPSF        !== undefined && { target4BRPSF:        target4BRPSF != null        ? Number(target4BRPSF)        : null }),
      ...(target5BRPSF        !== undefined && { target5BRPSF:        target5BRPSF != null        ? Number(target5BRPSF)        : null }),
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

    // ── Helpers ───────────────────────────────────────────────────────────────
    function parseExcl(str) {
      try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
    }
    function roundTo(value, unit) {
      return Math.round(value / unit) * unit;
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
    // rankUnitCounts:     { rankId → totalValidFloors }
    // rankBedroomCounts:  { rankId → { bedroomType → count } }
    const rankUnitCounts    = {};
    const rankBedroomCounts = {};
    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        if (!stack.rankId) continue;
        const n = countValidFloors(block, stack);
        if (n === 0) continue;
        rankUnitCounts[stack.rankId]    = (rankUnitCounts[stack.rankId] || 0) + n;
        if (!rankBedroomCounts[stack.rankId]) rankBedroomCounts[stack.rankId] = {};
        const br = stack.bedroomType || 'Unknown';
        rankBedroomCounts[stack.rankId][br] = (rankBedroomCounts[stack.rankId][br] || 0) + n;
      }
    }
    const totalRankedUnits = Object.values(rankUnitCounts).reduce((s, n) => s + n, 0);

    // ── Step 2: Solve rank base PSFs ──────────────────────────────────────────
    const solvedBasePSFs = {};   // rankId → solved basePSF (floor-1 value)

    if (targetOverallAvgPSF && totalRankedUnits > 0) {
      const lockedRanks   = project.ranks.filter(r => r.basePSFLocked);
      const unlockedRanks = project.ranks.filter(r => !r.basePSFLocked);

      // Locked ranks: use their basePSF as-is
      for (const r of lockedRanks) solvedBasePSFs[r.id] = r.basePSF;

      // Solve base for unlocked ranks
      // Constraint: Σ(basePSF_i × unitCount_i) / totalRankedUnits = targetOverallAvgPSF
      // For unlocked ranks with differential d_i:  basePSF_i = solvedBase + d_i
      // solvedBase × Σ(unlockedUnits_i) + Σ(d_i × unlockedUnits_i) + lockedContrib = target × totalRankedUnits
      const lockedContrib    = lockedRanks.reduce((s, r) => s + r.basePSF * (rankUnitCounts[r.id] || 0), 0);
      const totalUnlockedN   = unlockedRanks.reduce((s, r) => s + (rankUnitCounts[r.id] || 0), 0);
      const diffContrib      = unlockedRanks.reduce((s, r) => s + r.rankDifferential * (rankUnitCounts[r.id] || 0), 0);

      if (totalUnlockedN > 0) {
        const solvedBase = (targetOverallAvgPSF * totalRankedUnits - lockedContrib - diffContrib) / totalUnlockedN;
        for (const r of unlockedRanks) solvedBasePSFs[r.id] = solvedBase + r.rankDifferential;
      } else {
        for (const r of lockedRanks) solvedBasePSFs[r.id] = r.basePSF;
      }
    } else {
      // No target: use existing basePSF values unchanged
      for (const r of project.ranks) solvedBasePSFs[r.id] = r.basePSF;
    }

    // ── Step 3: Apply bedroom type targets ────────────────────────────────────
    if (targetOverallAvgPSF && params) {
      const brTargetMap = {
        '2BR': params.target2BRPSF,
        '3BR': params.target3BRPSF,
        '4BR': params.target4BRPSF,
        '5BR': params.target5BRPSF,
      };
      const unlockedRankIds = new Set(project.ranks.filter(r => !r.basePSFLocked).map(r => r.id));

      for (const [brType, brTarget] of Object.entries(brTargetMap)) {
        if (!brTarget) continue;
        // Find unlocked ranks containing stacks of this bedroom type
        const affectedRankIds = Object.keys(rankBedroomCounts)
          .filter(rid => unlockedRankIds.has(rid) && (rankBedroomCounts[rid][brType] || 0) > 0);
        if (!affectedRankIds.length) continue;

        // Current weighted avg PSF for this bedroom type across affected ranks
        let weightedSum = 0, brCount = 0;
        for (const rid of affectedRankIds) {
          const cnt = rankBedroomCounts[rid][brType];
          weightedSum += solvedBasePSFs[rid] * cnt;
          brCount += cnt;
        }
        if (brCount === 0 || weightedSum === 0) continue;
        const factor = brTarget / (weightedSum / brCount);
        for (const rid of affectedRankIds) solvedBasePSFs[rid] *= factor;
      }

      // Final correction: bring overall weighted avg back to targetOverallAvgPSF
      const achievedWeightedSum = Object.entries(solvedBasePSFs)
        .reduce((s, [rid, psf]) => s + psf * (rankUnitCounts[rid] || 0), 0);
      const achievedAvg = totalRankedUnits > 0 ? achievedWeightedSum / totalRankedUnits : 0;
      if (achievedAvg > 0) {
        const cf = targetOverallAvgPSF / achievedAvg;
        for (const rid of Object.keys(solvedBasePSFs)) {
          if (unlockedRankIds.has(rid)) solvedBasePSFs[rid] *= cf;
        }
      }
    }

    // ── Step 4: Solve optimal floor increment per rank ────────────────────────
    // If rank has manual floor increment bands → use them (null = use bands)
    // Otherwise: increment = (targetRankAvgPSF − basePSF) / (n / 2)
    const solvedIncrements = {};   // rankId → uniform PSF increment per floor, or null for manual bands

    const brTargetMapForIncr = params ? {
      '2BR': params.target2BRPSF,
      '3BR': params.target3BRPSF,
      '4BR': params.target4BRPSF,
      '5BR': params.target5BRPSF,
    } : {};

    for (const rank of project.ranks) {
      if (rank.floorIncrements.length > 0) {
        solvedIncrements[rank.id] = null; // use existing manual bands
        continue;
      }
      const n = rankUnitCounts[rank.id] || 0;
      if (n <= 1) { solvedIncrements[rank.id] = 0; continue; }

      // Determine targetRankAvgPSF: bedroom-type weighted blend, fall back to overall
      let targetRankAvgPSF = targetOverallAvgPSF ?? solvedBasePSFs[rank.id];
      if (targetOverallAvgPSF) {
        const brCounts = rankBedroomCounts[rank.id] || {};
        const brTotal  = Object.values(brCounts).reduce((s, c) => s + c, 0);
        if (brTotal > 0) {
          let wt = 0;
          for (const [br, cnt] of Object.entries(brCounts)) {
            wt += (brTargetMapForIncr[br] ?? targetOverallAvgPSF) * cnt;
          }
          targetRankAvgPSF = wt / brTotal;
        }
      }

      // avg = basePSF + increment × n / 2  →  increment = (target − basePSF) / (n / 2)
      solvedIncrements[rank.id] = (targetRankAvgPSF - solvedBasePSFs[rank.id]) / (n / 2);
    }

    // ── Step 5: Delete existing units and generate new ones ───────────────────
    const existingStacks = await prisma.stack.findMany({
      where: { block: { projectId } },
      select: { id: true },
    });
    if (existingStacks.length > 0) {
      await prisma.unit.deleteMany({ where: { stackId: { in: existingStacks.map(s => s.id) } } });
    }

    const unitsToCreate = [];
    const byBlock       = [];
    // Track final PSFs per bedroom type and per block for the summary
    const brFinalPSFSum   = {};  // bedroomType → { sum, count }
    const blockSummary    = {};  // blockName → { psfSum, count }

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
        const basePSF     = rankId ? (solvedBasePSFs[rankId] ?? 0) : 0;
        const useManual   = rankId && solvedIncrements[rankId] === null;
        const uniformIncr = rankId ? (solvedIncrements[rankId] ?? 0) : 0;
        const increments  = rank?.floorIncrements ?? [];
        const stackNumStr = stack.stackNumber.toString().padStart(2, '0');

        let prevCalcPSF   = null;
        let prevCalcPrice = null;

        for (let idx = 0; idx < validFloors.length; idx++) {
          const floor       = validFloors[idx];
          const isTop       = idx === validFloors.length - 1;
          const isPenthouse = isTop && stack.hasPenthouse && (stack.penthouseSizeSqft ?? 0) > 0;

          // Determine per-floor increment
          let incrPSF;
          if (useManual) {
            incrPSF = increments
              .filter(fi => fi.fromFloor <= floor && floor <= fi.toFloor)
              .reduce((s, fi) => s + fi.incrementPSF, 0);
          } else {
            incrPSF = uniformIncr;
          }

          // Cumulative PSF: floor 1 = basePSF, each subsequent floor = prev + incr
          const calcPSF   = prevCalcPSF === null ? basePSF : prevCalcPSF + incrPSF;
          const calcPrice = roundTo(calcPSF * stack.standardSizeSqft, roundingUnit);

          let sizeSqft, finalPSF, finalPrice;
          if (isPenthouse) {
            sizeSqft = stack.penthouseSizeSqft;
            const priceBelow = prevCalcPrice ?? calcPrice;
            const premium    = basePSF * penthouseMult * ((stack.penthouseSizeSqft ?? 0) - stack.standardSizeSqft);
            finalPrice = roundTo(priceBelow + premium, roundingUnit);
            finalPSF   = sizeSqft > 0 ? finalPrice / sizeSqft : 0;
          } else {
            sizeSqft   = stack.standardSizeSqft;
            finalPSF   = calcPSF;
            finalPrice = calcPrice;
          }

          unitsToCreate.push({
            stackId:          stack.id,
            unitNumber:       `#${floor.toString().padStart(2, '0')}-${stackNumStr}`,
            floor,
            sizeSqft,
            isPenthouse,
            calculatedPSF:    calcPSF,
            calculatedPrice:  calcPrice,
            finalPSF,
            finalPrice,
            isManualOverride: false,
          });

          // Accumulate summary stats
          const br = stack.bedroomType || 'Unknown';
          if (!brFinalPSFSum[br]) brFinalPSFSum[br] = { sum: 0, count: 0 };
          brFinalPSFSum[br].sum   += finalPSF ?? 0;
          brFinalPSFSum[br].count += 1;
          if (!blockSummary[block.blockName]) blockSummary[block.blockName] = { sum: 0, count: 0 };
          blockSummary[block.blockName].sum   += finalPSF ?? 0;
          blockSummary[block.blockName].count += 1;

          prevCalcPSF   = calcPSF;
          prevCalcPrice = calcPrice;
          blockUnitCount++;
        }
      }

      byBlock.push({
        blockName:     block.blockName,
        unitCount:     blockUnitCount,
        achievedAvgPSF: blockSummary[block.blockName]?.count > 0
          ? blockSummary[block.blockName].sum / blockSummary[block.blockName].count
          : null,
      });
    }

    await prisma.unit.createMany({ data: unitsToCreate });

    // ── Step 6: Build solver summary ──────────────────────────────────────────
    const achievedOverallAvgPSF = unitsToCreate.length > 0
      ? unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0), 0) / unitsToCreate.length
      : null;

    const byBedroomType = Object.entries(brFinalPSFSum).map(([type, { sum, count }]) => {
      const brTargetMap2 = params ? {
        '2BR': params.target2BRPSF,
        '3BR': params.target3BRPSF,
        '4BR': params.target4BRPSF,
        '5BR': params.target5BRPSF,
      } : {};
      return {
        type,
        targetPSF:   brTargetMap2[type] ?? null,
        achievedPSF: count > 0 ? sum / count : null,
        unitCount:   count,
      };
    });

    const byRank = project.ranks.map(r => ({
      rankLabel:      r.labelEn,
      solvedBasePSF:  solvedBasePSFs[r.id] ?? r.basePSF,
      solvedIncrement: solvedIncrements[r.id] ?? null,
      unitCount:      rankUnitCounts[r.id] || 0,
    }));

    res.json({
      totalUnits: unitsToCreate.length,
      achievedOverallAvgPSF,
      targetOverallAvgPSF,
      byBedroomType,
      byRank,
      byBlock,
    });
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
