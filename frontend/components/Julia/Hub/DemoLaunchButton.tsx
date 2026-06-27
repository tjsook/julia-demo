import { MonitorPlay } from "lucide-react";

import s from "../../../styles/julia.module.css";

export function DemoLaunchButton() {
  return (
    <a
      href="/julia/demo"
      target="_blank"
      rel="noopener noreferrer"
      className={s.secondaryButton}
    >
      <MonitorPlay size={16} strokeWidth={1.8} />
      <span>Demo</span>
    </a>
  );
}
