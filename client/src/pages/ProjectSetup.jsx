import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// ─── Constants ────────────────────────────────────────────────────────────────
const BEDROOM_TYPES = ['Studio', '1BR', '2BR', '3BR', '4BR', '5BR', '6BR', 'Dual-Key', 'Shop'];

const INITIAL_PROJECT_FORM = {
  nameEn: '', nameZh: '', description: '',
  totalUnitsExpected: '', roundingUnit: 100, status: 'draft',
};

const INITIAL_BLOCK_FORM = {
  blockName: '', totalStoreys: '', startingFloor: '1', excludedFloors: '',
};

const INITIAL_STACK_FORM = {
  stackNumber: '', unitTypeCode: '', bedroomType: '3BR',
  standardSizeSqft: '', facing: '', rankId: '',
  hasPenthouse: false, penthouseSizeSqft: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseExcluded(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

function excludedInputToArray(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean)
    .map(Number).filter(n => !isNaN(n) && Number.isInteger(n));
}

function hasOverlap(bands) {
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      if (Number(bands[i].fromFloor) < Number(bands[j].toFloor) &&
          Number(bands[j].fromFloor) < Number(bands[i].toFloor)) {
        return true;
      }
    }
  }
  return false;
}

function computeBlockUnits(block) {
  const blockExcl = parseExcluded(block.excludedFloors);
  return (block.stacks || []).reduce((sum, s) => {
    const stkExcl  = parseExcluded(s.stackExcludedFloors);
    
    let excludedCount = 0;

    for (let floor = 1; floor <= (block.totalStoreys || 0); floor++) {
      if (blockExcl.includes(floor) || stkExcl.includes(floor)) {
        excludedCount++;
      }
    }
    return sum + Math.max(0, (block.totalStoreys || 0) - excludedCount);
  }, 0);
}

function computeConfiguredUnits(blocks) {
  return blocks.reduce((sum, b) => sum + computeBlockUnits(b), 0);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgCls = type === 'success' ? 'bg-green-800' : 'bg-red-700';
  const icon  = type === 'success' ? '✓' : '✗';

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${bgCls} text-white px-4 py-3 rounded-xl
                     shadow-xl text-sm flex items-center gap-3 max-w-sm animate-fade-in`}>
      <span className="text-base leading-none font-bold">{icon}</span>
      <span className="flex-1">{message}</span>
      <button
        className="opacity-60 hover:opacity-100 transition-opacity leading-none ml-1"
        onClick={onDismiss}
      >✕</button>
    </div>
  );
}

// ─── ChecksumBar ──────────────────────────────────────────────────────────────
function ChecksumBar({ configured, expected, projectId, onGenerate, generating }) {
  const { t } = useTranslation();
  const hasTarget  = expected != null && expected > 0;
  const diff       = hasTarget ? configured - expected : 0;
  const canGenerate = hasTarget && diff === 0 && !!projectId && !generating;

  let bgCls, icon, detail;
  if (!hasTarget || diff === 0) {
    bgCls  = hasTarget ? 'bg-green-600' : 'bg-gray-700';
    icon   = hasTarget ? '✓' : '–';
    detail = hasTarget ? t('block.checksumMatch') : '';
  } else if (diff < 0) {
    bgCls  = 'bg-amber-500';
    icon   = '⚠';
    detail = t('block.checksumUnder', { count: Math.abs(diff) });
  } else {
    bgCls  = 'bg-red-600';
    icon   = '✗';
    detail = t('block.checksumOver', { count: diff });
  }

  return (
    <div
      className={`${bgCls} text-white px-4 sm:px-6 lg:px-8 py-2
                  flex items-center justify-between gap-4 text-sm font-medium shadow-md
                  sticky top-0 z-30`}
    >
      <span className="shrink-0">
        {icon}&nbsp; {t('block.unitsConfigured')}:&nbsp;
        <strong>{configured.toLocaleString()}</strong>
        {hasTarget && (
          <> / <strong>{expected.toLocaleString()}</strong></>
        )}
      </span>

      <div className="flex items-center gap-3 min-w-0">
        {detail && <span className="text-xs opacity-90 hidden sm:block truncate">{detail}</span>}

        {projectId && (
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            title={!canGenerate && !generating ? t('generate.disabledHint') : undefined}
            className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold
                        px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap
                        ${canGenerate
                          ? 'border-white/50 bg-white/15 hover:bg-white/25 text-white cursor-pointer'
                          : 'border-white/20 bg-white/5 text-white/40 cursor-not-allowed'
                        }`}
          >
            {generating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('generate.generating')}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {t('generate.generateUnits')}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── AddBlocksPanel — multi-row block creation ────────────────────────────────
function AddBlocksPanel({ projectId, onSaved, onCancel }) {
  const { t } = useTranslation();

  const newRow = () => ({
    _key: Math.random().toString(36).slice(2),
    blockName: '', totalStoreys: '', startingFloor: '1', excludedFloors: '',
    error: null,
  });

  const [rows, setRows] = useState([newRow()]);
  const [saving, setSaving] = useState(false);

  function addRow() { setRows(p => [...p, newRow()]); }

  function removeRow(key) {
    if (rows.length > 1) setRows(p => p.filter(r => r._key !== key));
  }

  function update(key, field, val) {
    setRows(p => p.map(r => r._key === key ? { ...r, [field]: val, error: null } : r));
  }

  async function saveAll() {
    setSaving(true);

    const results = await Promise.allSettled(
      rows.map(row =>
        fetch('/api/blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            blockName:      row.blockName.trim(),
            totalStoreys:   Number(row.totalStoreys),
            startingFloor:  Number(row.startingFloor) || 1,
            excludedFloors: excludedInputToArray(row.excludedFloors),
          }),
        }).then(async r => {
          if (!r.ok) throw new Error((await r.json()).error);
          return r.json();
        })
      )
    );

    const saved  = results.filter(r => r.status === 'fulfilled').map(r => ({ ...r.value, stacks: [] }));
    const failed = results
      .map((r, i) => r.status === 'rejected' ? { ...rows[i], error: r.reason.message } : null)
      .filter(Boolean);

    if (saved.length > 0) onSaved(saved);       // parent appends to blocks list
    if (failed.length === 0) onCancel();          // all done — close panel
    else setRows(failed);                          // keep panel open for retries

    setSaving(false);
  }

  const canSave = rows.every(r => r.blockName.trim() && r.totalStoreys);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{t('block.addBlock')}</h3>
        {rows.length > 1 && (
          <span className="text-xs text-gray-400">{rows.length} blocks</span>
        )}
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-[1fr_90px_80px_1fr_24px] gap-2 px-0.5">
        <span className="text-xs font-medium text-gray-500">
          {t('block.blockName')} <span className="text-red-500">*</span>
        </span>
        <span className="text-xs font-medium text-gray-500">
          {t('block.totalStoreys')} <span className="text-red-500">*</span>
        </span>
        <span className="text-xs font-medium text-gray-500">{t('block.startingFloor')}</span>
        <span className="text-xs font-medium text-gray-500">{t('block.excludedFloors')}</span>
        <span />
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row._key}>
            {row.error && <p className="text-xs text-red-600 mb-0.5">{row.error}</p>}
            <div className="grid grid-cols-[1fr_90px_80px_1fr_24px] gap-2 items-center">
              <input
                className="input" placeholder="Block A"
                value={row.blockName} onChange={e => update(row._key, 'blockName', e.target.value)}
              />
              <input
                className="input text-center" type="number" min="1" placeholder="30"
                value={row.totalStoreys} onChange={e => update(row._key, 'totalStoreys', e.target.value)}
              />
              <input
                className="input text-center" type="number" min="1"
                value={row.startingFloor} onChange={e => update(row._key, 'startingFloor', e.target.value)}
              />
              <input
                className="input" placeholder="4, 13, 14"
                value={row.excludedFloors} onChange={e => update(row._key, 'excludedFloors', e.target.value)}
              />
              <button
                type="button"
                className="flex items-center justify-center text-gray-300 hover:text-red-500 disabled:opacity-20 transition-colors"
                onClick={() => removeRow(row._key)} disabled={rows.length === 1}
                title="Remove row"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-200">
        <button
          type="button"
          className="text-xs font-medium text-brand-600 hover:underline"
          onClick={addRow}
        >+ {t('block.addBlock')}</button>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button" className="btn-primary"
            onClick={saveAll} disabled={saving || !canSave}
          >
            {saving
              ? t('common.loading')
              : `${t('common.save')}${rows.length > 1 ? ` (${rows.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TypeCodeLibrary ──────────────────────────────────────────────────────────
function TypeCodeLibrary({ projectId, blocks, typeCodes, onAdded, onUpdated, onDeleted }) {
  const EMPTY_FORM = { code: '', bedroomType: '', sizeSqft: '', facing: '', notes: '', blockAssignments: {} };
  const [showForm,      setShowForm]      = useState(false);
  const [editingId,     setEditingId]     = useState(null);
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState(null);
  const [deleteError,   setDeleteError]   = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function openAdd() {
    setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); setError(null); setDeleteError(null);
  }
  function openEdit(tc) {
    setForm({ code: tc.code, bedroomType: tc.bedroomType, sizeSqft: tc.sizeSqft.toString(),
      facing: tc.facing ?? '', notes: tc.notes ?? '', blockAssignments: {} });
    setEditingId(tc.id); setShowForm(true); setError(null); setDeleteError(null);
  }
  function cancel() { setShowForm(false); setEditingId(null); setError(null); }

  const editingTc = editingId ? typeCodes.find(tc => tc.id === editingId) : null;
  const stackCascadeCount = editingTc && editingTc.stacks?.length > 0
    && (form.sizeSqft !== String(editingTc.sizeSqft) || form.bedroomType !== editingTc.bedroomType)
    ? editingTc.stacks.length : 0;

  async function save() {
    if (!form.code.trim() || !form.bedroomType.trim() || !form.sizeSqft) {
      setError('Code, bedroom type and size are required'); return;
    }
    setSaving(true); setError(null);
    try {
      if (editingId) {
        const patchBody = {
          code:        form.code.trim(),
          bedroomType: form.bedroomType.trim(),
          sizeSqft:    Number(form.sizeSqft),
          facing:      form.facing || null,
          notes:       form.notes  || null,
        };
        console.log('Saving type code PATCH body:', JSON.stringify(patchBody));
        const res = await fetch(`/api/typecodes/${editingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
        onUpdated(await res.json());
      } else {
        const blockAssignments = [];
        for (const [blockId, val] of Object.entries(form.blockAssignments)) {
          const nums = val.split(',').map(s => s.trim()).filter(Boolean)
            .map(Number).filter(n => !isNaN(n) && Number.isInteger(n));
          if (nums.length > 0) blockAssignments.push({ blockId, stackNumbers: nums });
        }
        const res = await fetch(`/api/projects/${projectId}/typecodes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: form.code.trim(), bedroomType: form.bedroomType.trim(),
            sizeSqft: Number(form.sizeSqft), facing: form.facing || null, notes: form.notes || null,
            blockAssignments }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
        onAdded(await res.json());
      }
      cancel();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function tryDelete(tc) {
    setDeleteError(null);
    if (tc.stacks?.length > 0) {
      setDeleteError(`Cannot delete: ${tc.stacks.length} stack${tc.stacks.length !== 1 ? 's are' : ' is'} using this type code`);
      return;
    }
    setDeleteConfirm(tc);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    try {
      const res = await fetch(`/api/typecodes/${deleteConfirm.id}`, { method: 'DELETE' });
      if (!res.ok) {
        let msg = `Delete failed (${res.status})`;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch {}
        setDeleteError(msg);
        return;
      }
      onDeleted(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (e) {
      setDeleteError(e.message || 'Delete failed');
    }
  }

  const canSave = form.code.trim() && form.bedroomType.trim() && form.sizeSqft;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Type Code Library</h2>
        {!showForm
          ? <button className="btn-primary text-sm" onClick={openAdd}>+ Add Type Code</button>
          : <button className="btn-secondary text-sm" onClick={cancel}>Cancel</button>
        }
      </div>

      <div className="card p-0 overflow-hidden">
        {typeCodes.length === 0 && !showForm ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">🏷</div>
            <p className="text-sm">No type codes yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500 text-xs font-medium">
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5">Bedroom Type</th>
                  <th className="px-4 py-2.5 text-right">Size (sqft)</th>
                  <th className="px-4 py-2.5">Facing</th>
                  <th className="px-4 py-2.5 text-center">Stacks</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {typeCodes.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-xs">No type codes yet</td></tr>
                )}
                {typeCodes.map(tc => (
                  <tr key={tc.id} className={`hover:bg-gray-50 group ${editingId === tc.id ? 'bg-brand-50' : ''}`}>
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{tc.code}</td>
                    <td className="px-4 py-2.5">
                      <span className="badge bg-blue-50 text-blue-700 text-xs">{tc.bedroomType}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{tc.sizeSqft.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-gray-500">{tc.facing ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[220px]">
                      {tc.stacks?.length > 0 ? (() => {
                        const byBlock = {};
                        for (const s of tc.stacks) {
                          const name = s.block?.blockName ?? s.blockId;
                          (byBlock[name] = byBlock[name] || []).push(s.stackNumber);
                        }
                        return Object.entries(byBlock)
                          .map(([name, nums]) => `Blk ${name}: ${nums.map(n => `#${n}`).join(', ')}`)
                          .join(' | ');
                      })() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="text-xs text-brand-600 hover:underline font-medium" onClick={() => openEdit(tc)}>Edit</button>
                        <button className="text-xs text-red-400 hover:text-red-600" onClick={() => tryDelete(tc)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {deleteError && (
          <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100 flex items-center justify-between">
            {deleteError}
            <button className="ml-4 text-red-400 hover:text-red-600" onClick={() => setDeleteError(null)}>✕</button>
          </div>
        )}

        {showForm && (
          <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
            <datalist id="bedroom-type-options-tc">
              {BEDROOM_TYPES.map(bt => <option key={bt} value={bt} />)}
            </datalist>
            <h3 className="text-sm font-semibold text-gray-700">
              {editingId ? `Edit: ${editingTc?.code}` : 'New Type Code'}
            </h3>
            {stackCascadeCount > 0 && (
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                ⚠ Saving will update all <strong>{stackCascadeCount}</strong> stack{stackCascadeCount !== 1 ? 's' : ''} using this type code
              </div>
            )}
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="label text-xs">Type Code <span className="text-red-500">*</span></label>
                <input className="input text-xs" autoFocus placeholder="3BR P1+S"
                  value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs">Bedroom Type <span className="text-red-500">*</span></label>
                <input className="input text-xs" list="bedroom-type-options-tc" placeholder="3BR"
                  value={form.bedroomType} onChange={e => setForm(p => ({ ...p, bedroomType: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs">Size (sqft) <span className="text-red-500">*</span></label>
                <input className="input text-xs text-right" type="number" min="0" step="0.1" placeholder="969"
                  value={form.sizeSqft} onChange={e => setForm(p => ({ ...p, sizeSqft: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs">Facing</label>
                <input className="input text-xs" placeholder="Pool, North…"
                  value={form.facing} onChange={e => setForm(p => ({ ...p, facing: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label text-xs">Notes</label>
              <input className="input text-xs" placeholder="Optional notes…"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            {!editingId && blocks.length > 0 && (
              <div>
                <label className="label text-xs">Assign to Blocks</label>
                <p className="text-xs text-gray-400 mb-2">Enter comma-separated stack numbers for each block (leave blank to skip)</p>
                <div className="space-y-2">
                  {blocks.map(block => (
                    <div key={block.id} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-gray-700 w-24 shrink-0 truncate">{block.blockName}</span>
                      <span className="text-xs text-gray-400 shrink-0">Stacks:</span>
                      <input className="input text-xs flex-1" placeholder="1, 8, 15"
                        value={form.blockAssignments[block.id] ?? ''}
                        onChange={e => setForm(p => ({ ...p, blockAssignments: { ...p.blockAssignments, [block.id]: e.target.value } }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1 border-t border-gray-200">
              <button className="btn-secondary text-xs" onClick={cancel}>Cancel</button>
              <button className="btn-primary text-xs" onClick={save} disabled={saving || !canSave}>
                {saving ? '…' : editingId ? 'Save Changes' : 'Add Type Code'}
              </button>
            </div>
          </div>
        )}
      </div>

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: 380,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)', padding: 24 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, fontSize: 15, color: '#DC2626', marginBottom: 8 }}>Delete Type Code</h3>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
              Delete <strong>{deleteConfirm.code}</strong>? This action cannot be undone.
            </p>
            {deleteError && (
              <p style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A5',
                borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>{deleteError}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-secondary text-xs" onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}>Cancel</button>
              <button className="btn-secondary text-xs" style={{ color: '#DC2626', borderColor: '#FCA5A5' }}
                onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── StackRow — display + inline edit ─────────────────────────────────────────
function StackRow({ stack, ranks, typeCodes = [], blockStartingFloor, onSaved, onDeleted }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    typeCodeId:          stack.typeCodeId ?? '',
    stackNumber:         stack.stackNumber?.toString() ?? '',
    unitTypeCode:        stack.unitTypeCode,
    bedroomType:         stack.bedroomType,
    standardSizeSqft:    stack.standardSizeSqft?.toString() ?? '',
    facing:              stack.facing ?? '',
    rankId:              stack.rankId ?? '',
    hasPenthouse:        stack.hasPenthouse ?? false,
    penthouseSizeSqft:   stack.penthouseSizeSqft?.toString() ?? '',
    stackExcludedFloors: parseExcluded(stack.stackExcludedFloors).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  // Keep form in sync if parent re-renders with updated stack prop
  useEffect(() => {
    if (!editing) {
      setForm({
        typeCodeId:          stack.typeCodeId ?? '',
        stackNumber:         stack.stackNumber?.toString() ?? '',
        unitTypeCode:        stack.unitTypeCode,
        bedroomType:         stack.bedroomType,
        standardSizeSqft:    stack.standardSizeSqft?.toString() ?? '',
        facing:              stack.facing ?? '',
        rankId:              stack.rankId ?? '',
        hasPenthouse:        stack.hasPenthouse ?? false,
        penthouseSizeSqft:   stack.penthouseSizeSqft?.toString() ?? '',
        stackExcludedFloors: parseExcluded(stack.stackExcludedFloors).join(', '),
      });
    }
  }, [stack, editing]);

  function handleTypeCodeSelect(tcId) {
    const tc = typeCodes.find(t => t.id === tcId);
    if (tc) {
      setForm(p => ({ ...p, typeCodeId: tcId, unitTypeCode: tc.code,
        bedroomType: tc.bedroomType, standardSizeSqft: tc.sizeSqft.toString(),
        facing: tc.facing ?? p.facing }));
    } else {
      setForm(p => ({ ...p, typeCodeId: '' }));
    }
  }

  function onChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/stacks/${stack.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typeCodeId:          form.typeCodeId || null,
          stackNumber:         form.stackNumber !== '' ? Number(form.stackNumber) : 0,
          unitTypeCode:        form.unitTypeCode,
          bedroomType:         form.bedroomType,
          standardSizeSqft:    Number(form.standardSizeSqft),
          facing:              form.facing || null,
          rankId:              form.rankId || null,
          hasPenthouse:        form.hasPenthouse,
          penthouseSizeSqft:   form.penthouseSizeSqft ? Number(form.penthouseSizeSqft) : null,
          stackExcludedFloors: excludedInputToArray(form.stackExcludedFloors),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const updated = await res.json();
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm(t('stack.deleteConfirm', { code: stack.unitTypeCode }))) return;
    await fetch(`/api/stacks/${stack.id}`, { method: 'DELETE' });
    onDeleted(stack.id);
  }

  // ── Display row ──
  if (!editing) {
    return (
      <tr className="hover:bg-gray-50 transition-colors text-sm group">
        <td className="px-3 py-2 text-gray-500 tabular-nums">
          {String(stack.stackNumber ?? 0).padStart(2, '0')}
        </td>
        <td className="px-3 py-2 font-medium text-gray-900">{stack.unitTypeCode}</td>
        <td className="px-3 py-2">
          <span className="badge bg-blue-50 text-blue-700">{stack.bedroomType}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
          {stack.standardSizeSqft?.toLocaleString()}
        </td>
        <td className="px-3 py-2 text-gray-500">{stack.facing ?? '—'}</td>
        <td className="px-3 py-2 text-xs text-gray-500">
          {stack.rank
            ? <span className="bg-gray-100 px-1.5 py-0.5 rounded">{stack.rank.labelEn}</span>
            : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2 text-center text-gray-400">
          {stack.hasPenthouse
            ? <span className="text-green-600 font-medium text-xs">✓ PH</span>
            : ''}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-400 text-xs">
          {stack.hasPenthouse && stack.penthouseSizeSqft
            ? stack.penthouseSizeSqft.toLocaleString()
            : ''}
        </td>
        <td className="px-3 py-2 text-gray-400 text-xs">
          {parseExcluded(stack.stackExcludedFloors).join(', ') || '—'}
        </td>
        <td className="px-3 py-2">
          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="text-xs text-brand-600 hover:underline font-medium"
              onClick={() => setEditing(true)}
            >{t('common.edit')}</button>
            <button
              className="text-xs text-red-400 hover:text-red-600"
              onClick={del}
            >{t('common.delete')}</button>
          </div>
        </td>
      </tr>
    );
  }

  // ── Edit row ──
  const selectedTc = form.typeCodeId ? typeCodes.find(tc => tc.id === form.typeCodeId) : null;
  return (
    <tr className="bg-brand-50 border-y border-brand-100">
      <td className="px-2 py-1.5">
        <span className="text-xs font-mono text-gray-700 px-1">
          {String(stack.stackNumber ?? 0).padStart(2, '0')}
        </span>
      </td>
      {/* Type Code — read-only when editing existing stack */}
      <td className="px-2 py-1.5" colSpan={3}>
        {selectedTc ? (
          <span className="text-xs text-gray-700 font-medium">
            {selectedTc.code} · {selectedTc.bedroomType} · {selectedTc.sizeSqft.toLocaleString()} sqft
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">No type code assigned</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input w-24 text-xs" name="facing"
          value={form.facing} onChange={onChange} placeholder="N/Pool…"
        />
      </td>
      <td className="px-2 py-1.5">
        <select className="input text-xs" name="rankId" value={form.rankId} onChange={onChange}>
          <option value="">{t('stack.unranked')}</option>
          {ranks.map(r => <option key={r.id} value={r.id}>{r.labelEn}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          type="checkbox" name="hasPenthouse"
          checked={form.hasPenthouse} onChange={onChange}
          className="w-4 h-4 text-brand-600 rounded cursor-pointer"
        />
      </td>
      <td className="px-2 py-1.5">
        {form.hasPenthouse && (
          <input
            className="input w-20 text-xs text-right" name="penthouseSizeSqft"
            type="number" min="0" step="0.1"
            value={form.penthouseSizeSqft} onChange={onChange}
          />
        )}
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input w-24 text-xs" name="stackExcludedFloors"
          placeholder="4, 13"
          value={form.stackExcludedFloors} onChange={onChange}
        />
      </td>
      <td className="px-2 py-1.5">
        {error && <p className="text-xs text-red-600 mb-1 whitespace-nowrap">{error}</p>}
        <div className="flex gap-1 justify-end">
          <button
            className="btn-primary text-xs px-2 py-1"
            onClick={save} disabled={saving || !form.unitTypeCode || !form.standardSizeSqft || !form.bedroomType}
          >{saving ? '…' : t('common.save')}</button>
          <button
            className="btn-secondary text-xs px-2 py-1"
            onClick={() => { setEditing(false); setError(null); }}
          >{t('common.cancel')}</button>
        </div>
      </td>
    </tr>
  );
}

// ─── AddStacksPanel — multi-row stack creation ────────────────────────────────
function AddStacksPanel({ blockId, ranks, typeCodes = [], blockStartingFloor, onSaved, onCancel }) {
  const { t } = useTranslation();

  const newRow = () => ({
    _key: Math.random().toString(36).slice(2),
    typeCodeId: '', stackNumber: '',
    unitTypeCode: '', bedroomType: '', standardSizeSqft: '',
    facing: '', rankId: '',
    hasPenthouse: false, penthouseSizeSqft: '', stackExcludedFloors: '',
    error: null,
  });

  const [rows, setRows] = useState([newRow()]);
  const [saving, setSaving] = useState(false);

  function addRow() { setRows(p => [...p, newRow()]); }
  function removeRow(key) { if (rows.length > 1) setRows(p => p.filter(r => r._key !== key)); }
  function update(key, field, val) {
    setRows(p => p.map(r => r._key === key ? { ...r, [field]: val, error: null } : r));
  }
  function selectTypeCode(key, tcId) {
    const tc = typeCodes.find(t => t.id === tcId);
    setRows(p => p.map(r => r._key !== key ? r : tc
      ? { ...r, typeCodeId: tcId, unitTypeCode: tc.code, bedroomType: tc.bedroomType,
          standardSizeSqft: tc.sizeSqft.toString(), facing: tc.facing ?? r.facing, error: null }
      : { ...r, typeCodeId: '', unitTypeCode: '', bedroomType: '', standardSizeSqft: '', error: null }
    ));
  }

  async function saveAll() {
    setSaving(true);
    const results = await Promise.allSettled(
      rows.map(row =>
        fetch(`/api/blocks/${blockId}/stacks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            typeCodeId:          row.typeCodeId || null,
            stackNumber:         row.stackNumber !== '' ? Number(row.stackNumber) : 0,
            unitTypeCode:        row.unitTypeCode,
            bedroomType:         row.bedroomType,
            standardSizeSqft:    Number(row.standardSizeSqft),
            facing:              row.facing || null,
            rankId:              row.rankId || null,
            hasPenthouse:        row.hasPenthouse,
            penthouseSizeSqft:   row.penthouseSizeSqft ? Number(row.penthouseSizeSqft) : null,
            stackExcludedFloors: excludedInputToArray(row.stackExcludedFloors),
          }),
        }).then(async r => {
          if (!r.ok) throw new Error((await r.json()).error);
          return r.json();
        })
      )
    );

    const saved  = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results
      .map((r, i) => r.status === 'rejected' ? { ...rows[i], error: r.reason.message } : null)
      .filter(Boolean);

    if (saved.length > 0) onSaved(saved);
    if (failed.length === 0) onCancel();
    else setRows(failed);
    setSaving(false);
  }

  const canSave = rows.every(r => r.unitTypeCode.trim() && r.standardSizeSqft && r.bedroomType);

  // Column definitions
  const COLS = [
    { label: t('stack.stackNumber'),         req: false, cls: 'w-[52px]' },
    { label: 'Type Code',                    req: true,  cls: 'flex-1 min-w-[180px]' },
    { label: t('stack.facing'),              req: false, cls: 'w-[88px]' },
    { label: t('stack.rank'),                req: false, cls: 'w-[96px]' },
    { label: t('stack.hasPenthouse'),        req: false, cls: 'w-[36px] text-center' },
    { label: t('stack.penthouseSizeSqft'),   req: false, cls: 'w-[72px]' },
    { label: t('stack.stackExcludedFloors'), req: false, cls: 'w-[80px]' },
  ];

  if (typeCodes.length === 0) {
    return (
      <div className="bg-green-50 border-t-2 border-green-200 px-4 py-4 text-center">
        <p className="text-xs text-gray-400 italic">
          Create type codes first in the Type Code Library above
        </p>
        <button type="button" className="btn-secondary text-xs mt-3" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-t-2 border-green-200">
      <div className="p-3 space-y-2">
        {/* Column headers */}
        <div className="flex gap-1.5 items-end">
          {COLS.map(c => (
            <div key={c.label} className={`${c.cls} shrink-0 text-[10px] font-medium text-gray-500 leading-tight`}>
              {c.label}{c.req && <span className="text-red-500 ml-0.5">*</span>}
            </div>
          ))}
          <div className="w-5 shrink-0" />
        </div>

        {/* Input rows */}
        <div className="space-y-1.5">
          {rows.map(row => (
            <div key={row._key}>
              {row.error && <p className="text-[11px] text-red-600 mb-0.5">{row.error}</p>}
              <div className="flex gap-1.5 items-center">
                {/* Stack # */}
                <input className="input text-xs text-center w-[52px] shrink-0" placeholder="#"
                  value={row.stackNumber} onChange={e => update(row._key, 'stackNumber', e.target.value)} />
                {/* Type Code dropdown */}
                <div className="flex-1 min-w-[180px] shrink-0">
                  <select className="input text-xs w-full" value={row.typeCodeId}
                    onChange={e => selectTypeCode(row._key, e.target.value)}>
                    <option value="">— Select type code —</option>
                    {typeCodes.map(tc => (
                      <option key={tc.id} value={tc.id}>
                        {tc.code} · {tc.bedroomType} · {tc.sizeSqft.toLocaleString()} sqft
                      </option>
                    ))}
                  </select>
                </div>
                {/* Facing */}
                <input className="input text-xs w-[88px] shrink-0" placeholder="N/Pool…"
                  value={row.facing} onChange={e => update(row._key, 'facing', e.target.value)} />
                {/* Rank */}
                <select className="input text-xs w-[96px] shrink-0" value={row.rankId}
                  onChange={e => update(row._key, 'rankId', e.target.value)}>
                  <option value="">{t('stack.unranked')}</option>
                  {ranks.map(r => <option key={r.id} value={r.id}>{r.labelEn}</option>)}
                </select>
                {/* PH checkbox */}
                <div className="w-[36px] shrink-0 flex justify-center">
                  <input type="checkbox" className="w-4 h-4 text-brand-600 rounded cursor-pointer"
                    checked={row.hasPenthouse} onChange={e => update(row._key, 'hasPenthouse', e.target.checked)} />
                </div>
                {/* PH size */}
                <div className="w-[72px] shrink-0">
                  {row.hasPenthouse
                    ? <input className="input text-xs text-right" type="number" min="0" step="0.1" placeholder="sqft"
                        value={row.penthouseSizeSqft} onChange={e => update(row._key, 'penthouseSizeSqft', e.target.value)} />
                    : null}
                </div>
                {/* Stack excluded floors */}
                <input className="input text-xs w-[80px] shrink-0" placeholder="4, 13"
                  value={row.stackExcludedFloors}
                  onChange={e => update(row._key, 'stackExcludedFloors', e.target.value)} />
                {/* Remove */}
                <button type="button"
                  className="w-5 shrink-0 flex items-center justify-center text-gray-300 hover:text-red-500 disabled:opacity-20 transition-colors text-xs"
                  onClick={() => removeRow(row._key)} disabled={rows.length === 1}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-green-200 flex items-center justify-between bg-green-50/60">
        <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={addRow}>
          + {t('stack.addStack')}
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary text-xs px-2 py-1"
            onClick={saveAll} disabled={saving || !canSave}>
            {saving ? '…' : `${t('common.save')}${rows.length > 1 ? ` (${rows.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── StacksTable ──────────────────────────────────────────────────────────────
function StacksTable({ blockId, stacks, ranks, typeCodes = [], blockStartingFloor, onStacksAdded, onStackUpdated, onStackDeleted }) {
  const { t }           = useTranslation();
  const [showAdd, setShowAdd] = useState(false);

  // Required flag drives the * marker in column headers
  const HEADERS = [
    { label: t('stack.stackNumber'),          req: false },
    { label: t('stack.unitTypeCode'),         req: true  },
    { label: t('stack.bedroomType'),          req: true  },
    { label: t('stack.standardSizeSqft'),     req: true  },
    { label: t('stack.facing'),               req: false },
    { label: t('stack.rank'),                 req: false },
    { label: t('stack.hasPenthouse'),         req: false },
    { label: t('stack.penthouseSizeSqft'),    req: false },
    { label: t('stack.stackExcludedFloors'),  req: false },
    { label: t('common.actions'),             req: false },
  ];

  return (
    <div className="border-t border-gray-100">
      {/* Shared datalist for bedroom type combobox */}
      <datalist id="bedroom-type-options">
        {BEDROOM_TYPES.map(bt => <option key={bt} value={bt} />)}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500">
              {HEADERS.map(h => (
                <th key={h.label} className="px-3 py-2 font-medium whitespace-nowrap">
                  {h.label}{h.req && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {stacks.length === 0 && !showAdd && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-gray-400">
                  {t('stack.noStacks')}
                </td>
              </tr>
            )}
            {[...stacks]
              .sort((a, b) => Number(a.stackNumber) - Number(b.stackNumber))
              .map(stack => (
                <StackRow
                  key={stack.id}
                  stack={stack}
                  ranks={ranks}
                  typeCodes={typeCodes}
                  onSaved={onStackUpdated}
                  onDeleted={onStackDeleted}
                />
              ))}
          </tbody>
        </table>
      </div>

      {/* Multi-row add panel sits below the table */}
      {showAdd
        ? <AddStacksPanel
            blockId={blockId}
            ranks={ranks}
            typeCodes={typeCodes}
            onSaved={stacks => onStacksAdded(stacks)}
            onCancel={() => setShowAdd(false)}
          />
        : <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
            <button
              className="text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline"
              onClick={() => setShowAdd(true)}
            >
              + {t('stack.addStack')}
            </button>
          </div>
      }
    </div>
  );
}

// ─── BlockCard ────────────────────────────────────────────────────────────────
function BlockCard({ block, ranks, typeCodes = [], onUpdate, onDelete }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [editForm, setEditForm] = useState({
    blockName:     block.blockName,
    totalStoreys:  block.totalStoreys.toString(),
    startingFloor: block.startingFloor.toString(),
    excludedFloors: parseExcluded(block.excludedFloors).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  // Sync edit form when block fields change externally (but not while user is editing)
  useEffect(() => {
    if (!editing) {
      setEditForm({
        blockName:      block.blockName,
        totalStoreys:   block.totalStoreys.toString(),
        startingFloor:  block.startingFloor.toString(),
        excludedFloors: parseExcluded(block.excludedFloors).join(', '),
      });
    }
  }, [block.blockName, block.totalStoreys, block.startingFloor, block.excludedFloors, editing]);

  function onChange(e) {
    const { name, value } = e.target;
    setEditForm(p => ({ ...p, [name]: value }));
  }

  async function saveBlock() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockName:     editForm.blockName,
          totalStoreys:  Number(editForm.totalStoreys),
          startingFloor: Number(editForm.startingFloor) || 1,
          excludedFloors: excludedInputToArray(editForm.excludedFloors),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const updated = await res.json();
      onUpdate({ ...updated, stacks: block.stacks });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBlock() {
    if (!window.confirm(t('block.deleteConfirm', { name: block.blockName }))) return;
    await fetch(`/api/blocks/${block.id}`, { method: 'DELETE' });
    onDelete(block.id);
  }

  // Stack mutation callbacks — build new block object and bubble up
  function handleStacksAdded(newStacks) {
    onUpdate({ ...block, stacks: [...(block.stacks || []), ...newStacks] });
  }

  function handleStackUpdated(updated) {
    onUpdate({
      ...block,
      stacks: (block.stacks || []).map(s => s.id === updated.id ? updated : s),
    });
  }

  function handleStackDeleted(stackId) {
    onUpdate({ ...block, stacks: (block.stacks || []).filter(s => s.id !== stackId) });
  }

  // Computed stats for header
  const floorCount = Math.max(0, block.totalStoreys - block.startingFloor + 1 - parseExcluded(block.excludedFloors).length);
  const excl       = new Set(parseExcluded(block.excludedFloors).map(Number));
  const totalFloors = Math.max(0, block.totalStoreys - block.startingFloor + 1);

  // build all floors once
  const allFloors = Array.from(
    { length: totalFloors },
    (_, i) => block.startingFloor + i
  );

  const stackCount = (block.stacks || []).length;

  const unitCount = (block.stacks || []).reduce((total, stack) => {
    const stackExcl = new Set(
      parseExcluded(stack.stackExcludedFloors).map(Number)
    );

    const validCount = allFloors.filter(
      floor => !excl.has(floor) && !stackExcl.has(floor)
    ).length;

    return total + validCount;
  }, 0);

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* ── Card header ───────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        {/* Block info / inline edit */}
        {!editing ? (
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-semibold text-gray-900 text-sm">{block.blockName}</span>
              <span className="text-xs text-gray-400">
                {floorCount} {t('block.floors')} × {stackCount} {t('stack.title').toLowerCase()}
                {' '}= <strong className="text-gray-600">{unitCount} {t('block.units')}</strong>
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-gray-500">
              <span>{t('block.totalStoreys')}: <strong>{block.totalStoreys}</strong></span>
              <span>{t('block.startingFloor')}: <strong>{block.startingFloor}</strong></span>
              {excl.length > 0 && (
                <span>{t('block.excluded')}: <strong>{excl.join(', ')}</strong></span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
            <div>
              <label className="label text-xs">{t('block.blockName')} <span className="text-red-500">*</span></label>
              <input className="input text-xs" name="blockName" value={editForm.blockName} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('block.totalStoreys')} <span className="text-red-500">*</span></label>
              <input className="input text-xs" name="totalStoreys" type="number" min="1" value={editForm.totalStoreys} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('block.startingFloor')}</label>
              <input className="input text-xs" name="startingFloor" type="number" min="1" value={editForm.startingFloor} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('block.excludedFloors')}</label>
              <input className="input text-xs" name="excludedFloors" placeholder="4, 13" value={editForm.excludedFloors} onChange={onChange} />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {editing ? (
            <>
              <button
                className="btn-primary text-xs px-2 py-1"
                onClick={saveBlock} disabled={saving}
              >{saving ? '…' : t('common.save')}</button>
              <button
                className="btn-secondary text-xs px-2 py-1"
                onClick={() => { setEditing(false); setError(null); }}
              >{t('common.cancel')}</button>
            </>
          ) : (
            <>
              <button
                className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                onClick={() => setEditing(true)}
                title={t('common.edit')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
                </svg>
              </button>
              <button
                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                onClick={deleteBlock}
                title={t('common.delete')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M4 7h16" />
                </svg>
              </button>
              <button
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                  expanded
                    ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setExpanded(v => !v)}
              >
                {t('stack.title')}
                <svg
                  className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Stacks table (expanded) ─────────────────────────────────────────── */}
      {expanded && (
        <StacksTable
          blockId={block.id}
          stacks={block.stacks || []}
          ranks={ranks}
          typeCodes={typeCodes}
          onStacksAdded={handleStacksAdded}
          onStackUpdated={handleStackUpdated}
          onStackDeleted={handleStackDeleted}
        />
      )}
    </div>
  );
}

// ─── FloorIncrementRow — display + inline edit ────────────────────────────────
function FloorIncrementRow({ fi, onUpdated, onDeleted }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState({
    fromFloor:    fi.fromFloor.toString(),
    toFloor:      fi.toFloor.toString(),
    incrementPSF: fi.incrementPSF != null ? fi.incrementPSF.toString() : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!editing) {
      setForm({
        fromFloor:    fi.fromFloor.toString(),
        toFloor:      fi.toFloor.toString(),
        incrementPSF: fi.incrementPSF != null ? fi.incrementPSF.toString() : '',
      });
    }
  }, [fi, editing]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/increments/${fi.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromFloor:    Number(form.fromFloor),
          toFloor:      Number(form.toFloor),
          incrementPSF: form.incrementPSF !== '' ? Number(form.incrementPSF) : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const updated = await res.json();
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('floorIncrement.deleteConfirm'))) return;
    await fetch(`/api/increments/${fi.id}`, { method: 'DELETE' });
    onDeleted(fi.id);
  }

  if (editing) {
    return (
      <>
        <tr className="bg-brand-50 border-y border-brand-100">
          <td className="px-2 py-1.5">
            <input
              className="input w-16 text-xs text-center" type="number" min="1"
              value={form.fromFloor}
              onChange={e => setForm(p => ({ ...p, fromFloor: e.target.value }))}
              autoFocus
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="input w-16 text-xs text-center" type="number" min="1"
              value={form.toFloor}
              onChange={e => setForm(p => ({ ...p, toFloor: e.target.value }))}
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="input w-24 text-xs text-right" type="number" step="0.01"
              value={form.incrementPSF}
              onChange={e => setForm(p => ({ ...p, incrementPSF: e.target.value }))}
            />
          </td>
          <td className="px-2 py-1.5">
            <div className="flex gap-1 justify-end">
              <button
                className="btn-primary text-xs px-2 py-1"
                onClick={save} disabled={saving}
              >{saving ? '…' : t('common.save')}</button>
              <button
                className="btn-secondary text-xs px-2 py-1"
                onClick={() => { setEditing(false); setError(null); }}
              >{t('common.cancel')}</button>
            </div>
          </td>
        </tr>
        {error && (
          <tr>
            <td colSpan={4} className="px-3 pb-1 text-xs text-red-600">{error}</td>
          </tr>
        )}
      </>
    );
  }

  return (
    <tr className="hover:bg-gray-50 group">
      <td className="px-3 py-1.5 tabular-nums">{fi.fromFloor}</td>
      <td className="px-3 py-1.5 tabular-nums">{fi.toFloor}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-green-700">
        {fi.incrementPSF != null ? `+${Number(fi.incrementPSF).toFixed(2)}` : <span className="text-gray-400 italic font-normal">—</span>}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            onClick={() => setEditing(true)} title={t('common.edit')}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
            </svg>
          </button>
          <button
            className="text-gray-300 hover:text-red-500 transition-colors px-0.5"
            onClick={remove}
          >✕</button>
        </div>
      </td>
    </tr>
  );
}

// ─── FloorIncrementsTable ─────────────────────────────────────────────────────
function FloorIncrementsTable({ rankId, increments, onAdded, onUpdated, onDeleted }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ fromFloor: '', toFloor: '', incrementPSF: '' });
  const [adding, setAdding]   = useState(false);
  const [error, setError]     = useState(null);

  const overlap = hasOverlap(increments);

  async function addBand() {
    setAdding(true); setError(null);
    try {
      const res = await fetch(`/api/ranks/${rankId}/increments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromFloor:    Number(addForm.fromFloor),
          toFloor:      Number(addForm.toFloor),
          incrementPSF: addForm.incrementPSF !== '' ? Number(addForm.incrementPSF) : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const created = await res.json();
      onAdded(created);
      setAddForm({ fromFloor: '', toFloor: '', incrementPSF: '' });
      setShowAdd(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const canAdd = addForm.fromFloor !== '' && addForm.toFloor !== '';

  return (
    <div className="border-t border-gray-100">
      {overlap && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 font-medium">
          ⚠ {t('floorIncrement.overlapWarning')}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500">
              <th className="px-3 py-2 font-medium">{t('floorIncrement.fromFloor')}</th>
              <th className="px-3 py-2 font-medium">{t('floorIncrement.toFloor')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('floorIncrement.incrementPSF')}</th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {increments.length === 0 && !showAdd && (
              <tr>
                <td colSpan={4} className="px-3 py-5 text-center text-gray-400">
                  {t('floorIncrement.noBands')}
                </td>
              </tr>
            )}
            {increments.map(fi => (
              <FloorIncrementRow
                key={fi.id}
                fi={fi}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))}
            {showAdd && (
              <tr className="bg-brand-50 border-y border-brand-100">
                <td className="px-2 py-1.5">
                  <input
                    className="input w-16 text-xs text-center" type="number" min="1" placeholder="1"
                    value={addForm.fromFloor}
                    onChange={e => setAddForm(p => ({ ...p, fromFloor: e.target.value }))}
                    autoFocus
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className="input w-16 text-xs text-center" type="number" min="1" placeholder="99"
                    value={addForm.toFloor}
                    onChange={e => setAddForm(p => ({ ...p, toFloor: e.target.value }))}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className="input w-24 text-xs text-right" type="number" step="0.01" placeholder="6.00"
                    value={addForm.incrementPSF}
                    onChange={e => setAddForm(p => ({ ...p, incrementPSF: e.target.value }))}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1 justify-end">
                    <button
                      className="btn-primary text-xs px-2 py-1"
                      onClick={addBand} disabled={adding || !canAdd}
                    >{adding ? '…' : t('common.save')}</button>
                    <button
                      className="btn-secondary text-xs px-2 py-1"
                      onClick={() => { setShowAdd(false); setAddForm({ fromFloor: '', toFloor: '', incrementPSF: '' }); setError(null); }}
                    >{t('common.cancel')}</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}

      {!showAdd && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
          <button
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => setShowAdd(true)}
          >+ {t('floorIncrement.addBand')}</button>
        </div>
      )}
    </div>
  );
}

// ─── PricingParametersForm ────────────────────────────────────────────────────
// Derives targetable bedroom types dynamically from the stacks in all blocks.
function PricingParametersForm({ projectId, blocks, initialParams }) {
  const { t } = useTranslation();

  // Derive all unique bedroom types present in current stacks
  const presentBRTypes = [...new Set(
    blocks.flatMap(b => (b.stacks || []).map(s => s.bedroomType))
  )].filter(Boolean).sort();

  function parseBedroomPSF(p) {
    try {
      const parsed = JSON.parse(p?.targetBedroomPSF || '{}');
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v != null ? v.toString() : '']));
    } catch { return {}; }
  }

  const makeInitialForm = (p) => ({
    targetOverallAvgPSF: p?.targetOverallAvgPSF?.toString() ?? '',
    targetBedroomPSF:    parseBedroomPSF(p),
    penthouseMultiplier: p?.penthouseMultiplier?.toString()  ?? '1',
    roundingUnit:        p?.roundingUnit?.toString()         ?? '100',
  });

  const [form, setForm]     = useState(makeInitialForm(initialParams));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error' | null

  // Sync if initialParams changes (e.g., project switched)
  useEffect(() => {
    setForm(makeInitialForm(initialParams));
    setStatus(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialParams]);

  function onChange(e) {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    setStatus(null);
  }

  function onBedroomPSFChange(brType, value) {
    setForm(p => ({ ...p, targetBedroomPSF: { ...p.targetBedroomPSF, [brType]: value } }));
    setStatus(null);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setStatus(null);
    try {
      // Build targetBedroomPSF JSON — only include non-empty values
      const bedroomPSFObj = {};
      for (const [br, val] of Object.entries(form.targetBedroomPSF)) {
        if (val !== '') bedroomPSFObj[br] = Number(val);
      }
      const body = {
        targetOverallAvgPSF: form.targetOverallAvgPSF !== '' ? Number(form.targetOverallAvgPSF) : null,
        targetBedroomPSF:    JSON.stringify(bedroomPSFObj),
        penthouseMultiplier: form.penthouseMultiplier !== '' ? Number(form.penthouseMultiplier) : 1,
        roundingUnit:        form.roundingUnit        !== '' ? Number(form.roundingUnit)        : 100,
      };
      const res = await fetch(`/api/projects/${projectId}/pricing-parameters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setStatus('success');
    } catch (err) {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <h2 className="text-base font-semibold text-gray-900">{t('pricingParams.title')}</h2>

      {status === 'success' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {t('common.success')}
        </div>
      )}
      {status === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {t('common.error')}
        </div>
      )}

      {/* Overall target */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label">
            {t('pricingParams.targetOverallAvgPSF')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">S$</span>
            <input
              className="input pl-8"
              name="targetOverallAvgPSF"
              type="number" min="0" step="0.01"
              placeholder="1800"
              value={form.targetOverallAvgPSF}
              onChange={onChange}
              required
            />
          </div>
        </div>
        <div>
          <label className="label">{t('pricingParams.penthouseMultiplier')}</label>
          <input
            className="input"
            name="penthouseMultiplier"
            type="number" min="0" step="0.01"
            placeholder="1.0"
            value={form.penthouseMultiplier}
            onChange={onChange}
          />
        </div>
        <div>
          <label className="label">{t('pricingParams.roundingUnit')}</label>
          <input
            className="input"
            name="roundingUnit"
            type="number" min="1"
            placeholder="100"
            value={form.roundingUnit}
            onChange={onChange}
          />
        </div>
      </div>

      {/* Per bedroom type targets — derived dynamically from stacks */}
      {presentBRTypes.length > 0 ? (
        <div>
          <p className="label mb-2">{t('pricingParams.bedroomTargets')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {presentBRTypes.map(br => (
              <div key={br}>
                <label className="label text-xs">{t('pricingParams.targetBRPSF', { br })}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">S$</span>
                  <input
                    className="input pl-8 text-xs"
                    type="number" min="0" step="0.01"
                    placeholder="—"
                    value={form.targetBedroomPSF[br] ?? ''}
                    onChange={e => onBedroomPSFChange(br, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">{t('pricingParams.noBedroomTargets')}</p>
      )}

      <div className="pt-2 border-t border-gray-100 flex justify-end">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('pricingParams.saving') : t('pricingParams.save')}
        </button>
      </div>
    </form>
  );
}

// ─── AddRankPanel ─────────────────────────────────────────────────────────────
function AddRankPanel({ projectId, onSaved, onCancel }) {
  const { t } = useTranslation();
  const [form, setForm]     = useState({ rankNumber: '', labelEn: '', labelZh: '', rankDifferential: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  function onChange(e) {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const body = {
        projectId,
        rankNumber: form.rankNumber ? Number(form.rankNumber) : 1,
        labelEn:    form.labelEn.trim(),
        labelZh:    form.labelZh.trim(),
        rankDifferential: form.rankDifferential !== '' ? Number(form.rankDifferential) : null,
      };
      const res = await fetch('/api/ranks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const created = await res.json();
      onSaved({ ...created, floorIncrements: [] });
      onCancel();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const canSave = form.labelEn.trim() && form.labelZh.trim();

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">{t('rank.addRank')}</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label text-xs">{t('rank.rankNumber')}</label>
          <input className="input text-xs" name="rankNumber" type="number" min="1" placeholder="1"
            value={form.rankNumber} onChange={onChange} />
        </div>
        <div>
          <label className="label text-xs">{t('rank.labelEn')} <span className="text-red-500">*</span></label>
          <input className="input text-xs" name="labelEn" placeholder="Premium"
            value={form.labelEn} onChange={onChange} />
        </div>
        <div>
          <label className="label text-xs">{t('rank.labelZh')} <span className="text-red-500">*</span></label>
          <input className="input text-xs" name="labelZh" placeholder="优质"
            value={form.labelZh} onChange={onChange} />
        </div>
        <div>
          <label className="label text-xs">{t('rank.rankDifferential')}</label>
          <input className="input text-xs" name="rankDifferential" type="number" step="0.01" placeholder="0"
            value={form.rankDifferential} onChange={onChange} />
          <p className="text-xs text-gray-400 mt-0.5">{t('rank.rankDifferentialHint')}</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1 border-t border-gray-200">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || !canSave}>
          {saving ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ─── RankCard ─────────────────────────────────────────────────────────────────
function RankCard({ rank, blocks = [], onUpdate, onDelete, onDuplicated }) {
  const { t } = useTranslation();
  const [expanded, setExpanded]   = useState(false);
  const [editing, setEditing]     = useState(false);
  const [editForm, setEditForm]   = useState({
    rankNumber:       rank.rankNumber.toString(),
    labelEn:          rank.labelEn,
    labelZh:          rank.labelZh,
    rankDifferential: rank.rankDifferential != null ? rank.rankDifferential.toString() : '',
  });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [duplicating, setDuplicating] = useState(false);
  const [dupSaving, setDupSaving]     = useState(false);
  const [dupError, setDupError]       = useState(null);

  useEffect(() => {
    if (!editing) {
      setEditForm({
        rankNumber:       rank.rankNumber.toString(),
        labelEn:          rank.labelEn,
        labelZh:          rank.labelZh,
        rankDifferential: rank.rankDifferential != null ? rank.rankDifferential.toString() : '',
      });
    }
  }, [rank, editing]);

  // ── Floor coverage helpers ──────────────────────────────────────────────────
  const minFloor = blocks.length > 0 ? Math.min(...blocks.map(b => b.startingFloor)) : null;
  const maxFloor = blocks.length > 0 ? Math.max(...blocks.map(b => b.startingFloor + b.totalStoreys - 1)) : null;

  function checkCoverage(increments) {
    if (minFloor == null || maxFloor == null) return [];
    const sorted = [...increments].sort((a, b) => a.fromFloor - b.fromFloor);
    const uncovered = [];
    let expected = minFloor;
    for (const band of sorted) {
      for (let f = expected; f < band.fromFloor; f++) uncovered.push(f);
      expected = Math.max(expected, band.toFloor + 1);
    }
    for (let f = expected; f <= maxFloor; f++) uncovered.push(f);
    return uncovered;
  }

  const coverageErrors = checkCoverage(rank.floorIncrements || []);
  const bandCount      = rank.floorIncrements?.length ?? 0;

  function onChange(e) {
    const { name, value } = e.target;
    setEditForm(p => ({ ...p, [name]: value }));
  }

  async function saveRank() {
    if ((rank.floorIncrements?.length ?? 0) > 0) {
      const uncovered = checkCoverage(rank.floorIncrements || []);
      if (uncovered.length > 0) {
        const display = uncovered.length > 6
          ? `${uncovered.slice(0, 6).join(', ')} … and ${uncovered.length - 6} more`
          : uncovered.join(', ');
        setError(`Floor bands have gaps — floors not covered: ${display}`);
        return;
      }
    }
    setSaving(true); setError(null);
    try {
      const body = {
        rankNumber:       Number(editForm.rankNumber),
        labelEn:          editForm.labelEn,
        labelZh:          editForm.labelZh,
        rankDifferential: editForm.rankDifferential !== '' ? Number(editForm.rankDifferential) : null,
      };
      const res = await fetch(`/api/ranks/${rank.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const updated = await res.json();
      onUpdate({ ...updated, floorIncrements: rank.floorIncrements });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRank() {
    if (!window.confirm(t('rank.deleteConfirm', { label: rank.labelEn }))) return;
    await fetch(`/api/ranks/${rank.id}`, { method: 'DELETE' });
    onDelete(rank.id);
  }

  async function confirmDuplicate() {
    setDupSaving(true); setDupError(null);
    try {
      const res = await fetch('/api/ranks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId:         rank.projectId,
          rankNumber:        rank.rankNumber,
          labelEn:           rank.labelEn + ' (copy)',
          labelZh:           rank.labelZh + '（复制）',
          rankDifferential:  rank.rankDifferential,
          floorIncrements:   (rank.floorIncrements || []).map(fi => ({
            fromFloor: fi.fromFloor, toFloor: fi.toFloor, incrementPSF: fi.incrementPSF,
          })),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const newRank = await res.json();
      onDuplicated(newRank);
      setDuplicating(false);
    } catch (err) {
      setDupError(err.message);
    } finally {
      setDupSaving(false);
    }
  }

  // Increment mutation callbacks — update rank in-place and bubble up
  function handleIncrementAdded(fi) {
    const sorted = [...(rank.floorIncrements || []), fi].sort((a, b) => a.fromFloor - b.fromFloor);
    onUpdate({ ...rank, floorIncrements: sorted });
  }

  function handleIncrementUpdated(fi) {
    const updated = (rank.floorIncrements || []).map(f => f.id === fi.id ? fi : f)
      .sort((a, b) => a.fromFloor - b.fromFloor);
    onUpdate({ ...rank, floorIncrements: updated });
  }

  function handleIncrementDeleted(fiId) {
    onUpdate({ ...rank, floorIncrements: (rank.floorIncrements || []).filter(fi => fi.id !== fiId) });
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* ── Card header ────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        {/* Info / edit form */}
        {!editing ? (
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-xs font-mono text-gray-400 tabular-nums">#{rank.rankNumber}</span>
              <span className="font-semibold text-gray-900 text-sm">{rank.labelEn}</span>
              <span className="text-xs text-gray-500">{rank.labelZh}</span>
              {rank.rankDifferential != null && (
                <span className={`text-xs font-semibold tabular-nums ${rank.rankDifferential < 0 ? 'text-red-500' : rank.rankDifferential > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                  {rank.rankDifferential >= 0 ? '+' : ''}{rank.rankDifferential} psf
                </span>
              )}
            </div>
            {bandCount > 0 && (
              <div className="mt-0.5 text-xs text-gray-400">
                {bandCount} {t('floorIncrement.title').toLowerCase()}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
            <div>
              <label className="label text-xs">{t('rank.rankNumber')} <span className="text-red-500">*</span></label>
              <input className="input text-xs" name="rankNumber" type="number" min="1"
                value={editForm.rankNumber} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('rank.labelEn')} <span className="text-red-500">*</span></label>
              <input className="input text-xs" name="labelEn" value={editForm.labelEn} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('rank.labelZh')} <span className="text-red-500">*</span></label>
              <input className="input text-xs" name="labelZh" value={editForm.labelZh} onChange={onChange} />
            </div>
            <div>
              <label className="label text-xs">{t('rank.rankDifferential')}</label>
              <input className="input text-xs" name="rankDifferential" type="number" step="0.01" placeholder="0"
                value={editForm.rankDifferential} onChange={onChange} />
              <p className="text-xs text-gray-400 mt-0.5">{t('rank.rankDifferentialHint')}</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {editing ? (
            <>
              <button
                className="btn-primary text-xs px-2 py-1"
                onClick={saveRank} disabled={saving || !editForm.labelEn}
              >{saving ? '…' : t('common.save')}</button>
              <button
                className="btn-secondary text-xs px-2 py-1"
                onClick={() => { setEditing(false); setError(null); }}
              >{t('common.cancel')}</button>
            </>
          ) : (
            <>
              {/* Edit */}
              <button
                className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                onClick={() => setEditing(true)} title={t('common.edit')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
                </svg>
              </button>
              {/* Duplicate */}
              <button
                className={`p-1.5 rounded transition-colors ${
                  duplicating
                    ? 'text-indigo-600 bg-indigo-50'
                    : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                }`}
                onClick={() => { setDuplicating(v => !v); setDupError(null); }}
                title={t('rank.duplicate')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              {/* Delete */}
              <button
                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                onClick={deleteRank} title={t('common.delete')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M4 7h16" />
                </svg>
              </button>
              {/* Expand increments */}
              <button
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                  expanded
                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setExpanded(v => !v)}
              >
                {t('floorIncrement.title')}
                <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Duplicate inline form ─────────────────────────────────────────── */}
      {duplicating && (
        <div className="px-4 py-3 border-t border-indigo-100 bg-indigo-50 flex flex-wrap items-center gap-3">
          <span className="text-xs text-indigo-700">{t('rank.duplicateTitle')}: <strong>{rank.labelEn} (copy)</strong></span>
          {dupError && <p className="text-xs text-red-600">{dupError}</p>}
          <div className="flex gap-2 ml-auto">
            <button
              className="btn-primary text-xs px-2 py-1"
              onClick={confirmDuplicate} disabled={dupSaving}
            >{dupSaving ? '…' : t('common.confirm')}</button>
            <button
              className="btn-secondary text-xs px-2 py-1"
              onClick={() => { setDuplicating(false); setDupError(null); }}
            >{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {/* ── Validation banners ───────────────────────────────────────────── */}
      {bandCount > 0 && coverageErrors.length > 0 && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">
          ⚠ Floor bands incomplete — floors not covered:{' '}
          {coverageErrors.length > 8
            ? `${coverageErrors.slice(0, 8).join(', ')} and ${coverageErrors.length - 8} more`
            : coverageErrors.join(', ')}
        </div>
      )}

      {/* ── Floor increments table (expanded) ────────────────────────────── */}
      {expanded && (
        <FloorIncrementsTable
          rankId={rank.id}
          increments={rank.floorIncrements || []}
          onAdded={handleIncrementAdded}
          onUpdated={handleIncrementUpdated}
          onDeleted={handleIncrementDeleted}
        />
      )}
    </div>
  );
}

// ─── ProjectSetup (main page) ─────────────────────────────────────────────────
export default function ProjectSetup() {
  const { t }         = useTranslation();
  const { projectId } = useParams();
  const navigate      = useNavigate();

  const [projects, setProjects] = useState([]);
  const [project, setProject]   = useState(null);
  const [blocks, setBlocks]     = useState([]);   // source of truth for checksum
  const [ranks, setRanks]       = useState([]);
  const [typeCodes, setTypeCodes] = useState([]);
  const [loading, setLoading]   = useState(false);

  // Project form
  const [form, setForm]       = useState(INITIAL_PROJECT_FORM);
  const [saving, setSaving]   = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(false);

  // Block management
  const [showAddBlock, setShowAddBlock] = useState(false);

  // Rank management
  const [showAddRank, setShowAddRank] = useState(false);

  // Pricing parameters (loaded with project)
  const [pricingParams, setPricingParams] = useState(null);

  // Unit generation
  const [generating, setGenerating] = useState(false);
  const [toast, setToast]           = useState(null); // { type: 'success'|'error', message }

  // Load project list for sidebar
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  // Load current project
  useEffect(() => {
    if (!projectId) {
      setProject(null); setBlocks([]); setRanks([]); setTypeCodes([]); setPricingParams(null); setForm(INITIAL_PROJECT_FORM);
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`/api/projects/${projectId}`).then(r => r.json()),
      fetch(`/api/projects/${projectId}/typecodes`).then(r => r.json()),
    ])
      .then(([p, tcs]) => {
        setProject(p);
        setBlocks(p.blocks || []);
        setRanks(p.ranks || []);
        setTypeCodes(Array.isArray(tcs) ? tcs : []);
        setPricingParams(p.pricingParameters ?? null);
        setForm({
          nameEn:             p.nameEn,
          nameZh:             p.nameZh,
          description:        p.description ?? '',
          totalUnitsExpected: p.totalUnitsExpected?.toString() ?? '',
          roundingUnit:       p.roundingUnit,
          status:             p.status,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  // Refetch blocks (with stacks) and typecodes without touching project form state
  function refetchBlocksAndTypeCodes() {
    Promise.all([
      fetch(`/api/blocks?projectId=${projectId}`).then(r => r.json()),
      fetch(`/api/projects/${projectId}/typecodes`).then(r => r.json()),
    ])
      .then(([bs, tcs]) => {
        setBlocks(Array.isArray(bs)  ? bs  : []);
        setTypeCodes(Array.isArray(tcs) ? tcs : []);
      })
      .catch(console.error);
  }

  // ── TypeCode handlers ──
  function handleTypeCodeAdded(tc) {
    setTypeCodes(prev => [...prev, tc]);
  }
  function handleTypeCodeUpdated(tc) {
    setTypeCodes(prev => prev.map(t => t.id === tc.id ? tc : t));
    refetchBlocksAndTypeCodes();
  }
  function handleTypeCodeDeleted(id) {
    setTypeCodes(prev => prev.filter(t => t.id !== id));
  }

  // ── Project form handlers ──
  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
  }

  async function handleProjectSubmit(e) {
    e.preventDefault();
    setSaving(true); setFormError(null); setFormSuccess(false);
    const body = {
      ...form,
      totalUnitsExpected: form.totalUnitsExpected ? Number(form.totalUnitsExpected) : null,
      roundingUnit:       Number(form.roundingUnit),
    };
    const url    = projectId ? `/api/projects/${projectId}` : '/api/projects';
    const method = projectId ? 'PATCH' : 'POST';
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const saved = await res.json();
      setFormSuccess(true);
      if (!projectId) {
        setProjects(prev => [saved, ...prev]);
        navigate(`/projects/${saved.id}`);
      } else {
        setProject(p => ({ ...p, ...saved }));
        setProjects(prev => prev.map(p => p.id === saved.id ? { ...p, ...saved } : p));
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProject(id) {
    if (!window.confirm('Delete this project and all its data?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (projectId === id) navigate('/projects');
  }

  // ── Block handlers ──
  // onSaved receives an array; panel calls onCancel() itself when fully done
  function handleBlocksAdded(newBlocks) {
    setBlocks(prev => [...prev, ...newBlocks]);
  }

  function handleBlockUpdated(updatedBlock) {
    setBlocks(prev => prev.map(b => b.id === updatedBlock.id ? updatedBlock : b));
  }

  function handleBlockDeleted(blockId) {
    setBlocks(prev => prev.filter(b => b.id !== blockId));
  }

  // ── Rank handlers ──
  function handleRankAdded(rank) {
    setRanks(prev => [...prev, rank].sort((a, b) => a.rankNumber - b.rankNumber));
  }

  function handleRankUpdated(rank) {
    setRanks(prev => prev.map(r => r.id === rank.id ? rank : r));
  }

  function handleRankDeleted(rankId) {
    setRanks(prev => prev.filter(r => r.id !== rankId));
  }

  // ── Unit generation ──
  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-units`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      const achieved = data.achievedOverallAvgPSF != null
        ? ` · S$${Math.round(data.achievedOverallAvgPSF).toLocaleString()} avg PSF`
        : '';
      let message = t('generate.success', { count: data.totalUnits }) + achieved;
      if (data.correctionWarning) message += ` ⚠ ${data.correctionWarning}`;
      setToast({ type: data.correctionWarning ? 'error' : 'success', message });
    } catch (err) {
      setToast({ type: 'error', message: err.message || t('generate.error') });
    } finally {
      setGenerating(false);
    }
  }

  const configuredUnits = computeConfiguredUnits(blocks);
  const expectedUnits   = project?.totalUnitsExpected ?? null;

  return (
    // Negative margins let the sticky bar break out of the page padding to go full-bleed
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      {/* ── Sticky checksum bar ─────────────────────────────────────────────── */}
      {project && (
        <ChecksumBar
          configured={configuredUnits}
          expected={expectedUnits}
          projectId={projectId}
          onGenerate={handleGenerate}
          generating={generating}
        />
      )}

      <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('nav.projectSetup')}</h1>

        {/* ── Project form + sidebar ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="lg:col-span-2 card">
            <h2 className="text-base font-semibold mb-4">
              {projectId ? t('common.edit') + ' Project' : t('project.newProject')}
            </h2>

            {formError   && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                {t('common.success')}
              </div>
            )}

            <form onSubmit={handleProjectSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('project.nameEn')} *</label>
                  <input className="input" name="nameEn" value={form.nameEn} onChange={handleFormChange} required />
                </div>
                <div>
                  <label className="label">{t('project.nameZh')} *</label>
                  <input className="input" name="nameZh" value={form.nameZh} onChange={handleFormChange} required />
                </div>
              </div>
              <div>
                <label className="label">{t('project.description')}</label>
                <textarea
                  className="input" name="description" value={form.description}
                  onChange={handleFormChange} rows={2}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">{t('project.totalUnitsExpected')}</label>
                  <input
                    className="input" name="totalUnitsExpected" type="number" min="0"
                    value={form.totalUnitsExpected} onChange={handleFormChange}
                  />
                </div>
                <div>
                  <label className="label">{t('project.roundingUnit')}</label>
                  <input
                    className="input" name="roundingUnit" type="number" min="1"
                    value={form.roundingUnit} onChange={handleFormChange}
                  />
                </div>
                <div>
                  <label className="label">{t('project.status.label')}</label>
                  <select className="input" name="status" value={form.status} onChange={handleFormChange}>
                    <option value="draft">{t('project.status.draft')}</option>
                    <option value="in-review">{t('project.status.inReview')}</option>
                    <option value="approved">{t('project.status.approved')}</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? t('common.loading') : t('common.save')}
                </button>
                {projectId && (
                  <button
                    type="button" className="btn-secondary"
                    onClick={() => navigate('/projects')}
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Sidebar */}
          <div className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">{t('project.title')}</h2>
            {projects.length === 0 && (
              <p className="text-sm text-gray-400">{t('project.noProjects')}</p>
            )}
            <ul className="flex-1 space-y-1 overflow-y-auto max-h-64">
              {projects.map(p => (
                <li
                  key={p.id}
                  className={`flex items-start justify-between gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                    p.id === projectId
                      ? 'bg-brand-50 border border-brand-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    className="text-left flex-1 min-w-0 text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <span className="block truncate">{p.nameEn}</span>
                    <span className="block text-xs text-gray-400 font-normal truncate">{p.nameZh}</span>
                  </button>
                  <button
                    onClick={() => handleDeleteProject(p.id)}
                    className="text-xs text-gray-300 hover:text-red-500 mt-0.5 flex-shrink-0 transition-colors"
                    title={t('common.delete')}
                  >✕</button>
                </li>
              ))}
            </ul>
            <button
              className="btn-secondary text-xs w-full"
              onClick={() => navigate('/projects')}
            >
              + {t('project.newProject')}
            </button>
          </div>
        </div>

        {/* ── Type Code Library (only when a project is selected) ───────────────── */}
        {projectId && project && (
          <TypeCodeLibrary
            projectId={projectId}
            blocks={blocks}
            typeCodes={typeCodes}
            onAdded={handleTypeCodeAdded}
            onUpdated={handleTypeCodeUpdated}
            onDeleted={handleTypeCodeDeleted}
          />
        )}

        {/* ── Blocks section (only when a project is selected) ────────────────── */}
        {projectId && project && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{t('block.title')}</h2>
              <button
                className={showAddBlock ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setShowAddBlock(v => !v)}
              >
                {showAddBlock ? t('common.cancel') : `+ ${t('block.addBlock')}`}
              </button>
            </div>

            {/* Add block inline form */}
            {showAddBlock && (
              <AddBlocksPanel
                projectId={projectId}
                onSaved={handleBlocksAdded}
                onCancel={() => setShowAddBlock(false)}
              />
            )}

            {loading && (
              <div className="card text-center py-10 text-gray-400 text-sm">
                {t('common.loading')}
              </div>
            )}

            {!loading && blocks.length === 0 && !showAddBlock && (
              <div className="card text-center py-10 text-gray-400">
                <div className="text-3xl mb-2">🏢</div>
                <p className="text-sm">{t('block.noBlocks')}</p>
              </div>
            )}

            {/* Block cards */}
            <div className="space-y-3">
              {[...blocks]
                .sort((a, b) =>
                  String(a.blockName).localeCompare(
                    String(b.blockName),
                    undefined,
                    { numeric: true, sensitivity: "base" }
                  )
                )
                .map(block => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    ranks={ranks}
                    typeCodes={typeCodes}
                    onUpdate={handleBlockUpdated}
                    onDelete={handleBlockDeleted}
                  />
                ))}
            </div>

            {/* Bottom summary when blocks exist */}
            {blocks.length > 0 && (
              <div className="text-xs text-gray-400 text-right">
                {blocks.length} {t('block.title').toLowerCase()}
                {' · '}
                {blocks.reduce((n, b) => n + (b.stacks?.length ?? 0), 0)} {t('stack.title').toLowerCase()}
                {' · '}
                {configuredUnits.toLocaleString()} {t('block.units')} {t('block.unitsConfigured').toLowerCase()}
              </div>
            )}
          </div>
        )}

        {/* ── Ranks section (only when a project is selected) ─────────────────── */}
        {projectId && project && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{t('rank.title')}</h2>
              <button
                className={showAddRank ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setShowAddRank(v => !v)}
              >
                {showAddRank ? t('common.cancel') : `+ ${t('rank.addRank')}`}
              </button>
            </div>

            {showAddRank && (
              <AddRankPanel
                projectId={projectId}
                onSaved={handleRankAdded}
                onCancel={() => setShowAddRank(false)}
              />
            )}

            {!loading && ranks.length === 0 && !showAddRank && (
              <div className="card text-center py-10 text-gray-400">
                <div className="text-3xl mb-2">📊</div>
                <p className="text-sm">{t('rank.noRanks')}</p>
              </div>
            )}

            <div className="space-y-3">
              {ranks.map(rank => (
                <RankCard
                  key={rank.id}
                  rank={rank}
                  blocks={blocks}
                  onUpdate={handleRankUpdated}
                  onDelete={handleRankDeleted}
                  onDuplicated={handleRankAdded}
                />
              ))}
            </div>

            {ranks.length > 0 && (
              <div className="text-xs text-gray-400 text-right">
                {ranks.length} {t('rank.title').toLowerCase()}
                {' · '}
                {ranks.reduce((n, r) => n + (r.floorIncrements?.length ?? 0), 0)} {t('floorIncrement.title').toLowerCase()}
              </div>
            )}
          </div>
        )}

        {/* ── Pricing Parameters section ──────────────────────────────────────── */}
        {projectId && project && (
          <PricingParametersForm
            projectId={projectId}
            blocks={blocks}
            initialParams={pricingParams}
          />
        )}
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
