import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Export() {
  const { t }         = useTranslation();
  const { projectId } = useParams();
  const navigate      = useNavigate();

  const [projects,   setProjects]   = useState([]);
  const [project,    setProject]    = useState(null);
  const [scenarios,  setScenarios]  = useState([]);
  const [scenarioId, setScenarioId] = useState('');   // '' = live data
  const [language,   setLanguage]   = useState('en');
  const [generating, setGenerating] = useState(false);
  const [pdfError,   setPdfError]   = useState(null);

  // Load projects list
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  // Load project details + scenarios when projectId changes
  useEffect(() => {
    if (!projectId) { setProject(null); setScenarios([]); setScenarioId(''); return; }

    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(setProject)
      .catch(console.error);

    fetch(`/api/projects/${projectId}/scenarios`)
      .then(r => r.json())
      .then(data => {
        setScenarios(data);
        // Default to the first scenario (base or most recent); fall back to live data
        setScenarioId(data[0]?.id ?? '');
      })
      .catch(console.error);
  }, [projectId]);

  const nsaMismatch = project?.expectedNSA != null && project?.nsaMatch === false;

  async function handleGeneratePdf() {
    setGenerating(true);
    setPdfError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export/pdf`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scenarioId: scenarioId || null, language }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'PDF generation failed');
      }

      const blob         = await res.blob();
      const url          = URL.createObjectURL(blob);
      const a            = document.createElement('a');
      const scenarioName = scenarios.find(s => s.id === scenarioId)?.name ?? 'live';
      a.href             = url;
      a.download         = `${project?.nameEn ?? 'export'}_${scenarioName}_${language}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err.message);
      setTimeout(() => setPdfError(null), 6000);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('export.title')}</h1>
        <select
          className="input w-56"
          value={projectId ?? ''}
          onChange={e => navigate(e.target.value ? `/export/${e.target.value}` : '/export')}
        >
          <option value="">— {t('export.selectProject')} —</option>
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

          {/* ── Chairman PDF ─────────────────────────────────────────────── */}
          <div className="card space-y-5">
            <h2 className="text-base font-semibold text-gray-900">
              {t('export.chairmanPdf')}
            </h2>

            <div className="border-t border-gray-100 pt-5 space-y-5">

              {/* NSA mismatch warning (warning only — does not block PDF) */}
              {nsaMismatch && (
                <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <span className="flex-shrink-0">⚠</span>
                  <span>{t('export.nsaWarning')}</span>
                </div>
              )}

              {/* Inline PDF error toast */}
              {pdfError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {pdfError}
                </div>
              )}

              {/* Scenario selector */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  {t('export.scenario')}
                </label>
                <select
                  className="input"
                  value={scenarioId}
                  onChange={e => setScenarioId(e.target.value)}
                >
                  <option value="">{t('export.liveData')}</option>
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.isLocked ? ' 🔒' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Language toggle */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  {t('export.language')}
                </label>
                <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                  {[
                    { value: 'en', label: t('export.english') },
                    { value: 'zh', label: t('export.chinese') },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLanguage(opt.value)}
                      className={`px-5 py-2 text-sm font-medium transition-colors focus:outline-none ${
                        language === opt.value
                          ? 'bg-brand-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <button
                type="button"
                onClick={handleGeneratePdf}
                disabled={generating}
                className="btn-primary w-full justify-center"
              >
                {generating ? (
                  <>
                    <Spinner />
                    {t('export.generatingPdf')}
                  </>
                ) : (
                  t('export.generatePdf')
                )}
              </button>

            </div>
          </div>

          {/* ── Excel Export (coming soon) ────────────────────────────────── */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900">
              {t('export.excelExport')}
            </h2>
            <div className="border-t border-gray-100 mt-4 pt-4">
              <p className="text-sm text-gray-400 italic">{t('export.comingSoon')}</p>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
