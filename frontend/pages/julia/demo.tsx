import Head from "next/head";

import { DashboardSidebar } from "../../components/dashboard-sidebar";
import { DemoShell } from "../../components/Julia/Demo/DemoShell";
import { useJuliaDemo } from "../../hooks/julia/useJuliaDemo";
import dashboardStyles from "../../styles/dashboard.module.css";

export default function JuliaDemoPage() {
  const demo = useJuliaDemo();

  return (
    <>
      <Head>
        <title>Julia Demo | Diesel Dashboard</title>
      </Head>
      <div className={dashboardStyles.layout}>
        <DashboardSidebar activeRoute="julia" />
        <DemoShell
          state={demo.state}
          errorToast={demo.errorToast}
          activeMatch={demo.activeMatch}
          selectorMatches={demo.selectorMatches}
          onOrbClick={demo.handleOrbClick}
          onCloseForeground={demo.closeForeground}
          onDismissError={demo.dismissError}
        />
      </div>
    </>
  );
}
