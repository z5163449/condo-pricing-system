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

function computeBlockUnits(block) {
  const blockExcl = parseExcluded(block.excludedFloors);
  return (block.stacks || []).reduce((sum, s) => {
    const stkExcl  = parseExcluded(s.stackExcludedFloors);
    const combined = new Set([...blockExcl, ...stkExcl]);
    return sum + Math.max(0, (block.totalStoreys || 0) + 1 - combined.size);
  }, 0);
}

function computeConfiguredUnits(blocks) {
  return blocks.reduce((sum, b) => sum + computeBlockUnits(b), 0);
}

// ─── ChecksumBar ──────────────────────────────────────────────────────────────
function ChecksumBar({ configured, expected }) {
  const { t } = useTranslation();
  const hasTarget = expected != null && expected > 0;
  const diff      = hasTarget ? configured - expected : 0;

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
      className={`${bgCls} text-white px-4 sm:px-6 lg:px-8 py-2.5
                  flex items-center justify-between text-sm font-medium shadow-md
                  sticky top-0 z-30`}
    >
      <span>
        {icon}&nbsp; {t('block.unitsConfigured')}:&nbsp;
        <strong>{configured.toLocaleString()}</strong>
        {hasTarget && (
          <> / <strong>{expected.toLocaleString()}</strong></>
        )}
      </span>
      {detail && <span className="text-xs opacity-90">{detail}</span>}
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

// ─── StackRow — display + inline edit ─────────────────────────────────────────
function StackRow({ stack, ranks, blockStartingFloor, onSaved, onDeleted }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
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
  return (
    <tr className="bg-brand-50 border-y border-brand-100">
      <td className="px-2 py-1.5">
        <input
          className="input w-14 text-xs text-center" name="stackNumber"
          value={form.stackNumber} onChange={onChange} placeholder="01"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input w-20 text-xs" name="unitTypeCode"
          value={form.unitTypeCode} onChange={onChange} required placeholder="B2-m"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input w-24 text-xs" name="bedroomType" list="bedroom-type-options"
          value={form.bedroomType} onChange={onChange} placeholder="3BR"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input w-20 text-xs text-right" name="standardSizeSqft"
          type="number" min="0" step="0.1" value={form.standardSizeSqft} onChange={onChange}
        />
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
            onClick={save} disabled={saving || !form.unitTypeCode || !form.standardSizeSqft}
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
function AddStacksPanel({ blockId, ranks, blockStartingFloor, onSaved, onCancel }) {
  const { t } = useTranslation();

  const newRow = () => ({
    _key: Math.random().toString(36).slice(2),
    stackNumber: '', unitTypeCode: '', bedroomType: '3BR',
    standardSizeSqft: '', facing: '', rankId: '',
    hasPenthouse: false, penthouseSizeSqft: '', stackExcludedFloors: '',
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
        fetch(`/api/blocks/${blockId}/stacks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stackNumber:       row.stackNumber !== '' ? Number(row.stackNumber) : 0,
            unitTypeCode:      row.unitTypeCode,
            bedroomType:       row.bedroomType,
            standardSizeSqft:  Number(row.standardSizeSqft),
            facing:            row.facing || null,
            rankId:            row.rankId || null,
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

  // Column definitions — required flag drives the * marker
  const COLS = [
    { label: t('stack.stackNumber'),         req: false, cls: 'w-[52px]' },
    { label: t('stack.unitTypeCode'),        req: true,  cls: 'w-[88px]' },
    { label: t('stack.bedroomType'),         req: true,  cls: 'w-[76px]' },
    { label: t('stack.standardSizeSqft'),    req: true,  cls: 'w-[76px]' },
    { label: t('stack.facing'),              req: false, cls: 'w-[88px]' },
    { label: t('stack.rank'),                req: false, cls: 'flex-1 min-w-[96px]' },
    { label: t('stack.hasPenthouse'),        req: false, cls: 'w-[36px] text-center' },
    { label: t('stack.penthouseSizeSqft'),   req: false, cls: 'w-[72px]' },
    { label: t('stack.stackExcludedFloors'), req: false, cls: 'w-[80px]' },
  ];

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
                {/* Type Code */}
                <input className="input text-xs w-[88px] shrink-0" placeholder="B2-m"
                  value={row.unitTypeCode} onChange={e => update(row._key, 'unitTypeCode', e.target.value)} />
                {/* Bedroom */}
                <input className="input text-xs w-[76px] shrink-0" list="bedroom-type-options"
                  placeholder="3BR" value={row.bedroomType}
                  onChange={e => update(row._key, 'bedroomType', e.target.value)} />
                {/* Size */}
                <input className="input text-xs text-right w-[76px] shrink-0" type="number" min="0" step="0.1" placeholder="sqft"
                  value={row.standardSizeSqft} onChange={e => update(row._key, 'standardSizeSqft', e.target.value)} />
                {/* Facing */}
                <input className="input text-xs w-[88px] shrink-0" placeholder="N/Pool…"
                  value={row.facing} onChange={e => update(row._key, 'facing', e.target.value)} />
                {/* Rank */}
                <select className="input text-xs flex-1 min-w-[96px]" value={row.rankId}
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
function StacksTable({ blockId, stacks, ranks, blockStartingFloor, onStacksAdded, onStackUpdated, onStackDeleted }) {
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
function BlockCard({ block, ranks, onUpdate, onDelete }) {
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
  const excl       = parseExcluded(block.excludedFloors);
  const floorCount = Math.max(0, block.totalStoreys - block.startingFloor + 1 - excl.length);
  const stackCount = (block.stacks || []).length;
  const unitCount  = floorCount * stackCount;

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
          onStacksAdded={handleStacksAdded}
          onStackUpdated={handleStackUpdated}
          onStackDeleted={handleStackDeleted}
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
  const [loading, setLoading]   = useState(false);

  // Project form
  const [form, setForm]       = useState(INITIAL_PROJECT_FORM);
  const [saving, setSaving]   = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(false);

  // Block management
  const [showAddBlock, setShowAddBlock] = useState(false);

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
      setProject(null); setBlocks([]); setRanks([]); setForm(INITIAL_PROJECT_FORM);
      return;
    }
    setLoading(true);
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(p => {
        setProject(p);
        setBlocks(p.blocks || []);
        setRanks(p.ranks || []);
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

  const configuredUnits = computeConfiguredUnits(blocks);
  const expectedUnits   = project?.totalUnitsExpected ?? null;

  return (
    // Negative margins let the sticky bar break out of the page padding to go full-bleed
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      {/* ── Sticky checksum bar ─────────────────────────────────────────────── */}
      {project && (
        <ChecksumBar configured={configuredUnits} expected={expectedUnits} />
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
      </div>
    </div>
  );
}
