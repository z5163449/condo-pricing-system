import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PricingEngine() {
  const { t }         = useTranslation();
  const { projectId } = useParams();
  const navigate      = useNavigate();

  const [projects, setProjects] = useState([]);
  const [project, setProject]   = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!projectId) { setProject(null); return; }
    setLoading(true);
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => { setProject(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('pricing.title')}</h1>
        {/* Project selector */}
        <select
          className="input w-56"
          value={projectId ?? ''}
          onChange={e => navigate(e.target.value ? `/pricing/${e.target.value}` : '/pricing')}
        >
          <option value="">— Select Project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.nameEn}</option>
          ))}
        </select>
      </div>

      {!projectId && (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-sm">{t('export.selectProject')}</p>
        </div>
      )}

      {loading && (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {project && !loading && (
        <div className="space-y-4">
          {/* Pricing Parameters */}
          <div className="card">
            <h2 className="text-base font-semibold mb-4">{t('pricing.parameters')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {[
                ['targetOverallAvgPSF', t('pricing.targetOverallAvgPSF')],
                ['target2BRPSF',        t('pricing.target2BRPSF')],
                ['target3BRPSF',        t('pricing.target3BRPSF')],
                ['target4BRPSF',        t('pricing.target4BRPSF')],
                ['target5BRPSF',        t('pricing.target5BRPSF')],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="label text-xs">{label}</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="—"
                    defaultValue={project.pricingParameters?.[key] ?? ''}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button className="btn-primary">{t('pricing.recalculate')}</button>
              <button className="btn-secondary">{t('pricing.saveSnapshot')}</button>
            </div>
          </div>

          {/* Ranks summary */}
          <div className="card">
            <h2 className="text-base font-semibold mb-4">{t('rank.title')}</h2>
            {project.ranks?.length === 0 && (
              <p className="text-sm text-gray-400">No ranks defined yet. Add ranks in Project Setup.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {project.ranks?.map(rank => (
                <div key={rank.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="text-sm font-semibold">{rank.labelEn}</div>
                  <div className="text-xs text-gray-500">{rank.labelZh}</div>
                  <div className="mt-2 text-lg font-bold text-brand-600">
                    S${rank.basePSF.toLocaleString()} psf
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {rank.floorIncrements?.length ?? 0} floor increment band(s)
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Unit table placeholder */}
          <div className="card">
            <h2 className="text-base font-semibold mb-4">{t('unit.title')}</h2>
            <p className="text-sm text-gray-400">
              Unit-level pricing table will appear here once blocks and stacks are configured.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
