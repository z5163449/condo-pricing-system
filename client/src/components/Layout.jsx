import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n.js';

const NAV_ITEMS = [
  { to: '/dashboard',  labelKey: 'nav.dashboard' },
  { to: '/projects',   labelKey: 'nav.projectSetup' },
  { to: '/pricing',    labelKey: 'nav.pricingEngine' },
  { to: '/export',     labelKey: 'nav.export' },
];

export default function Layout() {
  const { t } = useTranslation();
  const location = useLocation();

  function toggleLang() {
    const next = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header className="bg-brand-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo / app name */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center font-bold text-sm">
                CP
              </div>
              <span className="font-semibold text-lg tracking-tight">
                {t('appName')}
              </span>
            </div>

            {/* Nav links */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map(({ to, labelKey }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-600 text-white'
                        : 'text-brand-100 hover:bg-brand-800'
                    }`
                  }
                >
                  {t(labelKey)}
                </NavLink>
              ))}
            </nav>

            {/* Language toggle */}
            <button
              onClick={toggleLang}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-600
                         text-brand-100 hover:bg-brand-700 transition-colors"
              aria-label="Toggle language"
            >
              {i18n.language === 'en' ? '中文' : 'EN'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile nav ──────────────────────────────────────────────────────── */}
      <nav className="md:hidden bg-brand-800 border-t border-brand-700">
        <div className="flex overflow-x-auto px-2 py-1 gap-1">
          {NAV_ITEMS.map(({ to, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-brand-200 hover:bg-brand-700'
                }`
              }
            >
              {t(labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ── Page content ────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white py-3 text-center text-xs text-gray-400">
        Condo Pricing System &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
