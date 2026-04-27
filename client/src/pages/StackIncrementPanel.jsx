import { useState, useEffect } from 'react';

// ── helpers ───────────────────────────────────────────────────────────────────
function parseExclSet(str) {
  try { return new Set(JSON.parse(str || '[]')); } catch { return new Set(); }
}

function getValidFloors(stack, block) {
  if (!block) return [];
  const blockExcl = parseExclSet(block.excludedFloors);
  const stackExcl = parseExclSet(stack.stackExcludedFloors);
  const combined  = new Set([...blockExcl, ...stackExcl]);
  const start     = stack.stackStartingFloor ?? block.startingFloor;
  const maxFloor  = block.startingFloor + block.totalStoreys - 1;
  const floors    = [];
  for (let f = start; f <= maxFloor; f++) {
    if (!combined.has(f)) floors.push(f);
  }
  return floors;
}

function computeAvgPSF(startPSF, bands, validFloors) {
  if (!validFloors.length || isNaN(startPSF)) return null;
  const sorted = [...bands].sort((a, b) => a.fromFloor - b.fromFloor);
  let cumOffset = 0, totalOffset = 0;
  for (let i = 0; i < validFloors.length; i++) {
    if (i > 0) {
      const floor = validFloors[i];
      const band  = sorted.find(b => b.fromFloor <= floor && floor <= b.toFloor);
      cumOffset  += band ? (Number(band.incrementPSF) || 0) : 0;
    }
    totalOffset += cumOffset;
  }
  return startPSF + totalOffset / validFloors.length;
}

function devColor(dev) {
  if (dev == null) return '#374151';
  const d = Math.abs(dev);
  if (d <= 5)  return '#16A34A';
  if (d <= 20) return '#D97706';
  return '#DC2626';
}

// ── StackIncrementPanel ───────────────────────────────────────────────────────
export default function StackIncrementPanel({ stack, project, onClose, onApply }) {
  const block    = project?.blocks?.find(b => b.stacks.some(s => s.id === stack.id));
  const rankData = project?.ranks?.find(r => r.id === stack.rankId);

  const rankBands = (rankData?.floorIncrements ?? []).map(fi => ({
    fromFloor:    fi.fromFloor,
    toFloor:      fi.toFloor,
    incrementPSF: fi.incrementPSF,
  }));

  function initialBands() {
    if (stack.stackIncrementsLocked && stack.stackIncrements) {
      try {
        return JSON.parse(stack.stackIncrements)
          .sort((a, b) => a.fromFloor - b.fromFloor);
      } catch {}
    }
    return rankBands;
  }

  const validFloors = getValidFloors(stack, block);

  // Derive initial values from actual unit data so they match the pricing table
  function initFromUnits(units) {
    const sorted     = [...(units ?? [])].sort((a, b) => a.floor - b.floor);
    const startPSF   = sorted[0]?.finalPSF ?? stack.stackStartingPSF ?? 0;
    const revenue    = sorted.reduce((s, u) => s + (u.finalPrice ?? 0), 0);
    const sqft       = sorted.reduce((s, u) => s + (u.sizeSqft   ?? 0), 0);
    const avgPSF     = sqft > 0 ? revenue / sqft : 0;
    return { startPSF, avgPSF };
  }

  const { startPSF: initStartPSF, avgPSF: initAvgPSF } = initFromUnits(stack.units);

  const [startPSFInput,      setStartPSFInput]      = useState(String(initStartPSF));
  const [startPSFLocked,     setStartPSFLocked]     = useState(stack.stackStartingPSFLocked ?? false);
  const [startPSFEditing,    setStartPSFEditing]    = useState(false);
  const [startPSFDraft,      setStartPSFDraft]      = useState('');
  const [startingPSFEdited,  setStartingPSFEdited]  = useState(false);
  const [bands,           setBands]           = useState(initialBands());
  const [customBands,     setCustomBands]     = useState(stack.stackIncrementsLocked ?? false);
  const [stackAvgPSF,     setStackAvgPSF]     = useState(initAvgPSF);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState(null);
  const [successMessage,  setSuccessMessage]  = useState(null);

  // Reset all local state when switching to a different stack
  useEffect(() => {
    const { startPSF: actualStart, avgPSF: actualAvg } = initFromUnits(stack.units);

    setStartPSFInput(String(actualStart));
    setStartPSFLocked(stack.stackStartingPSFLocked ?? false);
    setCustomBands(stack.stackIncrementsLocked ?? false);
    if (stack.stackIncrementsLocked && stack.stackIncrements) {
      try {
        setBands(JSON.parse(stack.stackIncrements).sort((a, b) => a.fromFloor - b.fromFloor));
      } catch {
        setBands(rankBands);
      }
    } else {
      setBands(rankBands);
    }
    setStackAvgPSF(actualAvg);
    setStartPSFEditing(false);
    setStartingPSFEdited(false);
    setError(null);
    setSuccessMessage(null);
  }, [stack.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live projected stats (from current input values)
  const startNum      = parseFloat(startPSFInput);
  const projectedAvg  = computeAvgPSF(startNum, bands, validFloors);

  let brTargetPSF = null;
  try {
    const parsed = JSON.parse(project?.pricingParameters?.targetBedroomPSF || '{}');
    brTargetPSF  = parsed[stack.bedroomType] ?? null;
  } catch {}
  if (brTargetPSF == null) brTargetPSF = project?.pricingParameters?.targetOverallAvgPSF ?? null;

  // Deviation based on actual (what is currently in the pricing table)
  const deviation = stackAvgPSF > 0 && brTargetPSF != null ? stackAvgPSF - brTargetPSF : null;
  const dc = devColor(deviation);

  // Band operations
  function updateBand(idx, key, val) {
    setBands(prev => prev.map((b, i) =>
      i === idx ? { ...b, [key]: val === '' ? '' : Number(val) } : b
    ));
  }
  function deleteBand(idx) {
    setBands(prev => prev.filter((_, i) => i !== idx));
  }
  function addBand() {
    const last   = bands[bands.length - 1];
    const newFrom = last ? last.toFloor : 1;
    setBands(prev => [...prev, { fromFloor: newFrom, toFloor: newFrom + 5, incrementPSF: 0 }]);
  }

  // Starting PSF edit confirmation
  function confirmStartPSF() {
    const trimmed = startPSFDraft.trim();
    if (trimmed === '' || isNaN(parseFloat(trimmed))) {
      // User cleared the field — unlock and revert to solver value
      setStartPSFInput(String(initStartPSF));
      setStartPSFLocked(false);
      setStartingPSFEdited(false);
    } else {
      setStartPSFInput(trimmed);
      setStartPSFLocked(true);
      setStartingPSFEdited(true);
    }
    setStartPSFEditing(false);
  }

  // API helpers
  async function patchStack(body) {
    const res = await fetch(`/api/stacks/${stack.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Patch failed'); }
  }
  async function regenerateStack(id) {
    const res = await fetch(`/api/stacks/${id}/regenerate`, { method: 'POST' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Regenerate failed'); }
  }

  async function handleApplyStack() {
    setSaving(true); setError(null); setSuccessMessage(null);
    try {
      await patchStack({
        stackIncrements:       customBands ? JSON.stringify(bands) : null,
        stackIncrementsLocked: true,
        ...(startingPSFEdited && {
          stackStartingPSF:       startNum,
          stackStartingPSFLocked: true,
        }),
      });
      await regenerateStack(stack.id);
      setSuccessMessage('Applied successfully');
      setTimeout(() => {
        setSuccessMessage(null);
        onApply?.();
        onClose();
      }, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyAll() {
    setSaving(true); setError(null); setSuccessMessage(null);
    try {
      const bulkRes = await fetch(`/api/projects/${project.id}/stacks/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rankId:                 stack.rankId,
          typeCode:               stack.unitTypeCode,
          stackStartingPSF:       startPSFLocked ? startNum : null,
          stackStartingPSFLocked: startPSFLocked,
          stackIncrements:        customBands ? bands : null,
          stackIncrementsLocked:  customBands,
        }),
      });
      if (!bulkRes.ok) { const d = await bulkRes.json(); throw new Error(d.error || 'Bulk update failed'); }
      const { stackIds } = await bulkRes.json();
      await Promise.all(stackIds.map(id => regenerateStack(id)));
      setSuccessMessage('Applied successfully');
      setTimeout(() => {
        setSuccessMessage(null);
        onApply?.();
        onClose();
      }, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true); setError(null); setSuccessMessage(null);
    try {
      const res = await fetch(`/api/stacks/${stack.id}/reset`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Reset failed'); }
      setSuccessMessage('Reset to rank defaults');
      setTimeout(() => {
        setSuccessMessage(null);
        onApply?.();
        onClose();
      }, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 440,
        background: '#fff',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.14)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ background: '#E6F1FB', borderBottom: '1px solid #B5D4F4', padding: '14px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0C447C' }}>
              Stack {String(stack.stackNumber).padStart(2, '0')} — {stack.unitTypeCode}
            </div>
            <div style={{ fontSize: 12, color: '#4B7BA8', marginTop: 3 }}>
              {stack.bedroomType}
              {stack.standardSizeSqft != null && ` · ${stack.standardSizeSqft.toLocaleString()} sqft`}
              {rankData && ` · Rank ${rankData.rankNumber} ${rankData.labelEn}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ color: '#6B7280', fontSize: 20, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          >✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Starting PSF */}
        <section>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Starting PSF (Floor 1)
          </label>
          {startPSFEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                autoFocus
                type="number"
                step="1"
                value={startPSFDraft}
                onChange={e => setStartPSFDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  { e.preventDefault(); confirmStartPSF(); }
                  if (e.key === 'Escape') setStartPSFEditing(false);
                }}
                className="input text-sm tabular-nums"
                style={{ width: 110 }}
              />
              <button
                onClick={confirmStartPSF}
                title="Confirm"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#16A34A', lineHeight: 1, padding: '0 2px' }}
              >✓</button>
              <button
                onClick={() => setStartPSFEditing(false)}
                title="Cancel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9CA3AF', lineHeight: 1, padding: '0 2px' }}
              >✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                ${Math.round(parseFloat(startPSFInput) || 0).toLocaleString()}
              </span>
              {startPSFLocked && (
                <span title="Custom locked value" style={{ fontSize: 13, lineHeight: 1 }}>🔒</span>
              )}
              <button
                onClick={() => {
                  setStartPSFDraft(String(Math.round(parseFloat(startPSFInput) || 0)));
                  setStartPSFEditing(true);
                }}
                title="Edit starting PSF"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#9CA3AF', lineHeight: 1, padding: '0 3px' }}
              >✎</button>
            </div>
          )}
        </section>

        {/* Floor increment bands */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Floor Increment Bands</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6B7280', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={customBands}
                onChange={e => {
                  setCustomBands(e.target.checked);
                  if (!e.target.checked) setBands(rankBands);
                }}
                className="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500"
              />
              Override rank defaults
            </label>
          </div>

          {!customBands && (
            <p style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 8 }}>
              From Rank — shared template (read-only preview)
            </p>
          )}

          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#6B7280', width: 80 }}>From fl.</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#6B7280', width: 80 }}>To fl.</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#6B7280' }}>PSF/floor</th>
                {customBands && <th style={{ width: 28 }} />}
              </tr>
            </thead>
            <tbody>
              {bands.map((band, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '4px 6px' }}>
                    {customBands
                      ? <input type="number" value={band.fromFloor ?? ''} onChange={e => updateBand(idx, 'fromFloor', e.target.value)}
                          className="input text-xs tabular-nums" style={{ width: 60 }} />
                      : <span className="tabular-nums" style={{ color: '#374151' }}>Floor {band.fromFloor}</span>}
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    {customBands
                      ? <input type="number" value={band.toFloor ?? ''} onChange={e => updateBand(idx, 'toFloor', e.target.value)}
                          className="input text-xs tabular-nums" style={{ width: 60 }} />
                      : <span className="tabular-nums" style={{ color: '#374151' }}>Floor {band.toFloor}</span>}
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    {customBands
                      ? <input type="number" step="0.01" value={band.incrementPSF ?? ''} onChange={e => updateBand(idx, 'incrementPSF', e.target.value)}
                          className="input text-xs tabular-nums" style={{ width: 68 }} />
                      : <span className="tabular-nums" style={{ color: '#374151' }}>+${band.incrementPSF}</span>}
                  </td>
                  {customBands && (
                    <td style={{ padding: '4px 6px' }}>
                      <button onClick={() => deleteBand(idx)}
                        style={{ color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {bands.length === 0 && (
                <tr>
                  <td colSpan={customBands ? 4 : 3}
                    style={{ padding: '8px 6px', color: '#9CA3AF', fontStyle: 'italic', fontSize: 11 }}>
                    No bands — all floors use starting PSF only
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {customBands && (
            <button onClick={addBand}
              style={{ marginTop: 8, fontSize: 12, color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              + Add Band
            </button>
          )}
        </section>

        {/* Stats */}
        <section style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <span style={{ color: '#6B7280' }}>Avg PSF (actual)</span>
            <span style={{ fontWeight: 700, color: dc, fontVariantNumeric: 'tabular-nums' }}>
              {stackAvgPSF > 0 ? `$${stackAvgPSF.toFixed(0)}` : '—'}
              {deviation != null && Math.abs(deviation) <= 5 && ' ✅'}
            </span>
          </div>
          {projectedAvg != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ color: '#6B7280' }}>Avg PSF (projected)</span>
              <span style={{ color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>${projectedAvg.toFixed(0)}</span>
            </div>
          )}
          {brTargetPSF != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ color: '#6B7280' }}>Target ({stack.bedroomType})</span>
              <span style={{ color: '#374151', fontVariantNumeric: 'tabular-nums' }}>${Number(brTargetPSF).toFixed(0)}</span>
            </div>
          )}
          {deviation != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6B7280' }}>Deviation (actual)</span>
              <span style={{ fontWeight: 600, color: dc, fontVariantNumeric: 'tabular-nums' }}>
                {deviation >= 0 ? '+' : ''}{deviation.toFixed(0)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, paddingTop: 5, borderTop: '1px solid #E5E7EB' }}>
            <span style={{ color: '#6B7280' }}>Valid floors</span>
            <span style={{ color: '#374151' }}>{validFloors.length}</span>
          </div>
        </section>

        {error && (
          <p style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #E5E7EB', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {successMessage && (
          <p style={{ fontSize: 12, color: '#16A34A', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
            ✓ {successMessage}
          </p>
        )}
        <button onClick={handleApplyStack} disabled={saving} className="btn-primary text-sm">
          {saving ? '…' : 'Apply to this stack only'}
        </button>
        <button onClick={handleApplyAll} disabled={saving} className="btn-secondary text-sm">
          {saving ? '…' : `Apply to all ${stack.unitTypeCode} (same rank + type)`}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleReset}
            disabled={saving}
            style={{ flex: 1, fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, cursor: 'pointer', padding: '6px 0' }}
          >
            Reset to rank defaults
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, cursor: 'pointer', padding: '6px 0' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
