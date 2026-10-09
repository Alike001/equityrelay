import type { Metadata } from "next";
import { SiteHeader } from "@/components/shared/site-header";
import { SystemStatus } from "@/components/status/system-status";
import { mainnetExecutionArmed } from "@/domain/execution/guard";

export const metadata: Metadata = { title: "System status | EquityRelay", description: "Read-only infrastructure and capability status without invented uptime or activity." };

export default function StatusPage() {
  const confirmations = Number(process.env.BSC_MIN_CONFIRMATIONS ?? "3");
  return <><SiteHeader inApp /><main className="wrap public-status-main"><div className="proof-stamps"><span>PUBLIC STATUS</span><span>READ-ONLY</span><span>NO WALLET DATA</span></div><h1>What is known.<br />What has not been checked.</h1><p className="proof-lead">Operational facts are separated from live route availability. No traffic, volume, uptime, user, or trade figures are inferred.</p><SystemStatus configuredExecutionArmed={mainnetExecutionArmed()} configuredConfirmations={Number.isSafeInteger(confirmations) ? confirmations : 3} configuredFinalized={process.env.BSC_REQUIRE_FINALIZED === "true"} /></main></>;
}
