import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useUserRole } from "@/hooks/hr/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/rolePages";
import {
  DEFAULT_AREA,
  NAV_AREAS,
  areaOfPage,
  areasForRole,
  buildMenu,
  getNavArea,
  type AreaId,
  type BadgeKey,
  type NavItem,
} from "@/lib/navAreas";

// Counts of pending HR approvals shown as badges next to the Leaves / Loans
// menu items. Returns zeros when the user lacks HR access — the query is
// skipped entirely so non-HR roles don't poke at HR tables.
//
// Note: boswalmsfinal's employees table does not have an `employee_type`
// column, so we don't try to embed it (doing so returns 400 from PostgREST).
// The hook only runs for HR/admin, which already implies canSeeManagers, so
// the manager-vs-regular filtering motho2 used here is a no-op anyway.
function useHrPendingCounts(isHR: boolean): HrPendingCounts {
  const [counts, setCounts] = useState<HrPendingCounts>({ pendingLeaves: 0, pendingLoans: 0 });
  useEffect(() => {
    if (!isHR) {
      setCounts({ pendingLeaves: 0, pendingLoans: 0 });
      return;
    }
    let alive = true;
    void (async () => {
      const [leavesRes, loansRes] = await Promise.all([
        supabase.from('leave_requests').select('id').eq('status', 'pending'),
        supabase.from('advance_salaries').select('id').eq('status', 'Submitted'),
      ]);
      if (!alive) return;
      setCounts({
        pendingLeaves: (leavesRes.data ?? []).length,
        pendingLoans:  (loansRes.data  ?? []).length,
      });
    })();
    return () => { alive = false; };
  }, [isHR]);
  return counts;
}

interface HrPendingCounts {
  pendingLeaves: number;
  pendingLoans: number;
}

function hasActiveDescendant(item: NavItem, activeId: string): boolean {
  if (!item.children) return false;
  return item.children.some((c) => c.id === activeId || hasActiveDescendant(c, activeId));
}

/**
 * Remembered across sessions — someone who works collapsed does not want to
 * re-collapse it every morning. Reading localStorage in the initialiser rather
 * than an effect avoids a visible flash of the expanded rail on load.
 */
const COLLAPSE_KEY = "boswa.sidebar.collapsed";

/** Per user, so two people sharing a browser each keep their own area. */
const areaKeyFor = (userId: string | undefined) => `boswa.sidebar.area.${userId ?? "anon"}`;

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  };

  const { db, currentUser, activePage, navigate, setCurrentUser } = useApp();
  const { isHR } = useUserRole();
  // Same default as AppLayout's guard: an unset role gets the smallest menu,
  // never the admin one.
  const role = (currentUser?.role || "student") as AppRole;
  const hrPending = useHrPendingCounts(isHR);
  const areas = areasForRole(role);
  const areaKey = areaKeyFor(currentUser?.id);

  const pickArea = (): AreaId | null => {
    try {
      const saved = localStorage.getItem(areaKey) as AreaId | null;
      if (saved && areas.includes(saved)) return saved;
    } catch { /* private mode */ }
    const fallback = DEFAULT_AREA[role];
    return fallback && areas.includes(fallback) ? fallback : areas[0] ?? null;
  };

  const [area, setArea] = useState<AreaId | null>(pickArea);

  // Impersonation changes the role without remounting: re-pick for the new
  // role and user.
  useEffect(() => { setArea(pickArea()); }, [role, currentUser?.id]);

  // Follow the page. A dashboard tile or notification can open a page in
  // another area, so the menu switches to show where the user now is.
  useEffect(() => {
    const pageArea = areaOfPage(activePage);
    if (pageArea && pageArea !== area && areas.includes(pageArea)) setArea(pageArea);
  }, [activePage, role]);

  const chooseArea = (next: AreaId) => {
    setArea(next);
    try { localStorage.setItem(areaKey, next); } catch { /* private mode */ }
  };

  const navConfig = buildMenu(role, area);
  const currentArea = getNavArea(area);

  const badgeValue = (key: BadgeKey | undefined): number | undefined => {
    switch (key) {
      case "notifications": return db.notifications.length;
      // Admin only, as before: the count of every student in the school.
      case "students": return role === "admin" || role === "super_admin" ? db.students.length : undefined;
      case "pendingLeaves": return hrPending.pendingLeaves > 0 ? hrPending.pendingLeaves : undefined;
      case "pendingLoans": return hrPending.pendingLoans > 0 ? hrPending.pendingLoans : undefined;
      default: return undefined;
    }
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const open: Record<string, boolean> = {};
    const walk = (items: NavItem[]) => {
      items.forEach((it) => {
        if (it.children) {
          if (hasActiveDescendant(it, activePage)) open[it.id] = true;
          walk(it.children);
        }
      });
    };
    navConfig.forEach((sec) => walk(sec.items));
    if (Object.keys(open).length) {
      setExpanded((prev) => ({ ...prev, ...open }));
    }
  }, [activePage, role, area]);

  const toggleGroup = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // hr-attendance-report sits in both HR Management and Self Service, so the
  // Self Service copy gets its own test id.
  const renderItem = (item: NavItem, depth: number, sectionName: string) => {
    const isGroup = !!item.children && item.children.length > 0;
    const indentStyle = depth > 0 ? { paddingLeft: 16 + depth * 14 } : undefined;

    if (isGroup) {
      const open = !!expanded[item.id];
      const activeInside = hasActiveDescendant(item, activePage);
      return (
        <div key={item.id}>
          <div
            className={`nav-item nav-group ${activeInside ? "has-active" : ""}`}
            title={item.label}
            style={indentStyle}
            data-testid={`sidebar-group-${item.id}`}
            onClick={() => toggleGroup(item.id)}
          >
            <span className="ico">
              <i className={item.icon} />
            </span>
            <span>{item.label}</span>
            <i
              className={`nav-caret fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"}`}
            />
          </div>
          {open && (
            <div className="nav-children">
              {item.children!.map((child) => renderItem(child, depth + 1, sectionName))}
            </div>
          )}
        </div>
      );
    }

    const badge = badgeValue(item.badge);
    const testId = sectionName === "Self Service" ? `sidebar-nav-self-${item.id}` : `sidebar-nav-${item.id}`;
    return (
      <div
        key={item.id}
        className={`nav-item ${activePage === item.id ? "active" : ""} ${depth > 0 ? "nav-child" : ""}`}
        title={item.label}
        style={indentStyle}
        data-testid={testId}
        onClick={() => navigate(item.id)}
      >
        <span className="ico">
          <i className={item.icon} />
        </span>
        <span>{item.label}</span>
        {badge !== undefined && (
          <span className={`nav-badge ${badge > 0 ? "new" : ""}`}>{badge}</span>
        )}
      </div>
    );
  };

  return (
    <div className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="logo">
        <div className="logo-img">B</div>
        <div className="logo-text">
          <div className="name">Boswa CIB</div>
          <div className="sub">{currentArea?.fullName ?? "School Management"}</div>
        </div>
        {/* Sits beside the brand so it is where the eye already is, and stays
            reachable when collapsed — a toggle you cannot find to undo is worse
            than no toggle. */}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <i className={`fa-solid ${collapsed ? "fa-angles-right" : "fa-angles-left"}`} />
        </button>
      </div>
      {/* Only the menu changes when a tab is clicked; the open page stays. */}
      {areas.length > 1 && (
        <div className="area-tabs" role="tablist" aria-label="System area" data-testid="sidebar-area-tablist">
          {NAV_AREAS.filter((a) => areas.includes(a.id)).map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={area === a.id}
              className={`area-tab${area === a.id ? " active" : ""}`}
              title={a.fullName}
              data-testid={`sidebar-area-${a.id}-tab`}
              onClick={() => chooseArea(a.id)}
            >
              <i className={a.icon} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="nav-menu">
        {navConfig.map((sec) => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items.map((item) => renderItem(item, 0, sec.section))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer" onClick={() => navigate("profile")}>
        <div className="s-avatar" style={{ background: "linear-gradient(135deg,#d4920a,#f0b429)" }}>
          {currentUser?.name?.[0]?.toUpperCase() || "A"}
        </div>
        <div>
          <div style={{ color: "#e6edf3", fontSize: 11, fontWeight: 600 }}>{currentUser?.name || "Admin"}</div>
          <div style={{ color: "#484f58", fontSize: 9.5 }}>{({ hoa: "HOA", principal: "PRINCIPAL", deputy_principal: "DEPUTY PRINCIPAL" } as Record<string,string>)[role] || role.toUpperCase()}</div>
        </div>
        <i
          className="fa-solid fa-right-from-bracket"
          title="Sign out"
          aria-label="Sign out"
          role="button"
          tabIndex={0}
          style={{ marginLeft: "auto", color: "#484f58", fontSize: 12, cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            setCurrentUser(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setCurrentUser(null);
            }
          }}
        />
      </div>
    </div>
  );
}
