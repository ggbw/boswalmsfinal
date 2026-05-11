import { useApp } from '@/context/AppContext';

export default function HRComingSoonPage() {
  const { activePage } = useApp();
  const label = activePage
    .replace(/^hr-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{label}</div>
          <div className="page-sub" style={{ color: 'var(--text2, #484f58)' }}>
            HR Management
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-title">
          <span>Coming Soon</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: '#484f58' }}>
          <i
            className="fa-solid fa-screwdriver-wrench"
            style={{ fontSize: 32, color: '#d4920a', marginBottom: 12 }}
          />
          <div style={{ fontSize: 16, marginBottom: 8, color: '#e6edf3' }}>
            This HR module is being installed.
          </div>
          <div style={{ fontSize: 13 }}>
            The interface will appear here once the integration completes.
          </div>
        </div>
      </div>
    </>
  );
}
