import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Export() {
  const { t }         = useTranslation();
  const { projectId } = useParams();
  const navigate      = useNavigate();

  const [projects, setProjects]         = useState([]);
  const [project, setProject]           = useState(null);
  const [includeUnits, setIncludeUnits] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [exporting, setExporting]       = useState(null); // 'excel' | 'pdf' | null

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!projectId) { setProject(null); return; }
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(setProject)
      .catch(console.error);
  }, [projectId]);

  async function handleExport(format) {
    setExporting(format);
    try {
      const params = new URLSearchParams({
        includeUnits:   includeUnits.toString(),
        includeSummary: includeSummary.toString(),
      });
      const res = await fetch(`/api/projects/${projectId}/export/${format}?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${project?.nameEn ?? 'export'}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('export.title')}</h1>
        <select
          className="input w-56"
          value={projectId ?? ''}
          onChange={e => navigate(e.target.value ? `/export/${e.target.value}` : '/export')}
        >
          <option value="">— Select Project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.nameEn}</option>
          ))}
        </select>
      </div>

      {!projectId ? (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-sm">{t('export.selectProject')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Options */}
          <div className="card">
            <h2 className="text-base font-semibold mb-4">Export Options</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnits}
                  onChange={e => setIncludeUnits(e.target.checked)}
                  className="w-4 h-4 text-brand-600 rounded"
                />
                <span className="text-sm text-gray-700">{t('export.includeUnits')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={e => setIncludeSummary(e.target.checked)}
                  className="w-4 h-4 text-brand-600 rounded"
                />
                <span className="text-sm text-gray-700">{t('export.includeSummary')}</span>
              </label>
            </div>

            {project && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
                <div><span className="font-medium">Project:</span> {project.nameEn}</div>
                <div><span className="font-medium">Blocks:</span> {project.blocks?.length ?? 0}</div>
                <div><span className="font-medium">Status:</span> {project.status}</div>
              </div>
            )}
          </div>

          {/* Export buttons */}
          <div className="card space-y-4">
            <h2 className="text-base font-semibold">Download</h2>

            <ExportCard
              icon="📊"
              title={t('export.toExcel')}
              description="Exports unit pricing table with colour-coded overrides and summary pivot by bedroom type."
              onClick={() => handleExport('excel')}
              loading={exporting === 'excel'}
            />

            <ExportCard
              icon="📋"
              title={t('export.toPDF')}
              description="Generates a formatted price list suitable for distribution to agents or stakeholders."
              onClick={() => handleExport('pdf')}
              loading={exporting === 'pdf'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExportCard({ icon, title, description, onClick, loading }) {
  return (
    <div className="flex items-start gap-4 p-4 border border-gray-200 rounded-xl hover:border-brand-300 transition-colors">
      <div className="text-3xl">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
      <button
        onClick={onClick}
        disabled={loading}
        className="btn-primary flex-shrink-0"
      >
        {loading ? '…' : 'Export'}
      </button>
    </div>
  );
}
