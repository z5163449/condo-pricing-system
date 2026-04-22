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
      // Build bedroom target map from JSON field (supports any bedroom type)
      let brTargetMap = {};
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMap[k] = Number(v);
        }
      } catch { /* ignore parse errors */ }
      // Fall back to legacy fixed fields for backward compatibility
      if (params.target2BRPSF && !brTargetMap['2BR']) brTargetMap['2BR'] = params.target2BRPSF;
      if (params.target3BRPSF && !brTargetMap['3BR']) brTargetMap['3BR'] = params.target3BRPSF;
      if (params.target4BRPSF && !brTargetMap['4BR']) brTargetMap['4BR'] = params.target4BRPSF;
      if (params.target5BRPSF && !brTargetMap['5BR']) brTargetMap['5BR'] = params.target5BRPSF;

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

    // Build bedroom target map for increment calculation (same logic as step 3)
    const brTargetMapForIncr = {};
    if (params) {
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMapForIncr[k] = Number(v);
        }
      } catch { /* ignore */ }
      if (params.target2BRPSF && !brTargetMapForIncr['2BR']) brTargetMapForIncr['2BR'] = params.target2BRPSF;
      if (params.target3BRPSF && !brTargetMapForIncr['3BR']) brTargetMapForIncr['3BR'] = params.target3BRPSF;
      if (params.target4BRPSF && !brTargetMapForIncr['4BR']) brTargetMapForIncr['4BR'] = params.target4BRPSF;
      if (params.target5BRPSF && !brTargetMapForIncr['5BR']) brTargetMapForIncr['5BR'] = params.target5BRPSF;
    }

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

    // ── Step 5b: Correction pass — ensure achieved avg PSF is within ±$1 of target ──
    let correctionWarning = null;
    if (targetOverallAvgPSF && unitsToCreate.length > 0) {
      const preAvg = unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0), 0) / unitsToCreate.length;
      if (Math.abs(preAvg - targetOverallAvgPSF) > 1) {
        const adj = targetOverallAvgPSF - preAvg;
        for (const u of unitsToCreate) {
          u.finalPSF = (u.finalPSF ?? 0) + adj;
          u.finalPrice = roundTo(u.finalPSF * u.sizeSqft, roundingUnit);
          if (!u.isPenthouse) {
            u.calculatedPSF   = u.finalPSF;
            u.calculatedPrice = u.finalPrice;
          }
        }
        // Also update running summary sums
        for (const br of Object.keys(brFinalPSFSum)) {
          brFinalPSFSum[br].sum += adj * brFinalPSFSum[br].count;
        }
        for (const blk of Object.keys(blockSummary)) {
          blockSummary[blk].sum += adj * blockSummary[blk].count;
        }
        const postAvg = unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0), 0) / unitsToCreate.length;
        if (Math.abs(postAvg - targetOverallAvgPSF) > 1) {
          correctionWarning = `Cannot reach target PSF within ±$1. Achieved: S$${postAvg.toFixed(0)}, Target: S$${targetOverallAvgPSF.toFixed(0)}`;
        }
      }
    }

    await prisma.unit.createMany({ data: unitsToCreate });

    // ── Step 6: Build solver summary ──────────────────────────────────────────
    const achievedOverallAvgPSF = unitsToCreate.length > 0
      ? unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0), 0) / unitsToCreate.length
      : null;

    // Build bedroom target map for summary reporting
    const brTargetMapSummary = {};
    if (params) {
      try {
        const parsed = JSON.parse(params.targetBedroomPSF || '{}');
        for (const [k, v] of Object.entries(parsed)) {
          if (v != null && Number(v) > 0) brTargetMapSummary[k] = Number(v);
        }
      } catch { /* ignore */ }
      if (params.target2BRPSF && !brTargetMapSummary['2BR']) brTargetMapSummary['2BR'] = params.target2BRPSF;
      if (params.target3BRPSF && !brTargetMapSummary['3BR']) brTargetMapSummary['3BR'] = params.target3BRPSF;
      if (params.target4BRPSF && !brTargetMapSummary['4BR']) brTargetMapSummary['4BR'] = params.target4BRPSF;
      if (params.target5BRPSF && !brTargetMapSummary['5BR']) brTargetMapSummary['5BR'] = params.target5BRPSF;
    }

    const byBedroomType = Object.entries(brFinalPSFSum).map(([type, { sum, count }]) => ({
      type,
      targetPSF:   brTargetMapSummary[type] ?? null,
      achievedPSF: count > 0 ? sum / count : null,
      unitCount:   count,
    }));

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
      correctionWarning,
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
