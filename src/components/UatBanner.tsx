/**
 * Shown on every page while user acceptance testing runs on the live system.
 *
 * UAT shares the live database: academic (LMS) entries made during UAT are
 * removed at go-live by scripts/uat/03_wipe_uat_data.sql, while HR and payroll
 * are live and never wiped. The banner keeps anyone from entering real academic
 * records that would then disappear.
 *
 * On while VITE_UAT_MODE is "true" in .env; set it to "false" at go-live.
 */
export const UAT_MODE = import.meta.env.VITE_UAT_MODE === 'true';

export const UAT_BANNER_TEXT =
  'UAT in progress — academic (LMS) entries made now are test data and will be removed at go-live. HR and payroll are live.';

export function UatBanner() {
  if (!UAT_MODE) return null;
  return (
    <div
      data-testid="uat-banner"
      role="status"
      style={{
        background: '#fff8c5', color: '#7a4d00', borderBottom: '1px solid #e8c547',
        padding: '6px 16px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <i className="fa-solid fa-flask" />
      <span>{UAT_BANNER_TEXT}</span>
    </div>
  );
}
