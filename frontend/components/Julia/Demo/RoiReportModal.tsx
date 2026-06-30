import { X } from "lucide-react";
import { useEffect } from "react";

import type { JuliaROIAnalysisPayload, JuliaROIInputSource } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { RoiHonestyMarkers } from "./RoiHonestyMarkers";

type RoiReportModalProps = {
  payload: JuliaROIAnalysisPayload | null;
  onClose: () => void;
};

const INPUT_ROWS: Array<{ key: keyof JuliaROIAnalysisPayload["inputs"]; label: string; format: "count" | "percent" }> = [
  { key: "T", label: "Trucks (T)", format: "count" },
  { key: "S", label: "% Spot (S)", format: "percent" },
  { key: "P", label: "Office people (P)", format: "count" },
  { key: "Ld", label: "Loads / day (Ld)", format: "count" },
  { key: "Du", label: "% Detention uncaptured", format: "percent" },
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
            {payload.matched_pain_points.length === 0 ? (
              <p className={s.roiEmptyState}>I caught the inputs but no clear pain points were mentioned.</p>
            ) : (
              <ul className={s.roiPainList}>
                {payload.matched_pain_points.map((point) => (
                  <li key={`${point.id}-${point.evidence}`}>
                    <span className={s.roiPainLabel}>{painPointLabel(point.id)}</span>
                    <span className={s.roiPainConfidence}>{Math.round(point.confidence * 100)}%</span>
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
                    <span>{formatInputValue(input.value, row.format)}</span>
                    <span className={s.roiInputSource}>{describeSource(input.source)}</span>
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
                <span>Gross annual value</span>
                <span>{formatCurrency(payload.summary.gross_annual_value)}</span>
              </div>
              <div>
                <span>Net annual value</span>
                <span>{formatCurrency(payload.summary.net_annual_value)}</span>
              </div>
              <div className={s.roiSummaryMultiple}>
                <span>ROI multiple</span>
                <span>{payload.summary.roi_multiple.toFixed(1)}x</span>
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

function formatInputValue(value: number, mode: "count" | "percent"): string {
  if (mode === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function describeSource(source: JuliaROIInputSource): string {
  if (source === "rep") return "from rep";
  if (source === "derived") return "derived from T";
  return "default";
}

function painPointLabel(id: string): string {
  const labels: Record<string, string> = {
    spot_freight_winrate: "Spot freight win-rate",
    detention_not_billed: "Detention not getting billed",
    office_labor_high: "Office labor too high",
    voice_phone_overload: "Voice / phone work overload",
    order_entry_rekeying: "Order entry / re-keying",
    invoicing_billing_slow: "Invoicing / billing slow",
    fuel_cost_cards: "Fuel cost / fuel cards",
    asset_utilization_revenue: "Asset utilization / revenue per truck",
  };
  return labels[id] ?? id;
}
