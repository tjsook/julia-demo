import Head from "next/head";

import { DashboardSidebar } from "../../components/dashboard-sidebar";
import dashboardStyles from "../../styles/dashboard.module.css";
import s from "../../styles/julia.module.css";

export default function JuliaDemoPage() {
  return (
    <>
      <Head>
        <title>Julia Demo | Diesel Dashboard</title>
      </Head>
      <div className={dashboardStyles.layout}>
        <DashboardSidebar activeRoute="julia" />
        <main className={s.main}>
          <section className={s.headerBand}>
            <div>
              <div className={s.eyebrow}>Julia Demo</div>
              <h1 className={s.title}>Demo coming soon</h1>
            </div>
          </section>
          <section className={s.emptyState}>
            <h2>Retrieval mode is not part of this ingestion slice.</h2>
            <p>The voice retrieval workflow will consume active documents from this hub.</p>
          </section>
        </main>
      </div>
    </>
  );
}
