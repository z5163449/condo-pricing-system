import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// ─── PATCH /api/units/:id ─────────────────────────────────────────────────────
// Apply (or clear) a manual override on a single unit.
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
    res.json(unit);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    next(err);
  }
});

// ─── PATCH /api/units/:id/reset ──────────────────────────────────────────────
// Restore a unit to its solver-calculated values and clear the manual override.
router.patch('/:id/reset', async (req, res, next) => {
  try {
    const existing = await prisma.unit.findUnique({ where: { id: req.params.id } });
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
    res.json(unit);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Unit not found' });
    next(err);
  }
});

export default router;
