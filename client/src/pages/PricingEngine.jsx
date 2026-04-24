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

// ─── MetricCard ───────────────────────────────────────────────────────────────
function MetricCard({ label, value }) {
  return (
    <div className="card py-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value ?? '—'}</div>
    </div>
  );
}

// ─── BlockPricingTable ────────────────────────────────────────────────────────
function BlockPricingTable({ block }) {
  const { t } = useTranslation();
  const [collapsed,    setCollapsed]    = useState(false);
  const [showFloorAvg, setShowFloorAvg] = useState(true);

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
                            }}
                          >
                            {unit ? (
                              <div className="flex flex-col items-end gap-0.5">
                                {/* PSF + badges */}
                                <div className="flex items-center gap-1 justify-end">
                                  {unit.isPenthouse && (
                                    <span
                                      className="px-1 py-px rounded leading-tight font-bold"
                                      style={{ fontSize: 9, backgroundColor: C.phBadgeBg, color: C.phBadgeTx }}
                                    >PH</span>
                                  )}
                                  {unit.isManualOverride && (
                                    <span
                                      className="px-1 py-px rounded leading-tight font-bold"
                                      style={{ fontSize: 9, backgroundColor: C.mBadgeBg, color: C.mBadgeTx }}
                                    >M</span>
                                  )}
                                  <span className="font-semibold tabular-nums text-gray-900">
                                    {fmtPSF(unit.finalPSF)}
                                  </span>
                                </div>
                                {/* Price */}
                                <span className="tabular-nums text-gray-400" style={{ fontSize: 10 }}>
                                  {fmtPrice(unit.finalPrice)}
                                </span>
                              </div>
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

  const [projects, setProjects] = useState([]);
  const [project,  setProject]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

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
  const projectStats = computeStats(allUnits);
  const hasUnits     = allUnits.length > 0;

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
          {/* Project name */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{project.nameEn}</h2>
            {project.nameZh && <p className="text-sm text-gray-500">{project.nameZh}</p>}
          </div>

          {/* Summary metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label={t('pricing.statTotalUnits')} value={projectStats.count.toLocaleString()} />
            <MetricCard label={t('pricing.statAvgPSF')}     value={fmtPSF(projectStats.avgPSF)} />
            <MetricCard label={t('pricing.statHighPrice')}  value={fmtPrice(projectStats.highPrice)} />
            <MetricCard label={t('pricing.statLowPrice')}   value={fmtPrice(projectStats.lowPrice)} />
          </div>

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
                <BlockPricingTable key={block.id} block={block} />
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
