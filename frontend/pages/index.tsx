import Head from "next/head";
import Link from "next/link";
import { Check, Loader2, PencilLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DashboardSidebar } from "../components/dashboard-sidebar";
import { getDashboardDisplayName, useCurrentUser } from "../lib/auth";
import {
  fetchDashboardPreferences,
  updateDashboardPreferences,
} from "../lib/dashboard/preferences-api";
import {
  DASHBOARD_ROUTE_GROUPS,
  DASHBOARD_ROUTES,
  DEFAULT_QUICK_ACCESS_ROUTE_IDS,
  getDashboardRouteById,
  isDashboardRouteId,
  type DashboardRouteId,
} from "../lib/dashboard/routes";
import s from "../styles/dashboard.module.css";

function normalizeQuickAccessRoutes(routeIds: string[]): DashboardRouteId[] {
  if (routeIds.length > 4) {
    throw new Error("Dashboard preferences returned more than 4 quick access routes.");
  }

  const seen = new Set<DashboardRouteId>();
  const normalized: DashboardRouteId[] = [];

  for (const routeId of routeIds) {
    if (!isDashboardRouteId(routeId)) {
      throw new Error(`Dashboard preferences returned unknown route ID: ${routeId}`);
    }
    if (seen.has(routeId)) {
      throw new Error(`Dashboard preferences returned duplicate route ID: ${routeId}`);
    }
    seen.add(routeId);
    normalized.push(routeId);
  }

  return normalized;
}

export default function HomePage() {
  const { name, email } = useCurrentUser();
  const [quickAccessRouteIds, setQuickAccessRouteIds] = useState<DashboardRouteId[]>(
    DEFAULT_QUICK_ACCESS_ROUTE_IDS,
  );
  const [draftRouteIds, setDraftRouteIds] = useState<DashboardRouteId[]>(
    DEFAULT_QUICK_ACCESS_ROUTE_IDS,
  );
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      setLoadingPreferences(true);
      setLoadError(null);
      try {
        const response = await fetchDashboardPreferences();
        const normalized = normalizeQuickAccessRoutes(response.quick_access_routes);
        if (!cancelled) {
          setQuickAccessRouteIds(normalized);
          setDraftRouteIds(normalized);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load dashboard preferences.";
          setLoadError(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingPreferences(false);
        }
      }
    }

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = getDashboardDisplayName(name, email);

  const quickAccessRoutes = useMemo(
    () => quickAccessRouteIds.map((routeId) => getDashboardRouteById(routeId)),
    [quickAccessRouteIds],
  );

  const groupedSelectableRoutes = useMemo(
    () => DASHBOARD_ROUTE_GROUPS.map((group) => ({
      group,
      routes: DASHBOARD_ROUTES.filter((route) => route.group === group),
    })),
    [],
  );

  function openCustomize() {
    setDraftRouteIds(quickAccessRouteIds);
    setSaveError(null);
    setCustomizeOpen(true);
  }

  function closeCustomize() {
    setDraftRouteIds(quickAccessRouteIds);
    setSaveError(null);
    setCustomizeOpen(false);
  }

  useEffect(() => {
    if (!customizeOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || savingPreferences) return;
      setDraftRouteIds(quickAccessRouteIds);
      setSaveError(null);
      setCustomizeOpen(false);
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [customizeOpen, quickAccessRouteIds, savingPreferences]);

  function toggleDraftRoute(routeId: DashboardRouteId) {
    setSaveError(null);

    if (draftRouteIds.includes(routeId)) {
      setDraftRouteIds(draftRouteIds.filter((candidate) => candidate !== routeId));
      return;
    }

    if (draftRouteIds.length >= 4) {
      setSaveError("You can select up to 4 quick access routes.");
      return;
    }

    setDraftRouteIds([...draftRouteIds, routeId]);
  }

  async function saveQuickAccessPreferences() {
    setSavingPreferences(true);
    setSaveError(null);
    try {
      const response = await updateDashboardPreferences(draftRouteIds);
      const normalized = normalizeQuickAccessRoutes(response.quick_access_routes);
      setQuickAccessRouteIds(normalized);
      setDraftRouteIds(normalized);
      setCustomizeOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update quick access preferences.");
    } finally {
      setSavingPreferences(false);
    }
  }

  return (
    <>
      <Head>
        <title>GTM Dashboard</title>
      </Head>

      <div className={s.layout}>
        <DashboardSidebar />
        <div className={s.main}>
          <header className={s.topbar}>
            <span className={s.breadcrumb}>Dashboard / <span>Home</span></span>
          </header>

          <div className={s.content}>
            <div className={s.homeHero}>
              <h1 className={s.homeWelcome}>Welcome,</h1>
              <p className={s.homeName}>{displayName}</p>
            </div>

            <div className={s.homeLeftColumn}>
              <section className={`${s.quickAccessSection} ${s.quickAccessWidget}`}>
                <div className={s.quickAccessHeader}>
                  <div>
                    <h2 className={s.quickAccessTitle}>Quick Access</h2>
                    <p className={s.quickAccessHint}>Choose up to 4 links for your home page shortcuts.</p>
                  </div>
                  <button
                    type="button"
                    className={s.quickAccessCustomizeBtn}
                    onClick={openCustomize}
                  >
                    <PencilLine size={14} strokeWidth={1.8} />
                    Customize
                  </button>
                </div>

                {loadingPreferences && (
                  <div className={s.stateBox}><div className={s.spinner} />Loading preferences…</div>
                )}

                {loadError && !loadingPreferences && (
                  <div className={s.stateBox} style={{ color: "var(--accent-red)", height: "auto", padding: "20px 0" }}>
                    {loadError}
                  </div>
                )}

                {!loadingPreferences && !loadError && quickAccessRoutes.length === 0 && (
                  <div className={s.quickAccessEmpty}>
                    No quick access routes selected. Click Customize to pick up to 4 routes.
                  </div>
                )}

                {!loadingPreferences && !loadError && quickAccessRoutes.length > 0 && (
                  <div className={s.quickAccessGrid}>
                    {quickAccessRoutes.map((route) => {
                      const Icon = route.icon;
                      return (
                        <Link
                          key={route.id}
                          href={route.href}
                          className={s.quickAccessCard}
                          target={route.opensInNewTab ? "_blank" : "_self"}
                          rel={route.opensInNewTab ? "noopener noreferrer" : undefined}
                        >
                          <span className={s.quickAccessCardIcon}>
                            <Icon size={18} strokeWidth={1.8} />
                          </span>
                          <span className={s.quickAccessCardLabel}>{route.label}</span>
                          <span className={s.quickAccessCardMeta}>
                            {route.group}
                            {route.opensInNewTab ? " · Opens in new tab" : ""}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>

      {customizeOpen && (
        <>
          <button
            type="button"
            className={s.quickCustomizeModalOverlay}
            aria-label="Close quick access customization"
            onClick={closeCustomize}
            disabled={savingPreferences}
          />
          <section
            className={s.quickCustomizeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-customize-title"
          >
            <div className={s.quickCustomizePanel}>
              <div className={s.quickCustomizeHeader}>
                <div>
                  <h3 id="quick-customize-title" className={s.quickCustomizeTitle}>Customize Quick Access</h3>
                  <p className={s.quickCustomizeSubtitle}>Selected {draftRouteIds.length} of 4 routes.</p>
                </div>
                <div className={s.quickCustomizeActions}>
                  <button type="button" className={s.quickCustomizeBtn} onClick={closeCustomize} disabled={savingPreferences}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${s.quickCustomizeBtn} ${s.quickCustomizeBtnPrimary}`}
                    onClick={() => void saveQuickAccessPreferences()}
                    disabled={savingPreferences}
                  >
                    {savingPreferences ? <Loader2 size={14} className={s.quickCustomizeSpinner} /> : <Check size={14} />}
                    {savingPreferences ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              {saveError && <div className={s.quickCustomizeError}>{saveError}</div>}

              <div className={s.quickCustomizeGroups}>
                {groupedSelectableRoutes.map(({ group, routes }) => (
                  <div className={s.quickCustomizeGroup} key={group}>
                    <p className={s.quickCustomizeGroupTitle}>{group}</p>
                    <div className={s.quickCustomizeRouteList}>
                      {routes.map((route) => {
                        const checked = draftRouteIds.includes(route.id);
                        const disabled = !checked && draftRouteIds.length >= 4;
                        const Icon = route.icon;
                        return (
                          <label key={route.id} className={s.quickCustomizeRouteOption}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled || savingPreferences}
                              onChange={() => toggleDraftRoute(route.id)}
                            />
                            <span className={s.quickCustomizeRouteIcon}>
                              <Icon size={15} strokeWidth={1.8} />
                            </span>
                            <span className={s.quickCustomizeRouteText}>
                              <span>{route.label}</span>
                              <span className={s.quickCustomizeRouteMeta}>
                                {route.opensInNewTab ? "External" : "Internal"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
