import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const STATUS_BADGE = {
  draft:     'badge-draft',
  'in-review': 'badge-in-review',
  approved:  'badge-approved',
};

export default function Dashboard() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const approved  = projects.filter(p => p.status === 'approved').length;
  const inReview  = projects.filter(p => p.status === 'in-review').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('dashboard.welcome')}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('dashboard.totalProjects')}  value={projects.length} color="bg-brand-50 text-brand-700" />
        <StatCard label={t('dashboard.activeProjects')} value={inReview}        color="bg-yellow-50 text-yellow-700" />
        <StatCard label={t('project.status.approved')}  value={approved}        color="bg-green-50 text-green-700" />
      </div>

      {/* Project list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">{t('project.title')}</h2>
          <Link to="/projects" className="btn-primary text-xs px-3 py-1.5">
            + {t('project.newProject')}
          </Link>
        </div>

        {loading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
        {error   && <p className="text-sm text-red-500">{t('common.error')}: {error}</p>}

        {!loading && !error && projects.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">{t('project.noProjects')}</p>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="pb-2 pr-4 font-medium">{t('common.name')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('common.status')}</th>
                  <th className="pb-2 pr-4 font-medium">Blocks</th>
                  <th className="pb-2 font-medium">{t('common.updatedAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      <Link
                        to={`/projects/${p.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {p.nameEn}
                      </Link>
                      <div className="text-xs text-gray-400">{p.nameZh}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={STATUS_BADGE[p.status] ?? 'badge'}>
                        {t(`project.status.${p.status === 'in-review' ? 'inReview' : p.status}`)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500">{p._count?.blocks ?? 0}</td>
                    <td className="py-3 text-gray-400 text-xs">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={`rounded-xl p-5 ${color} border border-current border-opacity-20`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm font-medium opacity-80">{label}</div>
    </div>
  );
}
