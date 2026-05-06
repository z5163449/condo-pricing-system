import { Router } from 'express';
import prisma from '../lib/prisma.js';

// ─── Project-scoped routes  (mount at /api/projects) ─────────────────────────
export const projectTypeCodesRouter = Router();

// GET /api/projects/:projectId/typecodes
projectTypeCodesRouter.get('/:projectId/typecodes', async (req, res, next) => {
  try {
    const typeCodes = await prisma.typeCode.findMany({
      where:   { projectId: req.params.projectId },
      include: {
        stacks: {
          include:  { block: true },
          orderBy:  { stackNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(typeCodes);
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/typecodes
projectTypeCodesRouter.post('/:projectId/typecodes', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { code, bedroomType, sizeSqft, facing, notes, blockAssignments = [] } = req.body;

    if (!code?.trim())        return res.status(400).json({ error: 'code is required' });
    if (!bedroomType?.trim()) return res.status(400).json({ error: 'bedroomType is required' });
    if (sizeSqft == null || isNaN(Number(sizeSqft))) {
      return res.status(400).json({ error: 'sizeSqft is required' });
    }

    // Validate all referenced blocks before touching the DB
    for (const { blockId } of blockAssignments) {
      const block = await prisma.block.findUnique({ where: { id: blockId } });
      if (!block)                       return res.status(400).json({ error: `Block ${blockId} not found` });
      if (block.projectId !== projectId) return res.status(400).json({ error: `Block ${blockId} does not belong to this project` });
    }

    const typeCode = await prisma.typeCode.create({
      data: {
        projectId,
        code:        code.trim(),
        bedroomType: bedroomType.trim(),
        sizeSqft:    Number(sizeSqft),
        facing:      facing?.trim() || null,
        notes:       notes?.trim()  || null,
      },
    });

    console.log('[typecodes POST] blockAssignments received:', JSON.stringify(blockAssignments));

    if (blockAssignments.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const { blockId, stackNumbers } of blockAssignments) {
          console.log(`[typecodes POST] Processing blockId=${blockId}, stackNumbers=${JSON.stringify(stackNumbers)}`);
          for (const rawNum of stackNumbers) {
            const stackNumber = parseInt(rawNum, 10);
            if (isNaN(stackNumber)) {
              console.log(`[typecodes POST] Skipping NaN stackNumber from rawNum=${rawNum}`);
              continue;
            }
            console.log(`[typecodes POST] Looking up stack blockId=${blockId} stackNumber=${stackNumber}`);
            const existing = await tx.stack.findFirst({ where: { blockId, stackNumber } });
            console.log(`[typecodes POST] Existing stack:`, existing ? existing.id : 'none');
            if (existing) {
              await tx.stack.update({
                where: { id: existing.id },
                data: {
                  typeCodeId:       typeCode.id,
                  unitTypeCode:     typeCode.code,
                  bedroomType:      typeCode.bedroomType,
                  standardSizeSqft: typeCode.sizeSqft,
                  facing:           typeCode.facing,
                },
              });
              console.log(`[typecodes POST] Updated existing stack ${existing.id}`);
            } else {
              const created = await tx.stack.create({
                data: {
                  blockId,
                  stackNumber,
                  typeCodeId:       typeCode.id,
                  unitTypeCode:     typeCode.code,
                  bedroomType:      typeCode.bedroomType,
                  standardSizeSqft: typeCode.sizeSqft,
                  facing:           typeCode.facing,
                },
              });
              console.log(`[typecodes POST] Created new stack ${created.id}`);
            }
          }
        }
      });
    }

    const result = await prisma.typeCode.findUnique({
      where:   { id: typeCode.id },
      include: {
        stacks: {
          include:  { block: true },
          orderBy:  { stackNumber: 'asc' },
        },
      },
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ─── TypeCode-scoped routes  (mount at /api/typecodes) ───────────────────────
export const typeCodesRouter = Router();

// PATCH /api/typecodes/:id
typeCodesRouter.patch('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.typeCode.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Type code not found' });

    const { code, bedroomType, sizeSqft, facing, notes } = req.body;
    const data = {};
    if (code        !== undefined) data.code        = code;
    if (bedroomType !== undefined) data.bedroomType = bedroomType;
    if (sizeSqft    !== undefined) data.sizeSqft    = Number(sizeSqft);
    if (facing      !== undefined) data.facing      = facing || null;
    if (notes       !== undefined) data.notes       = notes  || null;

    await prisma.typeCode.update({ where: { id: req.params.id }, data });

    // Cascade all provided fields to linked stacks
    const stackData = {};
    if (code        !== undefined) stackData.unitTypeCode     = code;
    if (bedroomType !== undefined) stackData.bedroomType      = bedroomType;
    if (sizeSqft    !== undefined) stackData.standardSizeSqft = Number(sizeSqft);
    if (facing      !== undefined) stackData.facing           = facing || null;

    let updatedStackCount = 0;
    if (Object.keys(stackData).length > 0) {
      const result = await prisma.stack.updateMany({
        where: { typeCodeId: req.params.id },
        data:  stackData,
      });
      updatedStackCount = result.count;
    }

    const updated = await prisma.typeCode.findUnique({
      where:   { id: req.params.id },
      include: {
        stacks: {
          include:  { block: true },
          orderBy:  { stackNumber: 'asc' },
        },
      },
    });
    res.json({ ...updated, updatedStackCount });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Type code not found' });
    next(err);
  }
});

// DELETE /api/typecodes/:id
typeCodesRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.typeCode.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Type code not found' });

    const count = await prisma.stack.count({ where: { typeCodeId: req.params.id } });
    if (count > 0) {
      return res.status(400).json({
        error: `${count} stack${count !== 1 ? 's' : ''} use this type code. Reassign them first.`,
      });
    }

    await prisma.typeCode.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Type code not found' });
    next(err);
  }
});
