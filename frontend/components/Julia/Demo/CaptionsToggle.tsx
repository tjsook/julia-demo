import { Captions, CaptionsOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import s from "../../../styles/julia.module.css";

const STORAGE_KEY = "julia:captions";

export function useCaptionsEnabled(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    setEnabled(persisted === "true");
  }, []);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
      return next;
    });
  }, []);

  return [enabled, toggle];
}

type CaptionsToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

export function CaptionsToggle({ enabled, onToggle }: CaptionsToggleProps) {
  return (
    <button
      type="button"
      className={s.captionsToggle}
      onClick={onToggle}
      aria-label={enabled ? "Turn captions off" : "Turn captions on"}
      title="Toggle captions for spoken prompts"
    >
      {enabled ? <Captions size={16} strokeWidth={1.9} /> : <CaptionsOff size={16} strokeWidth={1.9} />}
    </button>
  );
}
