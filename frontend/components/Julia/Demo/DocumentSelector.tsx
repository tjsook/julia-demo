import { FileText, X } from "lucide-react";
import { useEffect } from "react";

import type { JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";

type DocumentSelectorProps = {
  matches: JuliaVoiceMatch[];
  onSelect: (match: JuliaVoiceMatch) => void;
  onClose: () => void;
};

export function DocumentSelector({ matches, onSelect, onClose }: DocumentSelectorProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <section className={s.selectorOverlay} aria-label="Select Julia document">
      <div className={s.selectorPanel}>
        <div className={s.selectorHeader}>
          <div>
            <div className={s.documentModalEyebrow}>Multiple matches</div>
            <h1>Select a document</h1>
          </div>
          <button type="button" className={s.documentModalClose} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className={s.selectorList}>
          {matches.map((match) => (
            <button
              key={match.id}
              type="button"
              className={s.selectorItem}
              onClick={() => onSelect(match)}
            >
              <FileText size={18} strokeWidth={1.8} />
              <span>{match.title}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
