import { ChevronLeft, ChevronRight, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";

const PdfDocumentViewer = dynamic(
  () => import("./PdfDocumentViewer").then((module) => module.PdfDocumentViewer),
  {
    ssr: false,
    loading: () => <div className={s.documentState}>Rendering PDF...</div>,
  },
);

type DocumentModalProps = {
  document: JuliaVoiceMatch | null;
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

export function DocumentModal({
  document,
  signedUrl,
  loading,
  error,
  onClose,
}: DocumentModalProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(860);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageNumber(1);
    setPageCount(0);
  }, [signedUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 860;
      setPageWidth(Math.max(320, Math.min(width - 48, 1120)));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const goPrevious = () => setPageNumber((current) => Math.max(1, current - 1));
  const goNext = () => setPageNumber((current) => Math.min(pageCount || current, current + 1));

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!document) return null;

  return (
    <section className={s.documentModal} aria-label={`${document.title} preview`}>
      <div className={s.documentModalTopbar}>
        <div>
          <div className={s.documentModalEyebrow}>Julia document</div>
          <h1>{document.title}</h1>
        </div>
        <button type="button" className={s.documentModalClose} onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.8} />
        </button>
      </div>

      <div className={s.documentStage} ref={stageRef}>
        {loading && <div className={s.documentState}>Loading document...</div>}
        {!loading && error && <div className={s.documentError}>{error}</div>}
        {!loading && signedUrl && (
          <>
            <PdfDocumentViewer
              signedUrl={signedUrl}
              pageNumber={pageNumber}
              pageWidth={pageWidth}
              onPageCount={setPageCount}
            />
            <button
              type="button"
              className={`${s.documentNavButton} ${s.documentNavPrevious}`}
              onClick={goPrevious}
              disabled={pageNumber <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={24} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={`${s.documentNavButton} ${s.documentNavNext}`}
              onClick={goNext}
              disabled={pageNumber >= pageCount}
              aria-label="Next page"
            >
              <ChevronRight size={24} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {pageCount > 0 && (
        <div className={s.documentPageCount}>
          {pageNumber} / {pageCount}
        </div>
      )}
    </section>
  );
}
