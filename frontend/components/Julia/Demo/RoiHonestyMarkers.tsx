import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import s from "../../../styles/julia.module.css";

type RoiHonestyMarkersProps = {
  markers: string[];
};

export function RoiHonestyMarkers({ markers }: RoiHonestyMarkersProps) {
  const [expanded, setExpanded] = useState(false);

  if (markers.length === 0) return null;

  return (
    <section className={s.roiHonestySection} aria-label="Honesty markers">
      <button
        type="button"
        className={s.roiHonestyToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Honesty markers</span>
        {expanded ? <ChevronUp size={16} strokeWidth={1.8} /> : <ChevronDown size={16} strokeWidth={1.8} />}
      </button>
      {expanded && (
        <ul className={s.roiHonestyList}>
          {markers.map((marker) => (
            <li key={marker}>{marker}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
