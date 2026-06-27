import s from "../../../styles/julia.module.css";
import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";

type JuliaOrbProps = {
  state: JuliaDemoState;
  onClick: () => void;
};

export function JuliaOrb({ state, onClick }: JuliaOrbProps) {
  const className = [
    s.juliaOrb,
    state === "listening" ? s.juliaOrbListening : "",
    state === "processing" ? s.juliaOrbProcessing : "",
    state === "showing-document" || state === "showing-selector" ? s.juliaOrbDimmed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={state === "listening" ? "Stop listening" : "Start listening"}
      disabled={state === "processing" || state === "showing-document" || state === "showing-selector"}
    />
  );
}
