import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  // Header / footer / floor-label column
  hBg:     '#E6F1FB',
  hText:   '#0C447C',
  hBorder: '#B5D4F4',
  // Alternating stack columns (data rows)
  altBg:   '#F5F9FE',
  // Manual override
  mBg:     '#FAEEDA',
  mBadgeBg:'#FAC775',
  mBadgeTx:'#633806',
  // Penthouse
  phBg:    '#EEEDFE',
  phBadgeBg:'#CECBF6',
  phBadgeTx:'#26215C',
  // Excluded floor row
  exBg:    '#FFF8E6',
  exText:  '#854F0B',
  exBorder:'#FAC775',
  // Toolbar
  tbBg:    '#F0F7FD',
  tbBorder:'#B5D4F4',
  // Light cell border
  cellBorder: '#EEF2F7',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseExcludedSet(str) {
  try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
}

function fmtPSF(v) {
  if (v == null || !isFinite(v)) return '—';
  return '$' + Math.round(v).toLocaleString();
}

function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  return '$' + Math.round(v).toLocaleString();
}

function computeStats(units) {
  const valid = units.filter(u => u.finalPSF != null && u.finalPrice != null);
  if (!valid.length) return { count: 0, avgPSF: null, highPrice: null, lowPrice: null };
  const avgPSF    = valid.reduce((s, u) => s + u.finalPrice, 0) / valid.reduce((s,u) => s + u.sizeSqft, 0);
  const highPrice = Math.max(...valid.map(u => u.finalPrice));
  const lowPrice  = Math.min(...valid.map(u => u.finalPrice));
  return { count: valid.length, avgPSF, highPrice, lowPrice };
}

// ─── SummaryPanel ─────────────────────────────────────────────────────────────
function SummaryPanel({ unitsRich, pricingParameters }) {
  const targetOverall = pricingParameters?.targetOverallAvgPSF ?? null;

  const targetBedroom = {};
  try {
    const parsed = JSON.parse(pricingParameters?.targetBedroomPSF || '{}');
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null && Number(v) > 0) targetBedroom[k] = Number(v);
    }
  } catch {}

  const priced    = unitsRich.filter(u => u.finalPrice != null && u.sizeSqft != null);
  const totalSqft = priced.reduce((s, u) => s + u.sizeSqft, 0);
  const totalRev  = priced.reduce((s, u) => s + u.finalPrice, 0);
  const achieved  = totalSqft > 0 ? totalRev / totalSqft : null;

  const brMap = {};
  for (const u of priced) {
    const br = u.bedroomType || 'Unknown';
    if (!brMap[br]) brMap[br] = { revenue: 0, sqft: 0 };
    brMap[br].revenue += u.finalPrice;
    brMap[br].sqft    += u.sizeSqft;
  }
  const bedroomTypes = Object.keys(brMap).sort();

  function statusColor(a, t) {
    if (a == null || t == null) return '#374151';
    const d = Math.abs(a - t);
    if (d <= 1)  return '#16A34A';
    if (d <= 10) return '#D97706';
    return '#DC2626';
  }
  function statusBg(a, t) {
    if (a == null || t == null) return '#FFFFFF';
    const d = Math.abs(a - t);
    if (d <= 1)  return '#F0FDF4';
    if (d <= 10) return '#FFFBEB';
    return '#FEF2F2';
  }
  function brStatusColor(a, t) {
    if (a == null || t == null) return '#374151';
    const d = Math.abs(a - t);
    if (d <= 5)  return '#16A34A';
    if (d <= 20) return '#D97706';
    return '#DC2626';
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* ── Overall PSF + aggregate totals ─────────────────────────────────── */}
      <div
        className="px-5 py-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3"
        style={{ backgroundColor: statusBg(achieved, targetOverall) }}
      >
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Overall Avg PSF
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: statusColor(achieved, targetOverall) }}
            >
              {fmtPSF(achieved)}
            </span>
            {targetOverall != null && (
              <span className="text-sm text-gray-400">/ {fmtPSF(targetOverall)} target</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-1">
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Units</div>
            <div className="text-lg font-semibold text-gray-800 tabular-nums">
              {priced.length.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total NSA</div>
            <div className="text-lg font-semibold text-gray-800 tabular-nums">
              {totalSqft.toLocaleString()} sqft
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total Revenue</div>
            <div className="text-lg font-semibold text-gray-800 tabular-nums">
              {fmtPrice(totalRev)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-bedroom breakdown ───────────────────────────────────────────── */}
      {bedroomTypes.length > 0 && (
        <div className="border-t border-gray-100 px-5 pt-3 pb-2">
          <div className="flex flex-wrap gap-x-8 gap-y-3 mb-2">
            {bedroomTypes.map(br => {
              const { revenue, sqft } = brMap[br];
              const brAchieved = sqft > 0 ? revenue / sqft : null;
              const brTarget   = targetBedroom[br] ?? null;
              return (
                <div key={br} className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                    {br}
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-base font-semibold tabular-nums"
                      style={{ color: brStatusColor(brAchieved, brTarget) }}
                    >
                      {fmtPSF(brAchieved)}
                    </span>
                    {brTarget != null && (
                      <span className="text-xs text-gray-400">/ {fmtPSF(brTarget)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 italic">
            Bedroom type targets are best-effort. Overall avg PSF takes priority.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── BlockPricingTable ────────────────────────────────────────────────────────
function BlockPricingTable({ block, onUnitChange, onAfterOverride, roundingUnit = 100 }) {
  const { t } = useTranslation();
  const [collapsed,      setCollapsed]      = useState(false);
  const [showFloorAvg,   setShowFloorAvg]   = useState(true);
  const [editingUnitId,  setEditingUnitId]  = useState(null);
  const [editingStackId, setEditingStackId] = useState(null);
  const [editingFloor,   setEditingFloor]   = useState(null);
  const [editPSF,        setEditPSF]        = useState('');
  const [editPrice,      setEditPrice]      = useState('');
  const [editSizeSqft,   setEditSizeSqft]   = useState(0);
  const [saving,         setSaving]         = useState(false);

  function openEdit(unit, stackId) {
    setEditingUnitId(unit.id);
    setEditingStackId(stackId);
    setEditingFloor(unit.floor);
    setEditPSF(unit.finalPSF  != null ? String(Math.round(unit.finalPSF  * 100) / 100) : '');
    setEditPrice(unit.finalPrice != null ? String(unit.finalPrice) : '');
    setEditSizeSqft(unit.sizeSqft ?? 0);
  }

  function handleEditPSFChange(val) {
    setEditPSF(val);
    const psf = parseFloat(val);
    if (isFinite(psf) && editSizeSqft > 0) {
      setEditPrice(String(Math.round(psf * editSizeSqft / roundingUnit) * roundingUnit));
    }
  }

  function handleEditPriceChange(val) {
    setEditPrice(val);
    const price = parseFloat(val);
    if (isFinite(price) && editSizeSqft > 0) {
      setEditPSF(String(Math.round(price / editSizeSqft * 100) / 100));
    }
  }

  function handleEditKeyDown(e) {
    if (e.key === 'Escape') { setEditingUnitId(null); return; }
    if (e.key === 'Enter')  { e.preventDefault(); handleSaveEdit(); }
  }

  async function handleSaveEdit() {
    const psf   = parseFloat(editPSF);
    const price = parseFloat(editPrice);
    if (!isFinite(psf) || !isFinite(price)) return;
    setSaving(true);
    const savedUnitId  = editingUnitId;
    const savedStackId = editingStackId;
    const savedFloor   = editingFloor;
    try {
      const res = await fetch(`/api/units/${savedUnitId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ finalPSF: psf, finalPrice: price, isManualOverride: true }),
      });
      if (!res.ok) throw new Error('Save failed');
      onUnitChange?.(savedUnitId, { finalPSF: psf, finalPrice: price, isManualOverride: true });
      setEditingUnitId(null);
      setEditingStackId(null);
      setEditingFloor(null);
      onAfterOverride?.(savedStackId, savedFloor);
    } catch {
      // keep edit open so user can retry
    } finally {
      setSaving(false);
    }
  }

  const [resetting, setResetting] = useState(new Set());

  async function handleReset(unit) {
    setResetting(prev => new Set([...prev, unit.id]));
    try {
      const res = await fetch(`/api/units/${unit.id}/reset`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Reset failed');
      const data = await res.json();
      onUnitChange?.(unit.id, {
        finalPSF:         data.finalPSF,
        finalPrice:       data.finalPrice,
        isManualOverride: false,
      });
    } catch {
      // silently keep state on error
    } finally {
      setResetting(prev => { const s = new Set(prev); s.delete(unit.id); return s; });
    }
  }

  // Stacks left-to-right by stack number
  const sortedStacks  = [...block.stacks].sort((a, b) => a.stackNumber - b.stackNumber);
  const blockExcluded = parseExcludedSet(block.excludedFloors);
  const stackExclSets = sortedStacks.map(s => parseExcludedSet(s.stackExcludedFloors));

  // All floors descending (highest first)
  const maxFloor  = block.startingFloor + block.totalStoreys - 1;
  const allFloors = [];
  for (let f = maxFloor; f >= block.startingFloor; f--) allFloors.push(f);

  // Unit lookup: `${floor}-${stackId}` → unit
  const unitMap = {};
  for (const stack of sortedStacks) {
    for (const unit of (stack.units || [])) {
      unitMap[`${unit.floor}-${stack.id}`] = unit;
    }
  }

  // Block-level stats
  const allBlockUnits = sortedStacks.flatMap(s => s.units || []);
  const stats         = computeStats(allBlockUnits);

  // Per-stack average PSF for the footer
  const stackAvgPSFs = sortedStacks.map(stack => {
    const us = (stack.units || []).filter(u => u.finalPSF != null);
    return us.length ? us.reduce((s, u) => s + u.finalPSF, 0) / us.length : null;
  });

  // Per-stack: for each floor, the PSF of the unit at the floor just below (for delta display)
  const prevStackPSF = sortedStacks.map(stack => {
    const sorted = [...(stack.units || [])].filter(u => u.finalPSF != null).sort((a, b) => a.floor - b.floor);
    const map = {};
    for (let j = 1; j < sorted.length; j++) map[sorted[j].floor] = sorted[j - 1].finalPSF;
    return map;
  });

  // Total visible columns (floor + stacks + optional avg)
  const totalCols = 1 + sortedStacks.length + (showFloorAvg ? 1 : 0);

  // Reusable style objects
  const headerCell = {
    backgroundColor: C.hBg,
    color:           C.hText,
    borderRight:     `1px solid ${C.hBorder}`,
    borderBottom:    `1px solid ${C.hBorder}`,
  };
  const footerCell = {
    backgroundColor: C.hBg,
    color:           C.hText,
    borderRight:     `1px solid ${C.hBorder}`,
    borderTop:       `2px solid ${C.hBorder}`,
  };

  return (
    <div
      className="rounded-xl overflow-hidden shadow-sm"
      style={{ border: `1px solid ${C.hBorder}` }}
    >
      {/* ── Card header / collapse toggle ─────────────────────────────────── */}
      <button
        type="button"
        className="w-full flex items-start justify-between gap-4 text-left px-4 py-3
                   transition-[filter] hover:brightness-95"
        style={{ backgroundColor: C.hBg }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-sm" style={{ color: C.hText }}>
              {block.blockName}
            </span>
            <span className="text-xs" style={{ color: C.hText, opacity: 0.65 }}>
              {block.totalStoreys} {t('pricing.storeys')}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-5 text-xs" style={{ color: C.hText, opacity: 0.8 }}>
            <span>{t('pricing.statTotalUnits')}: <strong>{stats.count}</strong></span>
            <span>{t('pricing.statAvgPSF')}: <strong>{fmtPSF(stats.avgPSF)}</strong></span>
            <span>{t('pricing.statHighPrice')}: <strong>{fmtPrice(stats.highPrice)}</strong></span>
            <span>{t('pricing.statLowPrice')}: <strong>{fmtPrice(stats.lowPrice)}</strong></span>
          </div>
        </div>
        <svg
          className={`w-5 h-5 flex-shrink-0 mt-0.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          style={{ color: C.hText }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <>
          {/* ── Toolbar ───────────────────────────────────────────────────── */}
          <div
            className="px-4 py-2 flex items-center justify-end"
            style={{ backgroundColor: C.tbBg, borderBottom: `1px solid ${C.tbBorder}` }}
          >
            <button
              type="button"
              className="text-xs font-medium px-3 py-1.5 rounded border transition-colors"
              style={{
                color:           C.hText,
                borderColor:     C.hBorder,
                backgroundColor: showFloorAvg ? C.hBg : 'white',
              }}
              onClick={() => setShowFloorAvg(v => !v)}
            >
              {showFloorAvg ? t('Hide Floor Average') : t('Show Floor Average')}
            </button>
          </div>

          {/* ── Table ─────────────────────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table
              className="border-collapse text-xs"
              style={{ width: '100%', minWidth: `${72 + sortedStacks.length * 112 + (showFloorAvg ? 84 : 0)}px` }}
            >
              {/* Column headers */}
              <thead>
                <tr>
                  <th
                    className="px-3 py-2.5 text-left font-semibold whitespace-nowrap"
                    style={{ ...headerCell, width: 72 }}
                  >
                    {t('pricing.floor')}
                  </th>

                  {sortedStacks.map((stack, i) => (
                    <th
                      key={stack.id}
                      className="px-3 py-2 text-center font-medium"
                      style={{ ...headerCell, minWidth: 112, borderRight: i === sortedStacks.length - 1 && !showFloorAvg ? 'none' : `1px solid ${C.hBorder}` }}
                    >
                      <div className="font-semibold" style={{ color: C.hText }}>
                        #{String(stack.stackNumber).padStart(2, '0')}&thinsp;{stack.unitTypeCode}
                      </div>
                      <div className="font-normal text-[11px]" style={{ color: C.hText, opacity: 0.75 }}>
                        {stack.bedroomType}
                      </div>
                      <div className="font-normal text-[11px]" style={{ color: C.hText, opacity: 0.55 }}>
                        {stack.standardSizeSqft?.toLocaleString()} sqft
                      </div>
                    </th>
                  ))}

                  {showFloorAvg && (
                    <th
                      className="px-3 py-2.5 text-center font-semibold whitespace-nowrap"
                      style={{ ...headerCell, minWidth: 84, borderRight: 'none' }}
                    >
                      {t('pricing.floorAvg')}
                    </th>
                  )}
                </tr>
              </thead>

              <tbody>
                {allFloors.map(floor => {
                  // ── Excluded floor ────────────────────────────────────────
                  if (blockExcluded.has(floor)) {
                    return (
                      <tr
                        key={floor}
                        style={{
                          backgroundColor: C.exBg,
                          borderTop:       `1px solid ${C.exBorder}`,
                          borderBottom:    `1px solid ${C.exBorder}`,
                        }}
                      >
                        <td
                          colSpan={totalCols}
                          className="px-4 py-1.5 text-center italic font-medium"
                          style={{ color: C.exText, fontSize: 11 }}
                        >
                          {t('pricing.floor')} {floor} — {t('pricing.excludedFloorLabel')} —
                        </td>
                      </tr>
                    );
                  }

                  // ── Regular floor ─────────────────────────────────────────
                  const rowUnits  = sortedStacks.map(s => unitMap[`${floor}-${s.id}`] ?? null);
                  const validPSFs = rowUnits.filter(u => u?.finalPSF != null).map(u => u.finalPSF);
                  const floorAvg  = validPSFs.length
                    ? validPSFs.reduce((a, v) => a + v, 0) / validPSFs.length
                    : null;

                  return (
                    <tr key={floor}>
                      {/* Floor label */}
                      <td
                        className="px-3 py-2 font-semibold whitespace-nowrap"
                        style={{ ...headerCell, fontSize: 11 }}
                      >
                        {t('pricing.floor')} {floor}
                      </td>

                      {/* Unit cells */}
                      {sortedStacks.map((stack, i) => {
                        const unit      = rowUnits[i];
                        const stackExcl = stackExclSets[i].has(floor);

                        // Background priority: PH > manual > alt-column > default
                        let bg = i % 2 === 1 ? C.altBg : '#FFFFFF';
                        if (unit?.isManualOverride) bg = C.mBg;
                        if (unit?.isPenthouse)       bg = C.phBg;

                        return (
                          <td
                            key={stack.id}
                            className="px-3 py-1.5 align-middle"
                            style={{
                              backgroundColor: bg,
                              borderRight:     `1px solid ${C.cellBorder}`,
                              borderBottom:    `1px solid ${C.cellBorder}`,
                              cursor:          unit ? 'pointer' : 'default',
                            }}
                            onClick={() => unit && editingUnitId !== unit.id && openEdit(unit, stack.id)}
                          >
                            {unit ? (
                              editingUnitId === unit.id ? (
                                /* ── Inline edit form ─────────────────────────── */
                                <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <span style={{ fontSize: 9, color: '#9CA3AF', minWidth: 20 }}>PSF</span>
                                    <input
                                      autoFocus
                                      type="number"
                                      value={editPSF}
                                      onChange={e => handleEditPSFChange(e.target.value)}
                                      onKeyDown={handleEditKeyDown}
                                      className="w-full text-right text-xs rounded px-1 py-0.5"
                                      style={{ border: `1px solid ${C.hBorder}`, outline: 'none', minWidth: 0 }}
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span style={{ fontSize: 9, color: '#9CA3AF', minWidth: 20 }}>$</span>
                                    <input
                                      type="number"
                                      value={editPrice}
                                      onChange={e => handleEditPriceChange(e.target.value)}
                                      onKeyDown={handleEditKeyDown}
                                      className="w-full text-right text-xs rounded px-1 py-0.5"
                                      style={{ border: `1px solid ${C.hBorder}`, outline: 'none', minWidth: 0 }}
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2 mt-0.5">
                                    <button
                                      className="text-gray-400 hover:text-gray-600"
                                      style={{ fontSize: 10 }}
                                      onClick={() => setEditingUnitId(null)}
                                    >Esc</button>
                                    <button
                                      className="font-semibold text-blue-600 hover:text-blue-800"
                                      style={{ fontSize: 10 }}
                                      disabled={saving}
                                      onClick={handleSaveEdit}
                                    >{saving ? '…' : 'Save'}</button>
                                  </div>
                                </div>
                              ) : (
                                /* ── Display mode ─────────────────────────────── */
                                <div className="relative group w-full flex flex-col items-end gap-0.5">
                                  {unit.isManualOverride && (
                                    <button
                                      className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 leading-none font-bold transition-opacity"
                                      style={{ fontSize: 11, color: C.mBadgeTx, lineHeight: 1 }}
                                      title="Reset to solver value"
                                      disabled={resetting.has(unit.id)}
                                      onClick={e => { e.stopPropagation(); handleReset(unit); }}
                                    >{resetting.has(unit.id) ? '…' : '×'}</button>
                                  )}
                                  <div className="flex items-center gap-1 justify-end">
                                    {unit.isPenthouse && (
                                      <span
                                        className="px-1 py-px rounded leading-tight font-bold"
                                        style={{ fontSize: 9, backgroundColor: C.phBadgeBg, color: C.phBadgeTx }}
                                      >PH</span>
                                    )}
                                    {unit.isManualOverride && (
                                      <>
                                        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 9, height: 9, color: C.mBadgeTx, flexShrink: 0 }}>
                                          <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                                        </svg>
                                        <span
                                          className="px-1 py-px rounded leading-tight font-bold"
                                          style={{ fontSize: 9, backgroundColor: C.mBadgeBg, color: C.mBadgeTx }}
                                        >M</span>
                                      </>
                                    )}
                                    <span className="font-semibold tabular-nums text-gray-900">
                                      {fmtPSF(unit.finalPSF)}
                                    </span>
                                  </div>
                                  <span className="tabular-nums text-gray-400" style={{ fontSize: 10 }}>
                                    {fmtPrice(unit.finalPrice)}
                                  </span>
                                  {(() => {
                                    const prev  = prevStackPSF[i]?.[unit.floor];
                                    if (prev == null || unit.finalPSF == null) return null;
                                    const delta = unit.finalPSF - prev;
                                    return (
                                      <span className="tabular-nums" style={{ fontSize: 9, color: '#9CA3AF' }}>
                                        {(delta >= 0 ? '+' : '-') + fmtPSF(Math.abs(delta))}
                                      </span>
                                    );
                                  })()}
                                </div>
                              )
                            ) : stackExcl ? (
                              <span className="block text-right text-gray-300" style={{ fontSize: 11 }}>—</span>
                            ) : (
                              <span className="block text-right text-gray-200" style={{ fontSize: 11 }}>·</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Floor Avg */}
                      {showFloorAvg && (
                        <td
                          className="px-3 py-2 text-right tabular-nums font-semibold"
                          style={{
                            fontSize:        11,
                            color:           floorAvg != null ? C.hText : '#D1D5DB',
                            borderBottom:    `1px solid ${C.cellBorder}`,
                            backgroundColor: '#FFFFFF',
                          }}
                        >
                          {fmtPSF(floorAvg)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>

              {/* Avg PSF footer */}
              <tfoot>
                <tr>
                  <td
                    className="px-3 py-2 font-semibold whitespace-nowrap"
                    style={{ ...footerCell, fontSize: 11 }}
                  >
                    {t('pricing.avgPSF')}
                  </td>
                  {stackAvgPSFs.map((avg, i) => (
                    <td
                      key={sortedStacks[i].id}
                      className="px-3 py-2 text-right tabular-nums font-semibold"
                      style={{
                        ...footerCell,
                        fontSize:    11,
                        borderRight: i === stackAvgPSFs.length - 1 && !showFloorAvg ? 'none' : `1px solid ${C.hBorder}`,
                      }}
                    >
                      {fmtPSF(avg)}
                    </td>
                  ))}
                  {showFloorAvg && (
                    <td style={{ ...footerCell, borderRight: 'none' }} />
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── PricingEngine ────────────────────────────────────────────────────────────
export default function PricingEngine() {
  const { t }         = useTranslation();
  const { projectId } = useParams();
  const navigate      = useNavigate();

  const [projects,        setProjects]        = useState([]);
  const [project,         setProject]         = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult,  setGenerateResult]  = useState(null);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!projectId) { setProject(null); setError(null); return; }
    setLoading(true); setError(null);
    fetch(`/api/projects/${projectId}`)
      .then(r => { if (!r.ok) throw new Error('Project not found'); return r.json(); })
      .then(setProject)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const allUnits = project
    ? project.blocks.flatMap(b => b.stacks.flatMap(s => s.units || []))
    : [];
  const allUnitsRich = project
    ? project.blocks.flatMap(b =>
        b.stacks.flatMap(s => (s.units || []).map(u => ({ ...u, bedroomType: s.bedroomType })))
      )
    : [];
  const hasUnits            = allUnits.length > 0;
  const manualOverrideCount = allUnits.filter(u => u.isManualOverride).length;

  function handleUnitChange(unitId, updates) {
    setProject(prev => prev ? ({
      ...prev,
      blocks: prev.blocks.map(b => ({
        ...b,
        stacks: b.stacks.map(s => ({
          ...s,
          units: (s.units || []).map(u => u.id === unitId ? { ...u, ...updates } : u),
        })),
      })),
    }) : prev);
  }

  async function handleAfterOverride(stackId, fromFloor) {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/recalculate-above`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stackId, fromFloor }),
      });
      const projRes = await fetch(`/api/projects/${projectId}`);
      if (projRes.ok) setProject(await projRes.json());
    } catch {
      // silently ignore — override is already saved, recalculation is best-effort
    }
  }

  async function handleGenerate() {
    if (!projectId) return;
    setGenerateLoading(true);
    setGenerateResult(null);
    setError(null);
    try {
      const genRes = await fetch(`/api/projects/${projectId}/generate-units`, { method: 'POST' });
      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Generation failed');
      }
      const result = await genRes.json();
      setGenerateResult(result);
      const projRes = await fetch(`/api/projects/${projectId}`);
      if (projRes.ok) setProject(await projRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerateLoading(false);
    }
  }

  const sortedBlocks = project
    ? [...project.blocks].sort((a, b) =>
        String(a.blockName).localeCompare(String(b.blockName), undefined, { numeric: true, sensitivity: 'base' })
      )
    : [];

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('pricing.title')}</h1>
        <select
          className="input w-56"
          value={projectId ?? ''}
          onChange={e => navigate(e.target.value ? `/pricing/${e.target.value}` : '/pricing')}
        >
          <option value="">— {t('pricing.selectProject')} —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.nameEn}</option>
          ))}
        </select>
      </div>

      {/* Empty state */}
      {!projectId && !loading && (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-sm">{t('pricing.noProject')}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="card text-center py-12 text-red-500">
          <p className="text-sm">{error}</p>
        </div>
      )}

      {project && !loading && (
        <>
          {/* Project name + generate */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{project.nameEn}</h2>
              {project.nameZh && <p className="text-sm text-gray-500">{project.nameZh}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {manualOverrideCount > 0 && (
                <p className="text-xs" style={{ color: '#92400E' }}>
                  ⚠ {manualOverrideCount} unit{manualOverrideCount !== 1 ? 's have' : ' has'} manual overrides — will be preserved
                </p>
              )}
              <button
                className="btn btn-primary"
                disabled={generateLoading}
                onClick={handleGenerate}
              >
                {generateLoading ? 'Generating…' : 'Generate Pricing'}
              </button>
            </div>
          </div>

          {/* Summary panel */}
          {hasUnits && (
            <SummaryPanel
              unitsRich={allUnitsRich}
              pricingParameters={project.pricingParameters}
            />
          )}

          {/* Generate result banner */}
          {generateResult && (
            <div
              className="card px-4 py-3 flex items-start justify-between gap-4"
              style={{ backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: '#166534' }}>
                  {generateResult.totalUnits} units generated
                  {generateResult.achievedOverallAvgPSF != null && ` · Avg PSF ${fmtPSF(generateResult.achievedOverallAvgPSF)}`}
                  {generateResult.manualOverrideCount > 0 && ` · ${generateResult.manualOverrideCount} override${generateResult.manualOverrideCount !== 1 ? 's' : ''} preserved`}
                </p>
                {generateResult.correctionWarning && (
                  <p className="text-xs mt-0.5" style={{ color: '#92400E' }}>⚠ {generateResult.correctionWarning}</p>
                )}
              </div>
              <button
                onClick={() => setGenerateResult(null)}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                style={{ fontSize: 14, lineHeight: 1 }}
              >✕</button>
            </div>
          )}

          {/* No units yet */}
          {!hasUnits && (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">🏗</div>
              <p className="text-sm">{t('pricing.noUnitsGenerated')}</p>
            </div>
          )}

          {/* Block tables */}
          {hasUnits && (
            <div className="space-y-4">
              {sortedBlocks.map(block => (
                <BlockPricingTable
                  key={block.id}
                  block={block}
                  onUnitChange={handleUnitChange}
                  onAfterOverride={handleAfterOverride}
                  roundingUnit={project.pricingParameters?.roundingUnit ?? project.roundingUnit ?? 100}
                />
              ))}
            </div>
          )}

          {/* Legend */}
          {hasUnits && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500 pt-1">
              <span className="font-semibold text-gray-600">{t('pricing.legend')}:</span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded shrink-0 inline-block"
                  style={{ backgroundColor: C.mBg, border: `1px solid ${C.mBadgeBg}` }} />
                {t('pricing.legendManual')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded shrink-0 inline-block"
                  style={{ backgroundColor: C.phBg, border: `1px solid ${C.phBadgeBg}` }} />
                {t('pricing.legendPenthouse')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded shrink-0 inline-block"
                  style={{ backgroundColor: C.exBg, border: `1px solid ${C.exBorder}` }} />
                {t('pricing.legendExcluded')}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
