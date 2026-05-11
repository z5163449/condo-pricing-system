import { Router }        from 'express';
import PDFDocument       from 'pdfkit';
import ExcelJS           from 'exceljs';
import multer            from 'multer';
import path              from 'path';
import { fileURLToPath } from 'url';
import { existsSync }    from 'fs';
import prisma            from '../lib/prisma.js';

const upload = multer({ storage: multer.memoryStorage() });

const router    = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseExcl(str) {
  try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
}

function fmtPSF(n) {
  if (n == null || !isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtPrice(n) {
  if (n == null || !isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtDelta(d) {
  if (d == null || !isFinite(d) || Math.round(d) === 0) return '';
  const r = Math.round(d);
  return (r > 0 ? '+$' : '-$') + Math.abs(r).toLocaleString('en-US');
}

function fmtInt(n) {
  return Math.round(n ?? 0).toLocaleString('en-US');
}

// ─── POST /api/projects/:projectId/export/pdf ─────────────────────────────────
router.post('/:projectId/export/pdf', async (req, res, next) => {
  try {
    const { projectId }                          = req.params;
    const { scenarioId = null, language = 'en' } = req.body ?? {};

    // ── 1. Load project ───────────────────────────────────────────────────────
    const project = await prisma.project.findUnique({
      where:   { id: projectId },
      include: {
        blocks: {
          include: { stacks: { orderBy: { stackNumber: 'asc' } } },
          orderBy: { blockName: 'asc' },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // ── 2. Load units ─────────────────────────────────────────────────────────
    let unitRows;
    let scenarioMeta = null;

    if (scenarioId) {
      const scenario = await prisma.pricingScenario.findUnique({
        where:   { id: scenarioId },
        include: { snapshots: true },
      });
      if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
      scenarioMeta = { name: scenario.name, isLocked: scenario.isLocked };
      unitRows = scenario.snapshots;
    } else {
      unitRows = await prisma.unit.findMany({
        where:  { stack: { block: { projectId } } },
        select: { stackId: true, floor: true, sizeSqft: true, finalPSF: true, finalPrice: true },
      });
    }

    const unitMap = {};
    for (const u of unitRows) {
      if (u.finalPSF == null || u.finalPrice == null) continue;
      if (!unitMap[u.stackId]) unitMap[u.stackId] = {};
      unitMap[u.stackId][u.floor] = {
        sizeSqft:   u.sizeSqft,
        finalPSF:   u.finalPSF,
        finalPrice: u.finalPrice,
      };
    }

    // ── 3. Auto-orientation (no floor-avg column) ─────────────────────────────
    const maxStacks = project.blocks.reduce((m, b) => Math.max(m, b.stacks.length), 0);
    const COL_FL = 45;
    const COL_ST = 80;
    const MARG   = 30;

    const totalColW   = COL_FL + maxStacks * COL_ST;
    const usePortrait = totalColW <= (595 - MARG * 2);
    const PAGE_W  = usePortrait ? 595 : 842;
    const PAGE_H  = usePortrait ? 842 : 595;
    const CONT_W  = PAGE_W - MARG * 2;

    // +1pt vs previous for readability
    const scale = totalColW > CONT_W ? CONT_W / totalColW : 1;
    const FS    = Math.max(8, Math.floor(10 * scale));
    const cFL   = Math.floor(COL_FL * scale);
    const cST   = Math.floor(COL_ST * scale);

    // ── 4. Global stats ───────────────────────────────────────────────────────
    const allPriced  = unitRows.filter(u => u.finalPSF != null && u.finalPrice != null);
    const totalNSA   = allPriced.reduce((s, u) => s + (u.sizeSqft ?? 0), 0);
    const totalRev   = allPriced.reduce((s, u) => s + u.finalPrice, 0);
    const overallPSF = totalNSA > 0 ? totalRev / totalNSA : null;

    // ── 5. Bedroom type stats ─────────────────────────────────────────────────
    const brMap = {};
    for (const block of project.blocks) {
      for (const stack of block.stacks) {
        const br = stack.bedroomType || 'Unknown';
        for (const u of Object.values(unitMap[stack.id] ?? {})) {
          if (!brMap[br]) brMap[br] = { rev: 0, sqft: 0, count: 0, sizes: [] };
          brMap[br].rev   += u.finalPrice;
          brMap[br].sqft  += u.sizeSqft ?? 0;
          brMap[br].count += 1;
          if (u.sizeSqft) brMap[br].sizes.push(u.sizeSqft);
        }
      }
    }
    const bedroomTypes = Object.keys(brMap).sort();

    // ── 6. Pre-compute delta PSF per stack ────────────────────────────────────
    const deltaMap = {};
    for (const block of project.blocks) {
      const blockExcl = parseExcl(block.excludedFloors);
      for (const stack of block.stacks) {
        const stackExcl = parseExcl(stack.stackExcludedFloors);
        const combined  = new Set([...blockExcl, ...stackExcl]);
        const startF    = stack.stackStartingFloor ?? block.startingFloor;
        const maxF      = block.startingFloor + block.totalStoreys - 1;
        deltaMap[stack.id] = {};
        let prevPSF = null;
        for (let f = startF; f <= maxF; f++) {
          if (combined.has(f)) continue;
          const u = unitMap[stack.id]?.[f];
          if (!u) { prevPSF = null; continue; }
          deltaMap[stack.id][f] = prevPSF != null ? u.finalPSF - prevPSF : null;
          prevPSF = u.finalPSF;
        }
      }
    }

    // ── 7. Block table row constants (larger than before) ─────────────────────
    const ROW_H  = 36;   // was 32 — extra room for +1pt font
    const EXCL_H = 14;
    const BLK_H  = 28;   // was 26
    const TBL_H  = 26;   // was 24
    const FOOT_H = 24;   // was 22

    // ── 8. Create PDF document ────────────────────────────────────────────────
    const doc = new PDFDocument({
      size:    'A4',
      layout:  usePortrait ? 'portrait' : 'landscape',
      margins: { top: MARG, bottom: MARG, left: MARG, right: MARG },
      autoFirstPage: true,
      bufferPages:   false,
      info: {
        Title:  `${project.nameEn} – Pricing`,
        Author: 'Condo Pricing System',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${project.nameEn.replace(/[^a-zA-Z0-9 _-]/g, '').trim()}-pricing.pdf"`);
    doc.pipe(res);

    // ── 9. Font setup ─────────────────────────────────────────────────────────
    let mainFont = 'Helvetica';
    let boldFont = 'Helvetica-Bold';

    if (language === 'zh') {
      const candidates = [
        path.join(FONTS_DIR, 'NotoSansSC-Regular.otf'),
        path.join(FONTS_DIR, 'NotoSansSC-Regular.ttf'),
      ];
      const fontFile = candidates.find(p => existsSync(p));
      if (fontFile) {
        try {
          doc.registerFont('NotoSansSC', fontFile);
          mainFont = 'NotoSansSC';
          boldFont = 'NotoSansSC';
        } catch {
          // fall back to Helvetica
        }
      }
    }

    // ── 10. Bilingual labels ──────────────────────────────────────────────────
    const labels = ({
      en: {
        projectTitle:    project.nameEn,
        projectSub:      project.nameZh || null,
        scenario:        'Scenario',
        generated:       'Generated',
        status:          'Status',
        locked:          'Locked',
        unlocked:        'Unlocked',
        totalUnits:      'Total Units',
        acrossBlocks:    (n) => `across ${n} block${n !== 1 ? 's' : ''}`,
        overallAvgPSF:   'Overall Avg PSF',
        target:          (t) => `target: $${Number(t).toLocaleString()}`,
        totalNSA:        'Total NSA',
        sqft:            'sqft',
        totalRevenue:    'Total Revenue',
        avgPSFByBedroom: 'Average PSF by bedroom type',
        units:           'units',
        blockSummary:    'Block summary',
        units_short:     'Units',
        avg:             'Avg',
        confidential:    'Condo Pricing System — Confidential',
        page:            (n) => `Page ${n}`,
        floor:           'Floor',
        excluded:        'Excl.',
        avgPSF:          'Avg PSF',
        cont:            'cont.',
      },
      zh: {
        projectTitle:    project.nameZh || project.nameEn,
        projectSub:      project.nameEn,
        scenario:        '方案',
        generated:       '生成日期',
        status:          '状态',
        locked:          '已锁定',
        unlocked:        '未锁定',
        totalUnits:      '总单位数',
        acrossBlocks:    (n) => `共 ${n} 栋`,
        overallAvgPSF:   '整体平均尺价',
        target:          (t) => `目标: $${Number(t).toLocaleString()}`,
        totalNSA:        '总净售面积',
        sqft:            '平方尺',
        totalRevenue:    '总收益',
        avgPSFByBedroom: '各房型平均尺价',
        units:           '单位',
        blockSummary:    '楼栋概况',
        units_short:     '单位',
        avg:             '均价',
        confidential:    '公寓定价系统 — 机密',
        page:            (n) => `第 ${n} 页`,
        floor:           '楼层',
        excluded:        '排除',
        avgPSF:          '均价',
        cont:            '续',
      },
    })[language] ?? {};

    // ── 11. Drawing primitives ────────────────────────────────────────────────
    const X0 = MARG;
    let y = MARG;

    function fillRect(x, ry, w, h, color) {
      doc.rect(x, ry, w, h).fill(color);
    }

    function fillRounded(x, ry, w, h, r, color) {
      doc.roundedRect(x, ry, w, h, r).fill(color);
    }

    function strokeRect(x, ry, w, h, color, lw = 0.5) {
      doc.save().lineWidth(lw).rect(x, ry, w, h).stroke(color).restore();
    }

    function hline(x, ry, w, color = '#CBD5E1', lw = 0.4) {
      doc.save().lineWidth(lw).moveTo(x, ry).lineTo(x + w, ry).stroke(color).restore();
    }

    function cell(text, x, ry, w, opts = {}) {
      if (text == null || text === '') return;
      const {
        font  = mainFont,
        size  = FS,
        color = '#111827',
        align = 'center',
      } = opts;
      doc.font(font).fontSize(size).fillColor(color)
         .text(String(text), x + 2, ry, { width: w - 4, align, lineBreak: false });
    }

    // ── 12. SUMMARY PAGE ─────────────────────────────────────────────────────

    // Header banner — full page width, 80pt tall, at absolute y=0
    fillRect(0, 0, PAGE_W, 80, '#0C447C');

    // Project name
    doc.font(boldFont).fontSize(24).fillColor('#FFFFFF')
       .text(labels.projectTitle, 40, 20, { width: PAGE_W - 80, lineBreak: false });

    // Chinese subtitle
    if (labels.projectSub) {
      doc.font(mainFont).fontSize(14).fillColor('#B5D4F4')
         .text(labels.projectSub, 40, 50, { width: PAGE_W - 80, lineBreak: false });
    }

    // Meta row
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    const metaParts = [
      scenarioMeta ? `${labels.scenario}: ${scenarioMeta.name}` : null,
      `${labels.generated}: ${dateStr}`,
      `${labels.status}: ${scenarioMeta?.isLocked ? labels.locked : labels.unlocked}`,
    ].filter(Boolean);

    doc.font(mainFont).fontSize(10).fillColor('#FFFFFF')
       .text(metaParts.join('   |   '), 40, 68, { width: PAGE_W - 80, lineBreak: false });

    y = 80 + 20; // 20pt gap after banner

    // ── 4 Metric cards ────────────────────────────────────────────────────────
    const CARD_H   = 80;
    const CARD_GAP = 8;
    const cardW    = (CONT_W - 3 * CARD_GAP) / 4;

    const revAbbrv = totalRev >= 1e6
      ? '$' + (totalRev / 1e6).toFixed(1) + 'M'
      : fmtPrice(totalRev);

    const summaryCards = [
      {
        label: labels.totalUnits.toUpperCase(),
        value: allPriced.length.toLocaleString(),
        sub:   labels.acrossBlocks(project.blocks.length),
      },
      {
        label: labels.overallAvgPSF.toUpperCase(),
        value: fmtPSF(overallPSF),
        sub:   project.targetPSF ? labels.target(project.targetPSF) : '',
      },
      {
        label: labels.totalNSA.toUpperCase(),
        value: fmtInt(totalNSA),
        sub:   labels.sqft,
      },
      {
        label: labels.totalRevenue.toUpperCase(),
        value: revAbbrv,
        sub:   fmtPrice(totalRev),
      },
    ];

    summaryCards.forEach((card, i) => {
      const cx = X0 + i * (cardW + CARD_GAP);
      fillRounded(cx, y, cardW, CARD_H, 6, '#0C447C');

      // Label — 8pt, #B5D4F4, uppercase
      doc.font(mainFont).fontSize(8).fillColor('#B5D4F4')
         .text(card.label, cx + 12, y + 12, { width: cardW - 24, align: 'center', lineBreak: false });

      // Value — 22pt, white, bold
      doc.font(boldFont).fontSize(22).fillColor('#FFFFFF')
         .text(card.value, cx + 12, y + 26, { width: cardW - 24, align: 'center', lineBreak: false });

      // Sub — 9pt, #85B7EB
      if (card.sub) {
        doc.font(mainFont).fontSize(9).fillColor('#85B7EB')
           .text(card.sub, cx + 12, y + 57, { width: cardW - 24, align: 'center', lineBreak: false });
      }
    });
    y += CARD_H + 16;

    // ── Bedroom type section ─────────────────────────────────────────────────
    if (bedroomTypes.length > 0) {
      // Section height: 10pt top + 8pt title + 10pt gap + content (11+4+18+4+9=46) + 14pt bottom
      const BR_SECTION_H = 92;
      const BR_TITLE_Y   = 10;    // offset from section top
      const BR_CONTENT_Y = 28;    // offset from section top where bedroom columns start

      fillRounded(X0, y, CONT_W, BR_SECTION_H, 6, '#E6F1FB');

      // Section title
      doc.font(mainFont).fontSize(8).fillColor('#185FA5')
         .text(labels.avgPSFByBedroom.toUpperCase(), X0 + 10, y + BR_TITLE_Y, {
           width: CONT_W - 20, lineBreak: false,
         });

      // Bedroom columns — horizontal row, evenly spaced
      const brColW = CONT_W / bedroomTypes.length;

      bedroomTypes.forEach((br, i) => {
        const bx = X0 + i * brColW;
        const { rev, sqft, count, sizes } = brMap[br];
        const avgPSF = sqft > 0 ? rev / sqft : 0;
        const minSz  = sizes.length ? Math.min(...sizes) : 0;
        const maxSz  = sizes.length ? Math.max(...sizes) : 0;
        const sizeRange = minSz === maxSz
          ? `${Math.round(minSz).toLocaleString()} ${labels.sqft}`
          : `${Math.round(minSz).toLocaleString()}–${Math.round(maxSz).toLocaleString()} ${labels.sqft}`;

        // Bedroom type name — 11pt, #185FA5, bold
        doc.font(boldFont).fontSize(11).fillColor('#185FA5')
           .text(br, bx + 10, y + BR_CONTENT_Y, { width: brColW - 20, lineBreak: false });

        // Avg PSF — 18pt, #0C447C, bold
        doc.font(boldFont).fontSize(18).fillColor('#0C447C')
           .text(fmtPSF(avgPSF), bx + 10, y + BR_CONTENT_Y + 14, { width: brColW - 20, lineBreak: false });

        // Unit count + size range — 9pt, #888780
        doc.font(mainFont).fontSize(9).fillColor('#888780')
           .text(`${count} ${labels.units}   ·   ${sizeRange}`, bx + 10, y + BR_CONTENT_Y + 38, {
             width: brColW - 20, lineBreak: false,
           });
      });

      y += BR_SECTION_H + 16;
    }

    // ── Block summary ─────────────────────────────────────────────────────────
    doc.font(boldFont).fontSize(13).fillColor('#2C2C2A')
       .text(labels.blockSummary, X0, y, { width: CONT_W, lineBreak: false });
    y += 20;

    const BLK_COLS    = project.blocks.length > 4 ? 2 : 1;
    const BLK_GAP_COL = 10;
    const BLK_GAP_ROW = 6;
    const BLK_W       = BLK_COLS === 2 ? (CONT_W - BLK_GAP_COL) / 2 : CONT_W;
    const BLK_ROW_H   = 32;

    project.blocks.forEach((block, i) => {
      const col = i % BLK_COLS;
      const row = Math.floor(i / BLK_COLS);
      const bx  = X0 + col * (BLK_W + BLK_GAP_COL);
      const by  = y + row * (BLK_ROW_H + BLK_GAP_ROW);

      const bUnits = block.stacks.flatMap(s => Object.values(unitMap[s.id] ?? {}));
      const bNSA   = bUnits.reduce((s, u) => s + (u.sizeSqft ?? 0), 0);
      const bRev   = bUnits.reduce((s, u) => s + u.finalPrice, 0);
      const bPSF   = bNSA > 0 ? bRev / bNSA : null;

      // Row background — #F5F9FE, rounded 4pt
      fillRounded(bx, by, BLK_W, BLK_ROW_H, 4, '#F5F9FE');

      // Left accent — 4pt wide, full row height, square corners (overlaps rounded bg edge)
      fillRect(bx, by, 4, BLK_ROW_H, '#0C447C');

      // Block name — 11pt, #0C447C, bold
      const textY = by + (BLK_ROW_H - 11) / 2;
      doc.font(boldFont).fontSize(11).fillColor('#0C447C')
         .text(block.blockName, bx + 14, textY, { width: BLK_W * 0.45, lineBreak: false });

      // Stats — 10pt, #5F5E5A, right-aligned
      const statsLine = [
        `${labels.units_short}: ${bUnits.length}`,
        bPSF != null ? `${labels.avg}: ${fmtPSF(bPSF)}` : null,
      ].filter(Boolean).join('   |   ');

      doc.font(mainFont).fontSize(10).fillColor('#5F5E5A')
         .text(statsLine, bx + 14, by + (BLK_ROW_H - 10) / 2, {
           width: BLK_W - 24,
           align:    'right',
           lineBreak: false,
         });
    });

    // ── Footer pinned to page bottom ──────────────────────────────────────────
    const FOOT_Y = PAGE_H - MARG - 14;
    hline(X0, FOOT_Y - 8, CONT_W, '#D3D1C7', 0.5);

    doc.font(mainFont).fontSize(9).fillColor('#888780')
       .text(labels.confidential, X0, FOOT_Y, { width: CONT_W / 2, lineBreak: false });
    doc.font(mainFont).fontSize(9).fillColor('#888780')
       .text(labels.page(1), X0 + CONT_W / 2, FOOT_Y, {
         width: CONT_W / 2, align: 'right', lineBreak: false,
       });

    // ── 13. Block tables — page 2 onwards ────────────────────────────────────
    const BLK_BANNER_H = 45;
    const TBL_MARGIN   = 40; // left/right margin for block tables

    doc.addPage();
    y = MARG;

    for (const block of project.blocks) {
      const stacks    = block.stacks;
      const nST       = stacks.length;
      const blockExcl = parseExcl(block.excludedFloors);
      const startF    = block.startingFloor ?? 1;
      const maxF      = startF + block.totalStoreys - 1;

      // ── Per-block dynamic column widths ────────────────────────────────────
      const availW     = PAGE_W - TBL_MARGIN * 2;
      const floorW     = 45;
      const baseStackW = Math.floor((availW - floorW) / nST);
      const tableW     = availW; // banner and all rows span full available width
      const tblX       = TBL_MARGIN;

      // Last stack column absorbs rounding remainder so rows fill tableW exactly
      const colW = (si) =>
        si === nST - 1 ? tableW - floorW - (nST - 1) * baseStackW : baseStackW;
      const colX = (si) => tblX + floorW + si * baseStackW;

      // Font sizes scale down when there are many stacks
      const cellFS = nST > 6 ? 7 : nST > 4 ? 8 : 9;
      const hdrFS  = nST > 6 ? 7 : 8;

      // ── Block stats ─────────────────────────────────────────────────────────
      const bUnits = stacks.flatMap(s => Object.values(unitMap[s.id] ?? {}));
      const bNSA   = bUnits.reduce((s, u) => s + (u.sizeSqft ?? 0), 0);
      const bRev   = bUnits.reduce((s, u) => s + u.finalPrice, 0);
      const bPSF   = bNSA  > 0 ? bRev / bNSA : null;
      const bHigh  = bUnits.length ? Math.max(...bUnits.map(u => u.finalPrice)) : null;
      const bLow   = bUnits.length ? Math.min(...bUnits.map(u => u.finalPrice)) : null;

      // ── Page break ──────────────────────────────────────────────────────────
      const exclCnt  = [...blockExcl].filter(f => f >= startF && f <= maxF).length;
      const blockH   = BLK_BANNER_H + TBL_H
        + (block.totalStoreys - exclCnt) * ROW_H
        + exclCnt * EXCL_H
        + FOOT_H;
      const remaining = PAGE_H - MARG - y;

      if (remaining < 60 || (blockH <= PAGE_H - MARG * 2 && remaining < blockH)) {
        doc.addPage();
        y = MARG;
      }

      // ── Block header banner — 45pt dark blue ───────────────────────────────
      fillRect(tblX, y, tableW, BLK_BANNER_H, '#0C447C');

      doc.font(boldFont).fontSize(18).fillColor('#FFFFFF')
         .text(block.blockName, tblX + 10, y + (BLK_BANNER_H - 18) / 2, {
           width: tableW / 2 - 10, lineBreak: false,
         });

      const statsLine1 = [
        `${labels.units_short}: ${bUnits.length}`,
        bPSF != null ? `${labels.avgPSF}: ${fmtPSF(bPSF)}` : null,
      ].filter(Boolean).join('   |   ');

      const statsLine2 = [
        bHigh != null ? `Highest: ${fmtPrice(bHigh)}` : null,
        bLow  != null ? `Lowest: ${fmtPrice(bLow)}`   : null,
      ].filter(Boolean).join('   |   ');

      doc.font(mainFont).fontSize(10).fillColor('#FFFFFF')
         .text(statsLine1, tblX + 5, y + 10, { width: tableW - 10, align: 'right', lineBreak: false });
      if (statsLine2) {
        doc.font(mainFont).fontSize(10).fillColor('#FFFFFF')
           .text(statsLine2, tblX + 5, y + 26, { width: tableW - 10, align: 'right', lineBreak: false });
      }
      y += BLK_BANNER_H;

      // ── Column header row — #185FA5 bg, white text ─────────────────────────
      fillRect(tblX, y, tableW, TBL_H, '#185FA5');
      cell(labels.floor, tblX, y + (TBL_H - hdrFS) / 2, floorW, {
        font: boldFont, size: hdrFS, color: '#FFFFFF',
      });
      stacks.forEach((stack, si) => {
        const cx  = colX(si);
        const cw  = colW(si);
        const lbl = `#${String(stack.stackNumber).padStart(2, '0')} ${stack.unitTypeCode ?? ''}`;
        const szl = stack.standardSizeSqft
          ? `${stack.standardSizeSqft.toLocaleString()} sf`
          : '';
        cell(lbl, cx, y + 4,           cw, { font: boldFont, size: hdrFS,                color: '#FFFFFF' });
        cell(szl, cx, y + 4 + hdrFS,   cw, { size: Math.max(6, hdrFS - 1), color: '#B5D4F4' });
      });
      y += TBL_H;

      // ── Floor rows — descending ─────────────────────────────────────────────
      let rowIdx = 0;

      for (let floor = maxF; floor >= startF; floor--) {
        const isExcl = blockExcl.has(floor);
        const rowH   = isExcl ? EXCL_H : ROW_H;

        // Mid-block page break → continuation header
        if (y + rowH > PAGE_H - MARG) {
          doc.addPage();
          y = MARG;
          fillRect(tblX, y, tableW, TBL_H, '#185FA5');
          cell(`${block.blockName} (${labels.cont})`, tblX + 4, y + (TBL_H - hdrFS) / 2, tableW - 8, {
            font: boldFont, size: hdrFS, color: '#FFFFFF', align: 'left',
          });
          y += TBL_H;
        }

        if (isExcl) {
          fillRect(tblX, y, tableW, EXCL_H, '#FFF8E6');
          doc.save().lineWidth(0.4).rect(tblX, y, tableW, EXCL_H).stroke('#FAC775').restore();
          cell(String(floor), tblX, y + 2, floorW, {
            size: Math.max(6, cellFS - 1), color: '#854F0B',
          });
          cell(labels.excluded, tblX + floorW, y + 2, tableW - floorW, {
            size: Math.max(6, cellFS - 1), color: '#854F0B',
          });
          y += EXCL_H;
          continue;
        }

        // Alternating row bg; floor column always #E6F1FB
        fillRect(tblX, y, tableW, ROW_H, rowIdx % 2 === 0 ? '#FFFFFF' : '#F5F9FE');
        fillRect(tblX, y, floorW, ROW_H, '#E6F1FB');
        cell(String(floor), tblX, y + (ROW_H - cellFS) / 2, floorW, {
          font: boldFont, size: cellFS, color: '#0C447C',
        });

        stacks.forEach((stack, si) => {
          const cx       = colX(si);
          const cw       = colW(si);
          const stkExcl  = parseExcl(stack.stackExcludedFloors);
          const effStart = stack.stackStartingFloor ?? block.startingFloor;
          if (floor < effStart || stkExcl.has(floor)) return;

          const u = unitMap[stack.id]?.[floor];
          if (!u) return;

          const lH    = cellFS + 1;
          const delta = deltaMap[stack.id]?.[floor];

          cell(fmtPSF(u.finalPSF), cx, y + 3, cw, {
            font: boldFont, size: cellFS, color: '#111827', align: 'right',
          });
          cell(fmtPrice(u.finalPrice), cx, y + 3 + lH, cw, {
            size: Math.max(6, cellFS - 1), color: '#374151', align: 'right',
          });
          if (delta != null) {
            cell(fmtDelta(delta), cx, y + 3 + lH * 2, cw, {
              size:  Math.max(5, cellFS - 2),
              color: delta >= 0 ? '#16A34A' : '#DC2626',
              align: 'right',
            });
          }
        });

        rowIdx++;
        y += ROW_H;
      }

      // ── Avg PSF footer — dark blue, white text ──────────────────────────────
      fillRect(tblX, y, tableW, FOOT_H, '#0C447C');
      cell(labels.avgPSF, tblX + 4, y + (FOOT_H - 10) / 2, floorW, {
        font: boldFont, size: 10, color: '#FFFFFF', align: 'left',
      });
      stacks.forEach((stack, si) => {
        const cx    = colX(si);
        const cw    = colW(si);
        const sUs   = Object.values(unitMap[stack.id] ?? {});
        const sSqft = sUs.reduce((s, u) => s + (u.sizeSqft ?? 0), 0);
        const sRev  = sUs.reduce((s, u) => s + u.finalPrice, 0);
        const sPSF  = sSqft > 0 ? sRev / sSqft : null;
        if (sPSF != null) {
          cell(fmtPSF(sPSF), cx, y + (FOOT_H - 10) / 2, cw, {
            font: boldFont, size: 10, color: '#FFFFFF', align: 'right',
          });
        }
      });
      y += FOOT_H + 20;
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

// ─── Showsuites helpers ───────────────────────────────────────────────────────

function getCellText(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && v.richText) {
    return v.richText.map(r => r.text).join('').trim();
  }
  return String(v).trim();
}

async function buildUnitLookup(projectId, scenarioId) {
  const map = {};

  if (scenarioId) {
    const scenario = await prisma.pricingScenario.findUnique({
      where:   { id: scenarioId },
      include: { snapshots: true },
    });
    if (!scenario) return null;

    const stackIds = [...new Set(scenario.snapshots.map(s => s.stackId))];
    const stacks   = await prisma.stack.findMany({
      where:  { id: { in: stackIds } },
      select: { id: true, block: { select: { blockName: true } } },
    });
    const stackBlock = {};
    for (const s of stacks) stackBlock[s.id] = s.block.blockName;

    for (const snap of scenario.snapshots) {
      const blockName = stackBlock[snap.stackId];
      if (!blockName) continue;
      map[`${blockName}|${snap.unitNumber}`] = { finalPSF: snap.finalPSF, finalPrice: snap.finalPrice };
    }
  } else {
    const units = await prisma.unit.findMany({
      where:  { stack: { block: { projectId } } },
      select: {
        unitNumber: true,
        finalPSF:   true,
        finalPrice: true,
        stack: { select: { block: { select: { blockName: true } } } },
      },
    });
    for (const u of units) {
      if (u.finalPSF == null || u.finalPrice == null) continue;
      map[`${u.stack.block.blockName}|${u.unitNumber}`] = { finalPSF: u.finalPSF, finalPrice: u.finalPrice };
    }
  }

  return map;
}

async function processShowsuitesWorkbook(fileBuffer, lookupMap, fill = true) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const ws = workbook.worksheets[0];
  if (!ws) throw Object.assign(new Error('No worksheets found in uploaded file'), { status: 400 });

  // Locate header row by scanning up to first 30 rows for "BLOCK NAME"
  const TARGETS = ['BLOCK NAME', 'UNIT LABEL', 'PSF LIST PRICE($)', 'LIST PRICE($)', 'PSF SELLING PRICE($)', 'SELLING PRICE($)'];
  let headerRowNum = null;
  const colMap = {};

  for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
    const row = ws.getRow(r);
    let foundBlockName = false;
    row.eachCell((cell, colNum) => {
      const text = getCellText(cell);
      if (TARGETS.includes(text)) {
        colMap[text] = colNum;
        if (text === 'BLOCK NAME') foundBlockName = true;
      }
    });
    if (foundBlockName) { headerRowNum = r; break; }
  }

  if (!headerRowNum) {
    throw Object.assign(new Error('Header row not found — expected column "BLOCK NAME" in template'), { status: 400 });
  }
  if (!colMap['UNIT LABEL']) {
    throw Object.assign(new Error('Required column "UNIT LABEL" not found in template'), { status: 400 });
  }

  const warnings = [];
  let total   = 0;
  let matched = 0;

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row       = ws.getRow(r);
    const blockName = getCellText(row.getCell(colMap['BLOCK NAME']));
    const unitLabel = getCellText(row.getCell(colMap['UNIT LABEL']));
    if (!blockName || !unitLabel) continue;
    total++;

    const hit = lookupMap[`${blockName}|${unitLabel}`];
    if (hit) {
      matched++;
      if (fill) {
        const psf   = Math.round(hit.finalPSF);
        const price = Math.round(hit.finalPrice);
        if (colMap['PSF LIST PRICE($)'])   row.getCell(colMap['PSF LIST PRICE($)']).value   = psf;
        if (colMap['LIST PRICE($)'])        row.getCell(colMap['LIST PRICE($)']).value        = price;
        if (colMap['PSF SELLING PRICE($)']) row.getCell(colMap['PSF SELLING PRICE($)']).value = psf;
        if (colMap['SELLING PRICE($)'])     row.getCell(colMap['SELLING PRICE($)']).value     = price;
      }
    } else {
      warnings.push({ blockName, unitLabel, reason: 'No matching unit in system' });
      if (fill) {
        if (colMap['PSF LIST PRICE($)'])   row.getCell(colMap['PSF LIST PRICE($)']).value   = 0;
        if (colMap['LIST PRICE($)'])        row.getCell(colMap['LIST PRICE($)']).value        = 0;
        if (colMap['PSF SELLING PRICE($)']) row.getCell(colMap['PSF SELLING PRICE($)']).value = 0;
        if (colMap['SELLING PRICE($)'])     row.getCell(colMap['SELLING PRICE($)']).value     = 0;
      }
    }
  }

  return { workbook, total, matched, unmatched: warnings.length, warnings };
}

// ─── POST /api/projects/:projectId/export/showsuites/preview ─────────────────
router.post('/:projectId/export/showsuites/preview', upload.single('file'), async (req, res, next) => {
  try {
    const { projectId }          = req.params;
    const { scenarioId = null }  = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const lookupMap = await buildUnitLookup(projectId, scenarioId || null);
    if (!lookupMap) return res.status(404).json({ error: 'Scenario not found' });

    const { total, matched, unmatched, warnings } =
      await processShowsuitesWorkbook(req.file.buffer, lookupMap, false);

    res.json({ totalRows: total, matched, unmatched, warnings });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── POST /api/projects/:projectId/export/showsuites ─────────────────────────
router.post('/:projectId/export/showsuites', upload.single('file'), async (req, res, next) => {
  try {
    const { projectId }          = req.params;
    const { scenarioId = null }  = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const lookupMap = await buildUnitLookup(projectId, scenarioId || null);
    if (!lookupMap) return res.status(404).json({ error: 'Scenario not found' });

    const { workbook, unmatched, warnings } =
      await processShowsuitesWorkbook(req.file.buffer, lookupMap, true);

    if (warnings.length > 0) res.setHeader('X-Export-Warnings', String(unmatched));

    const dateStr    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName   = project.nameEn.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
    const filename   = `${safeName}_PriceList_Filled_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
