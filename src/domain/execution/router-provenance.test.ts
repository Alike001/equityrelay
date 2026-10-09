import { describe, expect, it } from "vitest";
import {
  ROUTER_PROVENANCE_EVIDENCE,
  routerSecurityDecision,
} from "./router-provenance";

describe("router provenance security decision", () => {
  it("fails closed when authenticated API provenance lacks deployed-contract provenance", () => {
    expect(routerSecurityDecision("API_PROVENANCE_ONLY")).toBe(
      "SECURITY_REFUSED_UNVERIFIED_ROUTER",
    );
    expect(routerSecurityDecision("UNRESOLVED")).toBe(
      "SECURITY_REFUSED_UNVERIFIED_ROUTER",
    );
  });

  it("records three bounded builds with the same provider, target and spender", () => {
    const evidence = ROUTER_PROVENANCE_EVIDENCE;
    expect(evidence.classification).toBe("API_PROVENANCE_ONLY");
    expect(evidence.decision).toBe("SECURITY_REFUSED_UNVERIFIED_ROUTER");
    expect(evidence.builds).toHaveLength(3);
    expect(new Set(evidence.builds.map((build) => build.provider))).toEqual(
      new Set(["LiquidMesh"]),
    );
    expect(new Set(evidence.builds.map((build) => build.transactionTarget))).toEqual(
      new Set([evidence.router]),
    );
    expect(new Set(evidence.builds.map((build) => build.approvalSpender))).toEqual(
      new Set([evidence.router]),
    );
    expect(evidence.approvalPolicy).toBe("EXACT_BOUNDED");
  });

  it("does not represent an approval, signature or broadcast as completed", () => {
    expect(ROUTER_PROVENANCE_EVIDENCE.decisionEnforcement).toBe("RECORDED_OPERATOR_DECISION");
    expect(ROUTER_PROVENANCE_EVIDENCE.approvalReviewRequested).toBe(true);
    expect(ROUTER_PROVENANCE_EVIDENCE.approvalCancelledByUser).toBe(true);
    expect(ROUTER_PROVENANCE_EVIDENCE.approvalSigned).toBe(false);
    expect(ROUTER_PROVENANCE_EVIDENCE.transactionBroadcast).toBe(false);
    expect(ROUTER_PROVENANCE_EVIDENCE.allowanceConfirmedOnchain).toBe(false);
    expect(ROUTER_PROVENANCE_EVIDENCE.bscSourceVerified).toBe(false);
    expect(ROUTER_PROVENANCE_EVIDENCE.facetsSourceVerified).toBe(false);
  });
});
