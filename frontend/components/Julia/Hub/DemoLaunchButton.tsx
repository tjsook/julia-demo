import { useRouter } from "next/router";
import { MonitorPlay } from "lucide-react";

import s from "../../../styles/julia.module.css";

export function DemoLaunchButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className={s.secondaryButton}
      onClick={() => void router.push("/julia/demo")}
    >
      <MonitorPlay size={16} strokeWidth={1.8} />
      <span>Demo</span>
    </button>
  );
}
