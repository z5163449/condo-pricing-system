import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const INITIAL_FORM = {
  nameEn: '',
  nameZh: '',
  description: '',
  totalUnitsExpected: '',
  roundingUnit: 100,
  status: 'draft',
};

export default function ProjectSetup() {
  const { t }          = useTranslation();
  const { projectId }  = useParams();
  const navigate       = useNavigate();
  const isEdit         = Boolean(projectId);

  const [projects, setProjects] = useState([]);
  const [form, setForm]         = useState(INITIAL_FORM);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(false);

  // Load existing projects list
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  // Load project for editing
  useEffect(() => {
    if (!projectId) { setForm(INITIAL_FORM); return; }
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(p => setForm({
        nameEn:             p.nameEn,
        nameZh:             p.nameZh,
        description:        p.description ?? '',
        totalUnitsExpected: p.totalUnitsExpected ?? '',
        roundingUnit:       p.roundingUnit,
        status:             p.status,
      }))
      .catch(console.error);
  }, [projectId]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const body = {
      ...form,
      totalUnitsExpected: form.totalUnitsExpected ? Number(form.totalUnitsExpected) : null,
      roundingUnit: Number(form.roundingUnit),
    };

    const url    = isEdit ? `/api/projects/${projectId}` : '/api/projects';
    const method = isEdit ? 'PATCH' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Request failed');
      }
      const saved = await res.json();
      setSuccess(true);
      if (!isEdit) navigate(`/projects/${saved.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (projectId === id) navigate('/projects');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('nav.projectSetup')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 card">
          <h2 className="text-base font-semibold mb-4">
            {isEdit ? 'Edit Project' : t('project.newProject')}
          </h2>

          {error   && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{t('common.success')}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('project.nameEn')} *</label>
                <input className="input" name="nameEn" value={form.nameEn} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">{t('project.nameZh')} *</label>
                <input className="input" name="nameZh" value={form.nameZh} onChange={handleChange} required />
              </div>
            </div>

            <div>
              <label className="label">{t('project.description')}</label>
              <textarea className="input" name="description" value={form.description} onChange={handleChange} rows={3} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">{t('project.totalUnitsExpected')}</label>
                <input className="input" name="totalUnitsExpected" type="number" min="0" value={form.totalUnitsExpected} onChange={handleChange} />
              </div>
              <div>
                <label className="label">{t('project.roundingUnit')}</label>
                <input className="input" name="roundingUnit" type="number" min="1" value={form.roundingUnit} onChange={handleChange} />
              </div>
              <div>
                <label className="label">{t('project.status.label')}</label>
                <select className="input" name="status" value={form.status} onChange={handleChange}>
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
              <button type="button" className="btn-secondary" onClick={() => { setForm(INITIAL_FORM); navigate('/projects'); }}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>

        {/* ── Project list sidebar ─────────────────────────────────────────── */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">{t('project.title')}</h2>
          {projects.length === 0 && (
            <p className="text-sm text-gray-400">{t('project.noProjects')}</p>
          )}
          <ul className="space-y-2">
            {projects.map(p => (
              <li key={p.id} className="flex items-start justify-between gap-2 p-2 rounded-lg hover:bg-gray-50">
                <button
                  className="text-left flex-1 text-sm font-medium text-brand-600 hover:underline"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  {p.nameEn}
                  <div className="text-xs text-gray-400 font-normal">{p.nameZh}</div>
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="text-xs text-red-500 hover:text-red-700 mt-0.5 flex-shrink-0"
                  title={t('common.delete')}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
