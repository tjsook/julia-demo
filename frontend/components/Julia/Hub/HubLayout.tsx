import { FilePlus2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import type { JuliaDocumentStatus } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { DemoLaunchButton } from "./DemoLaunchButton";

type HubLayoutProps = {
  status: JuliaDocumentStatus;
  loading: boolean;
  error: string | null;
  children: ReactNode;
  onStatusChange: (status: JuliaDocumentStatus) => void;
  onOpenUpload: () => void;
  onRefresh: () => void;
};

const filters: Array<{ label: string; value: JuliaDocumentStatus }> = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

export function HubLayout({
  status,
  loading,
  error,
  children,
  onStatusChange,
  onOpenUpload,
  onRefresh,
}: HubLayoutProps) {
  return (
    <main className={s.main}>
      <section className={s.headerBand}>
        <div>
          <div className={s.eyebrow}>Documents // ROI Analysis</div>
          <h1 className={s.title}>Julia</h1>
        </div>
        <div className={s.headerActions}>
          <DemoLaunchButton />
          <button
            type="button"
            className={s.secondaryButton}
            onClick={onRefresh}
          >
            <RefreshCw size={16} strokeWidth={1.8} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className={s.primaryButton}
            onClick={onOpenUpload}
          >
            <FilePlus2 size={16} strokeWidth={1.8} />
            <span>Upload</span>
          </button>
        </div>
      </section>

      <section className={s.toolbarBand}>
        <div
          className={s.segmented}
          role="tablist"
          aria-label="Document status"
        >
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={status === filter.value ? s.segmentActive : s.segment}
              onClick={() => onStatusChange(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {loading && <span className={s.statusText}>Loading documents...</span>}
        {!loading && error && <span className={s.errorText}>{error}</span>}
      </section>

      {children}
    </main>
  );
}
