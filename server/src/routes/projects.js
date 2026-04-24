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
      if (params.target2BRPSF && !brTargetMap['2BR']) brTargetMap['2BR'] = params.target2BRPSF;
      if (params.target3BRPSF && !brTargetMap['3BR']) brTargetMap['3BR'] = params.target3BRPSF;
      if (params.target4BRPSF && !brTargetMap['4BR']) brTargetMap['4BR'] = params.target4BRPSF;
      if (params.target5BRPSF && !brTargetMap['5BR']) brTargetMap['5BR'] = params.target5BRPSF;
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

    // ── Step 3: Solve increment first, then derive basePSF ───────────────────
    // Unlocked, no bands:
    //   increment = target / (n × 0.5 + 1)  — proportional to floor count
    //   basePSF   = target − increment × (n − 1) / 2
    //   → avg across all floors = basePSF + increment × (n−1)/2 = target ✓
    // Unlocked, bands:
    //   basePSF = target × 0.85  (15 % headroom absorbed by the band curve)
    //   k       = (target − basePSF) / avgCumContrib
    // Locked (either): stored basePSF is fixed; increment/k solves around it.
    const solvedBasePSFs   = {};  // rankId → basePSF (floor-1 anchor)
    const solvedIncrements = {};  // rankId → uniform increment per floor, or null (bands)
    const solvedBandScales = {};  // rankId → scale factor k applied to band incrementPSFs

    for (const rank of project.ranks) {
      const target = targetRankAvgPSFs[rank.id];

      if (rank.floorIncrements.length > 0) {
        // Simulate cumulative band contributions at k=1 across all stacks of this rank
        let cumContribSum = 0, simUnitCount = 0;
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
            let cumIncr = 0;
            for (let idx = 0; idx < validFloors.length; idx++) {
              const floor = validFloors[idx];
              if (idx > 0) {
                cumIncr += rank.floorIncrements
                  .filter(fi => fi.fromFloor <= floor && floor <= fi.toFloor)
                  .reduce((s, fi) => s + (fi.incrementPSF ?? 0), 0);
              }
              cumContribSum += cumIncr;
              simUnitCount++;
            }
          }
        }
        const avgCumContrib = simUnitCount > 0 ? cumContribSum / simUnitCount : 0;

        const basePSF = (rank.basePSFLocked && rank.basePSF > 0)
          ? rank.basePSF          // locked: keep stored value
          : target * 0.85;        // unlocked: 85 % anchor, 15 % headroom for band curve
        solvedBasePSFs[rank.id]   = basePSF;
        solvedBandScales[rank.id] = avgCumContrib > 0 ? (target - basePSF) / avgCumContrib : 1.0;
        solvedIncrements[rank.id] = null;
        continue;
      }

      // No bands
      const n = rankUnitCounts[rank.id] || 0;
      if (n <= 1) {
        solvedBasePSFs[rank.id]   = target;
        solvedIncrements[rank.id] = 0;
        continue;
      }

      if (rank.basePSFLocked && rank.basePSF > 0) {
        // Locked: fixed basePSF, solve increment so avg hits target
        // avg = basePSF + increment × (n−1)/2  →  increment = (target − basePSF) / ((n−1)/2)
        solvedBasePSFs[rank.id]   = rank.basePSF;
        solvedIncrements[rank.id] = (target - rank.basePSF) / ((n - 1) / 2);
      } else {
        // Unlocked: increment = 0.3% of target PSF per floor (≈ $5-6/floor at typical targets)
        // Round to 2 dp to avoid floating-point noise in per-floor prices.
        // basePSF derived so avg across all floors = target:
        //   avg = basePSF + increment × (n−1)/2  →  basePSF = target − increment × (n−1)/2
        const increment = Math.round(target * 0.003 * 100) / 100;
        solvedBasePSFs[rank.id]   = target - increment * (n - 1) / 2;
        solvedIncrements[rank.id] = increment;
      }
    }

    // ── Step 5: Delete existing units and generate new ones ───────────────────
    const lockedRankIdSet = new Set(project.ranks.filter(r => r.basePSFLocked && r.basePSF > 0).map(r => r.id));

    const existingStacks = await prisma.stack.findMany({
      where: { block: { projectId } },
      select: { id: true },
    });
    if (existingStacks.length > 0) {
      await prisma.unit.deleteMany({ where: { stackId: { in: existingStacks.map(s => s.id) } } });
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
        const basePSF     = rankId ? (solvedBasePSFs[rankId] ?? 0) : 0;
        const useManual   = rankId && solvedIncrements[rankId] === null;
        const uniformIncr = rankId ? (solvedIncrements[rankId] ?? 0) : 0;
        const increments  = rank?.floorIncrements ?? [];
        const bandScale   = rankId ? (solvedBandScales[rankId] ?? 1.0) : 1.0;
        const rankLocked  = rankId ? lockedRankIdSet.has(rankId) : true;
        const stackNumStr = stack.stackNumber.toString().padStart(2, '0');

        let prevCalcPSF   = null;
        let prevCalcPrice = null;

        for (let idx = 0; idx < validFloors.length; idx++) {
          const floor       = validFloors[idx];
          const isTop       = idx === validFloors.length - 1;
          const isPenthouse = isTop && stack.hasPenthouse && (stack.penthouseSizeSqft ?? 0) > 0;

          // Per-floor increment — apply band scale factor k to manual bands
          let incrPSF;
          if (useManual) {
            incrPSF = increments
              .filter(fi => fi.fromFloor <= floor && floor <= fi.toFloor)
              .reduce((s, fi) => s + (fi.incrementPSF ?? 0) * bandScale, 0);
          } else {
            incrPSF = uniformIncr;
          }

          const calcPSF   = prevCalcPSF === null ? basePSF : prevCalcPSF + incrPSF;
          const calcPrice = roundTo(calcPSF * stack.standardSizeSqft, roundingUnit);
          // Back-calculate PSF from the rounded price so stored PSF and price are consistent
          const calcPSFRounded = stack.standardSizeSqft > 0 ? calcPrice / stack.standardSizeSqft : calcPSF;

          let sizeSqft, finalPSF, finalPrice;
          if (isPenthouse) {
            sizeSqft = stack.penthouseSizeSqft;
            const priceBelow = prevCalcPrice ?? calcPrice;
            const premium    = basePSF * penthouseMult * ((stack.penthouseSizeSqft ?? 0) - stack.standardSizeSqft);
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
            calculatedPSF:    calcPSFRounded,
            calculatedPrice:  calcPrice,
            finalPSF,
            finalPrice,
            isManualOverride: false,
            _rankLocked:      rankLocked,
          });

          const br = stack.bedroomType || 'Unknown';
          if (!brFinalPSFSum[br]) brFinalPSFSum[br] = { sum: 0, count: 0 };
          brFinalPSFSum[br].sum   += finalPSF ?? 0;
          brFinalPSFSum[br].count += 1;
          if (!blockSummary[block.blockName]) blockSummary[block.blockName] = { sum: 0, count: 0 };
          blockSummary[block.blockName].sum   += finalPSF ?? 0;
          blockSummary[block.blockName].count += 1;

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

    // ── Step 5b: Correction pass — sqft-weighted, skip locked-rank units ──────
    let correctionWarning = null;
    if (targetOverallAvgPSF && unitsToCreate.length > 0) {
      const totalSqftAll = unitsToCreate.reduce((s, u) => s + u.sizeSqft, 0);
      const preRevenue   = unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0) * u.sizeSqft, 0);
      const preAvg       = totalSqftAll > 0 ? preRevenue / totalSqftAll : 0;

      if (Math.abs(preAvg - targetOverallAvgPSF) > 1) {
        const unlockedSqft = unitsToCreate
          .filter(u => !u._rankLocked)
          .reduce((s, u) => s + u.sizeSqft, 0);

        if (unlockedSqft > 0) {
          // adj × unlockedSqft must cover the entire sqft-weighted revenue gap
          const adj = (targetOverallAvgPSF - preAvg) * totalSqftAll / unlockedSqft;
          for (const u of unitsToCreate) {
            if (u._rankLocked) continue;
            // Round price first, then back-calculate PSF for consistency
            u.finalPrice = roundTo(((u.finalPSF ?? 0) + adj) * u.sizeSqft, roundingUnit);
            u.finalPSF   = u.sizeSqft > 0 ? u.finalPrice / u.sizeSqft : (u.finalPSF ?? 0) + adj;
            if (!u.isPenthouse) {
              u.calculatedPrice = u.finalPrice;
              u.calculatedPSF   = u.finalPSF;
            }
          }
          for (const br of Object.keys(brFinalPSFSum)) {
            brFinalPSFSum[br].sum += adj * brFinalPSFSum[br].count;
          }
          for (const blk of Object.keys(blockSummary)) {
            blockSummary[blk].sum += adj * blockSummary[blk].count;
          }
        }

        const postRevenue = unitsToCreate.reduce((s, u) => s + (u.finalPSF ?? 0) * u.sizeSqft, 0);
        const postAvg     = totalSqftAll > 0 ? postRevenue / totalSqftAll : 0;
        if (Math.abs(postAvg - targetOverallAvgPSF) > 1) {
          correctionWarning = `Cannot reach target PSF within ±$1. Achieved: S$${postAvg.toFixed(0)}, Target: S$${targetOverallAvgPSF.toFixed(0)}`;
        }
      }
    }

    // Strip temp field before DB insert
    await prisma.unit.createMany({ data: unitsToCreate.map(({ _rankLocked, ...u }) => u) });

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
      rankLabel:       r.labelEn,
      solvedBasePSF:   solvedBasePSFs[r.id] ?? r.basePSF,
      solvedIncrement: solvedIncrements[r.id] ?? null,
      bandScale:       solvedBandScales[r.id] ?? null,
      unitCount:       rankUnitCounts[r.id] || 0,
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
