import { Clock3, DollarSign, Package, Percent, Truck, Users, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";

import {
  SUB_SHARE_PARENT,
  type JuliaROIInputSymbol,
  type JuliaROIAnalysisPayload,
  type JuliaROIInputSource,
  type JuliaROIPainPointMatch,
  type JuliaROIResolvedInput,
} from "../../../lib/julia/types";
import { BRAND } from "../../../lib/brand";
import s from "../../../styles/julia.module.css";
import { RoiHonestyMarkers } from "./RoiHonestyMarkers";

type RoiReportModalProps = {
  payload: JuliaROIAnalysisPayload | null;
  onClose: () => void;
};

const INPUT_ROWS: Array<{
  key: JuliaROIInputSymbol;
  label: string;
  format: "count" | "percent" | "currency" | "decimal" | "minutes";
  icon: typeof Truck;
}> = [
  { key: "T", label: "Trucks", format: "count", icon: Truck },
  { key: "Ld", label: "Loads / day", format: "decimal", icon: Package },
  { key: "Du", label: "% Detention uncaptured", format: "percent", icon: Clock3 },
  { key: "R", label: "Revenue / load", format: "currency", icon: DollarSign },
  { key: "minutes_per_order", label: "Minutes / order entry", format: "minutes", icon: Clock3 },
  { key: "S", label: "% Spot", format: "percent", icon: Percent },
  { key: "P", label: "Office people", format: "count", icon: Users },
];

export function RoiReportModal({ payload, onClose }: RoiReportModalProps) {
  useEffect(() => {
    if (!payload) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, payload]);

  if (!payload) return null;

  const title = payload.company_name ? `${payload.company_name} — ROI Analysis` : "ROI Analysis";
  const painRows = buildPainPointRows(payload.matched_pain_points);
  const valueDrivers = [...payload.equations]
    .filter((equation) => equation.result > 0)
    .sort((left, right) => right.result - left.result);
  const populatedInputs = INPUT_ROWS
    .map((row) => {
      const input = payload.inputs[row.key];
      if (!input) return null;
      return { ...row, input };
    })
    .filter((row): row is InputRowDisplay => row !== null);

  return (
    <section className={s.roiModal} aria-label={title}>
      <div className={s.roiPanel}>
        <div className={s.roiTopbar}>
          <div className={s.roiTitleWrap}>
            {BRAND.logoUrl && (
              <img src={BRAND.logoUrl} alt={BRAND.name ? `${BRAND.name} logo` : "Brand logo"} className={s.roiLogo} />
            )}
            <div>
              <div className={s.roiEyebrow}>Julia report</div>
              <h1>{title}</h1>
            </div>
          </div>
          <button type="button" className={s.documentModalClose} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className={s.roiBody}>
          <section className={s.roiHero}>
            <div className={s.roiHeroValueBlock}>
              <div className={s.roiHeroEyebrow}>Projected annual value</div>
              <div className={s.roiHeroValue}>{formatCurrency(payload.summary.annual_value)}</div>
              <p>Net operational recovery over a 12-month period.</p>
            </div>
            <div className={s.roiHeroDrivers}>
              <div className={s.roiHeroDriversTitle}>Value drivers</div>
              {valueDrivers.length === 0 ? (
                <p className={s.roiHeroEmpty}>No positive value drivers yet.</p>
              ) : (
                <ul className={s.roiDriverList}>
                  {valueDrivers.map((equation) => (
                    <li key={equation.id}>
                      <span>{equation.label}</span>
                      <span>{formatCurrency(equation.result)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div className={s.roiLowerGrid}>
            <section className={s.roiSection}>
              <h2>Pain points detected</h2>
              {painRows.length === 0 ? (
                <p className={s.roiEmptyState}>I caught the inputs but no clear pain points were mentioned.</p>
              ) : (
                <ul className={s.roiPainList}>
                  {painRows.map((row) => {
                    const confidencePercent = Math.round(row.confidence * 100);
                    return (
                      <li key={row.key}>
                        <div className={s.roiPainRowHead}>
                          <span className={row.isSubShare ? s.roiPainSubLabel : s.roiPainLabel}>
                            {row.isSubShare ? "↳ " : ""}
                            {painPointLabel(row.id)}
                          </span>
                          <span className={s.roiPainConfidence}>{confidencePercent}%</span>
                        </div>
                        <div className={s.roiPainBarTrack}>
                          <div className={s.roiPainBarFill} style={{ width: `${Math.max(6, confidencePercent)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={s.roiSection}>
              <h2>Model inputs</h2>
              {populatedInputs.length === 0 ? (
                <p className={s.roiEmptyState}>No model inputs were captured.</p>
              ) : (
                <ul className={s.roiInputList}>
                  {populatedInputs.map((row) => (
                    <li key={row.key}>
                      <span className={s.roiInputLabel}>
                        <span className={s.roiInputIcon}>
                          <row.icon size={15} strokeWidth={1.8} />
                        </span>
                        <span>{row.label}</span>
                      </span>
                      <span>{formatInputValue(row.input.value, row.format)}</span>
                      <span className={s.roiInputSource}>{describeSource(row.input.source)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <RoiHonestyMarkers markers={payload.honesty_markers} />
        </div>
      </div>
    </section>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInputValue(
  value: number,
  mode: "count" | "percent" | "currency" | "decimal" | "minutes",
): string {
  if (mode === "minutes") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} min`;
  }
  if (mode === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  if (mode === "currency") {
    return formatCurrency(value);
  }
  if (mode === "decimal") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function describeSource(source: JuliaROIInputSource | undefined): string {
  if (!source) return "not required";
  if (source === "rep") return "from rep";
  if (source === "rep_qualitative") return "from rep phrasing";
  if (source === "user_approved_default") return "approved default";
  if (source === "derived") return "derived from T";
  return "default";
}

type InputRowDisplay = {
  key: JuliaROIInputSymbol;
  label: string;
  format: "count" | "percent" | "currency" | "decimal" | "minutes";
  icon: LucideIcon;
  input: JuliaROIResolvedInput;
};

function painPointLabel(id: string): string {
  const labels: Record<string, string> = {
    manual_load_matching: "Manual load matching",
    detention_not_billed: "Detention not getting billed",
    office_labor_high: "Office labor too high",
    phone_work_overload: "Phone work overload",
    manual_order_entry: "Manual order entry",
    invoicing_billing_slow: "Invoicing/billing slow",
    low_revenue_per_truck: "Low revenue per truck",
  };
  return labels[id] ?? id;
}

function buildPainPointRows(points: JuliaROIPainPointMatch[]): Array<{
  key: string;
  id: string;
  confidence: number;
  isSubShare: boolean;
}> {
  const topLevel: JuliaROIPainPointMatch[] = [];
  const childrenByParent = new Map<string, JuliaROIPainPointMatch[]>();

  for (const point of points) {
    const parentId = SUB_SHARE_PARENT[point.id];
    if (!parentId) {
      topLevel.push(point);
      continue;
    }
    const existing = childrenByParent.get(parentId) ?? [];
    existing.push(point);
    childrenByParent.set(parentId, existing);
  }

  const rows: Array<{ key: string; id: string; confidence: number; isSubShare: boolean }> = [];
  for (const point of topLevel) {
    rows.push({
      key: `${point.id}-${point.evidence}`,
      id: point.id,
      confidence: point.confidence,
      isSubShare: false,
    });
    const subShares = childrenByParent.get(point.id) ?? [];
    for (const subShare of subShares) {
      rows.push({
        key: `${subShare.id}-${subShare.evidence}`,
        id: subShare.id,
        confidence: subShare.confidence,
        isSubShare: true,
      });
    }
    childrenByParent.delete(point.id);
  }

  for (const orphanSubShares of childrenByParent.values()) {
    for (const subShare of orphanSubShares) {
      rows.push({
        key: `${subShare.id}-${subShare.evidence}`,
        id: subShare.id,
        confidence: subShare.confidence,
        isSubShare: false,
      });
    }
  }

  return rows;
}
