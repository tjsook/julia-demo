import Head from "next/head";

import { DemoShell } from "../../components/Julia/Demo/DemoShell";
import { JuliaDebugPanel } from "../../components/Julia/Demo/JuliaDebugPanel";
import { useJuliaDemo } from "../../hooks/julia/useJuliaDemo";
import { BRAND } from "../../lib/brand";

export default function JuliaDemoPage() {
  const demo = useJuliaDemo();
  const pageTitle = BRAND.name ? `${BRAND.productName} | ${BRAND.name}` : BRAND.productName;

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <DemoShell
        state={demo.state}
        errorToast={demo.errorToast}
        roiPayload={demo.roiPayload}
        roiPendingDetail={demo.roiPendingDetail}
        micAmplitudeRef={demo.micAmplitudeRef}
        isStartupLocked={demo.isStartupLocked}
        terminalRecognizedLines={demo.terminalRecognizedLines}
        terminalCancelMessage={demo.terminalCancelMessage}
        currentQuestionText={demo.currentQuestionText}
        activeSubtitleText={demo.activeSubtitleText}
        showProcessingSplash={demo.showProcessingSplash}
        processingSplashLine={demo.processingSplashLine}
        roiProgressStep={demo.roiProgressStep}
        requiredNumericCount={demo.requiredNumericCount}
        collectedNumericCount={demo.collectedNumericCount}
        onOrbClick={demo.handleOrbClick}
        onCloseForeground={demo.closeForeground}
        onDismissError={demo.dismissError}
        onDismissRoiPending={demo.dismissRoiPending}
      />
      <JuliaDebugPanel
        transcript={demo.debugTranscript}
        stopReason={demo.debugStopReason}
        audioSizeMb={demo.debugAudioSizeMb}
        durationSeconds={demo.debugDurationSeconds}
        recording={demo.debugRecording}
        stageTranscripts={demo.debugStageTranscripts}
        currentQuestionText={demo.currentQuestionText}
        startupTimingMarks={demo.startupTimingMarks}
      />
    </>
  );
}
