import Head from "next/head";

import { DemoShell } from "../../components/Julia/Demo/DemoShell";
import { useJuliaDemo } from "../../hooks/julia/useJuliaDemo";

export default function JuliaDemoPage() {
  const demo = useJuliaDemo();

  return (
    <>
      <Head>
        <title>Julia Demo | Diesel Dashboard</title>
      </Head>
      <DemoShell
        state={demo.state}
        errorToast={demo.errorToast}
        activeMatch={demo.activeMatch}
        selectorMatches={demo.selectorMatches}
        documentUrl={demo.documentUrl}
        documentLoading={demo.documentLoading}
        documentError={demo.documentError}
        roiPayload={demo.roiPayload}
        roiPendingDetail={demo.roiPendingDetail}
        onOrbClick={demo.handleOrbClick}
        onSelectMatch={(match) => void demo.openDocument(match)}
        onCloseForeground={demo.closeForeground}
        onDismissError={demo.dismissError}
        onDismissRoiPending={demo.dismissRoiPending}
      />
    </>
  );
}
