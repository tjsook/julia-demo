import { X } from "lucide-react";
import { useEffect } from "react";

import {
  SUB_SHARE_PARENT,
  type JuliaROIAnalysisPayload,
  type JuliaROIInputSource,
  type JuliaROIPainPointMatch,
} from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { RoiHonestyMarkers } from "./RoiHonestyMarkers";

type RoiReportModalProps = {
  payload: JuliaROIAnalysisPayload | null;
  onClose: () => void;
};

const INPUT_ROWS: Array<{
  key: keyof JuliaROIAnalysisPayload["inputs"];
  label: string;
  format: "count" | "percent" | "currency" | "decimal";
}> = [
  { key: "T", label: "Trucks (T)", format: "count" },
  { key: "S", label: "% Spot (S)", format: "percent" },
  { key: "P", label: "Office people (P)", format: "count" },
  { key: "Ld", label: "Loads / day (Ld)", format: "count" },
  { key: "Du", label: "% Detention uncaptured", format: "percent" },
  { key: "R", label: "Revenue / load (R)", format: "currency" },
  { key: "minutes_per_order", label: "Minutes / order entry", format: "decimal" },
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

  return (
    <section className={s.roiModal} aria-label={title}>
      <div className={s.roiPanel}>
        <div className={s.roiTopbar}>
          <div>
            <div className={s.roiEyebrow}>Julia report</div>
            <h1>{title}</h1>
          </div>
          <button type="button" className={s.documentModalClose} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className={s.roiBody}>
          <section className={s.roiSection}>
            <h2>Pain points detected</h2>
            {painRows.length === 0 ? (
              <p className={s.roiEmptyState}>I caught the inputs but no clear pain points were mentioned.</p>
            ) : (
              <ul className={s.roiPainList}>
                {painRows.map((row) => (
                  <li key={row.key}>
                    <span className={row.isSubShare ? s.roiPainSubLabel : s.roiPainLabel}>
                      {row.isSubShare ? "↳ " : ""}
                      {painPointLabel(row.id)}
                    </span>
                    <span className={s.roiPainConfidence}>{Math.round(row.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={s.roiSection}>
            <h2>Inputs</h2>
            <ul className={s.roiInputList}>
              {INPUT_ROWS.map((row) => {
                const input = payload.inputs[row.key];
                return (
                  <li key={row.key}>
                    <span>{row.label}</span>
                    <span>{input ? formatInputValue(input.value, row.format) : "—"}</span>
                    <span className={s.roiInputSource}>{describeSource(input?.source)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={s.roiSection}>
            <h2>Annual value drivers</h2>
            {payload.equations.length === 0 ? (
              <p className={s.roiEmptyState}>No equations selected because no pain points passed thresholds.</p>
            ) : (
              <ul className={s.roiValueList}>
                {payload.equations.map((equation) => (
                  <li key={equation.id}>
                    <span>{equation.label}</span>
                    <span>{formatCurrency(equation.result)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={s.roiSummary}>
              <div>
                <span>Annual value</span>
                <span>{formatCurrency(payload.summary.annual_value)}</span>
              </div>
            </div>
          </section>

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

function formatInputValue(value: number, mode: "count" | "percent" | "currency" | "decimal"): string {
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
