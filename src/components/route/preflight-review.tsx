"use client";

import type { PreflightAction, PreflightResult, PreflightStage, RoutePreflight } from "@/types/preflight";

function shortNumber(value: string | null): string {
  if (value === null) return "—";
  const [whole, fraction] = value.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 8).replace(/0+$/, "") || "0"}` : whole;
}

function actionTitle(action: PreflightAction): string {
  if (action.kind === "APPROVAL") return action.approvalExceedsInput ? `Broad ${action.tokenInLabel} approval requested` : `Approve ${action.tokenInLabel}`;
  if (action.kind === "RFQ") return `Review ${action.tokenInLabel} RFQ signing request`;
  if (action.kind === "DEPOSIT") return `Supply ${action.tokenInLabel} to Venus`;
  return `${action.tokenInLabel} → ${action.tokenOutLabel ?? "destination"}`;
}

function ActionRow({ action }: { action: PreflightAction }) {
  return <div className={`preflight-action ${action.approvalExceedsInput ? "wide-approval" : ""}`}>
    <div className="preflight-action-head"><span className="action-kind">{action.kind}</span><strong>{actionTitle(action)}</strong></div>
    {action.kind === "APPROVAL" ? <p>{action.approvalExceedsInput ? "Allowance exceeds this indicative amount; preflight is blocked." : `Requested allowance: ${action.amountInHuman === null ? `${action.amountInRaw} raw units` : shortNumber(action.amountInHuman)} ${action.tokenInLabel}.`}</p>
      : action.kind === "RFQ" ? <p>This is an EIP-712 signing path. There is no EVM swap transaction to simulate or submit here.</p>
      : <p>{action.amountInHuman ? `${shortNumber(action.amountInHuman)} ${action.tokenInLabel}` : `${action.amountInRaw} raw ${action.tokenInLabel} units`}{action.kind === "SWAP" && action.minAmountOutRaw ? ` · Minimum receive: ${action.minAmountOutHuman ? `${shortNumber(action.minAmountOutHuman)} ${action.tokenOutLabel}` : `${action.minAmountOutRaw} raw ${action.tokenOutLabel} units`}` : ""}</p>}
    <details className="transaction-details"><summary>Inspect transaction details</summary><dl>
      <div><dt>Target returned by Binance</dt><dd>{action.to ?? "RFQ typed data; no EVM target"}</dd></div>
      <div><dt>Sender</dt><dd>{action.from}</dd></div>
      <div><dt>Calldata / signing summary</dt><dd>{action.calldataSummary}</dd></div>
      {action.rawCalldata && <div className="full-detail"><dt>Exact unsigned calldata</dt><dd>{action.rawCalldata}</dd></div>}
      <div><dt>Native BNB value</dt><dd>{action.valueWei === null ? "Not an EVM transaction" : `${action.valueWei} wei`}</dd></div>
      {action.approvalSpender && <div><dt>Approval spender</dt><dd>{action.approvalSpender}</dd></div>}
      {action.approvalAmountRaw && <div><dt>Exact approval amount · raw units</dt><dd>{action.approvalAmountRaw}</dd></div>}
      {action.minAmountOutRaw && <div><dt>Minimum receive · raw units</dt><dd>{action.minAmountOutRaw}</dd></div>}
      {action.slippagePercent && <div><dt>Binance returned slippage</dt><dd>{action.slippagePercent}%</dd></div>}
      {action.gasLimit && <div><dt>Gas limit</dt><dd>{action.gasLimit}</dd></div>}
      {action.gasPrice && <div><dt>Gas price</dt><dd>{action.gasPrice}</dd></div>}
      {action.maxFeePerGas && <div><dt>Max fee per gas</dt><dd>{action.maxFeePerGas}</dd></div>}
      {action.maxPriorityFeePerGas && <div><dt>Priority fee per gas</dt><dd>{action.maxPriorityFeePerGas}</dd></div>}
    </dl></details>
  </div>;
}

function Stage({ number, stage }: { number: string; stage: PreflightStage }) {
  const simulation = stage.actions.find(action => action.kind === "SWAP" || action.kind === "RFQ" || action.kind === "DEPOSIT")?.simulation;
  return <article className="preflight-stage"><div className="preflight-stage-head"><span className="stage-number">{number}</span><div><h3>{stage.label}</h3>{stage.indicative && <small>INDICATIVE · MUST BE REFRESHED LATER</small>}</div><strong className={`build-tag ${stage.buildStatus.toLowerCase()}`}>BUILD {stage.buildStatus}</strong></div>
    <div className="simulation-line"><span>BINANCE SIMULATION</span><strong className={`simulation-status ${stage.simulationStatus.toLowerCase()}`}>{stage.simulationStatus.replaceAll("_", " ")}</strong></div>
    {stage.reason && <p className="stage-reason">{stage.reason}</p>}
    {stage.actions.length ? <div className="preflight-actions">{stage.actions.map((action, index) => <ActionRow key={`${action.kind}-${index}`} action={action} />)}</div> : <p className="stage-no-actions">No validated unsigned action is available for this stage.</p>}
    {simulation && (simulation.balanceChanges.length > 0 || simulation.allowanceChanges.length > 0) && <details className="simulation-evidence"><summary>Inspect simulation changes returned by Binance</summary>
      {simulation.balanceChanges.map((change, index) => <p key={`balance-${index}`}>Balance · {change.tokenAddress} · {change.change}</p>)}
      {simulation.allowanceChanges.map((change, index) => <p key={`allowance-${index}`}>Allowance · {change.tokenAddress} · {change.before} → {change.after}</p>)}
    </details>}
    {stage.previewDetails && <div className="stage-preview-details">
      {stage.previewDetails.estimatedNetworkFee && <span>Estimated network fee: {stage.previewDetails.estimatedNetworkFee}</span>}
      {stage.previewDetails.healthFactorBefore && <span>Health factor: {stage.previewDetails.healthFactorBefore} → {stage.previewDetails.healthFactorAfter ?? "unavailable"}</span>}
      {stage.previewDetails.balanceChanges.map((x, i) => <span key={i}>{x.tokenSymbol} balance change: {x.amount}{x.valueUsd ? ` · ${x.valueUsd} USD` : ""}</span>)}
      {stage.actions[0]?.simulation.warnings.map((warning, i) => <span key={`warning-${i}`}>Warning: {warning}</span>)}
    </div>}
  </article>;
}

function FullReview({ data }: { data: RoutePreflight }) {
  const approvals = [data.leg1, data.leg2Indicative, data.venusDepositIndicative].flatMap(stage => stage.actions).filter(action => action.kind === "APPROVAL");
  return <section className="preflight-review" id="preflight-review" aria-live="polite"><div className="preflight-review-head"><div><div className="eyebrow">READ-ONLY PREFLIGHT · BNB CHAIN</div><h2>NVIDIA → Venus</h2><p>Exact unsigned actions returned by Binance for this quote. Nothing has been signed or submitted.</p></div><span className={`overall-tag ${data.overallPreflightState.toLowerCase()}`}>{data.overallPreflightState.replaceAll("_", " ")}</span></div>
    <div className="preflight-summary"><div><small>ROUTE POLICY</small><strong className="good">{data.routePolicy}</strong></div><div><small>PROJECTED RETENTION</small><strong>{shortNumber(data.routePreview.retentionPercent)}%</strong></div><div><small>APPROVALS REQUESTED</small><strong>{approvals.length} unsigned</strong></div></div>
    <Stage number="01" stage={data.leg1} /><Stage number="02" stage={data.leg2Indicative} /><Stage number="03" stage={data.venusDepositIndicative} />
    <div className="safety-summary"><div className="eyebrow">SAFETY SUMMARY</div><h3>What the evidence says</h3><ul>{data.safetyWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><p>Route-policy PASS is separate from transaction-build and simulation results. This review is read-only and does not authorize execution.</p></div>
    <div className="preflight-finish">READ-ONLY PREFLIGHT <span>·</span> NOTHING HAS BEEN SIGNED OR SUBMITTED</div>
  </section>;
}

export function PreflightReview({ result }: { result: PreflightResult }) {
  if (result.kind === "preflight") return <FullReview data={result} />;
  return <section className="preflight-review refusal" id="preflight-review" role="status"><div className="eyebrow">READ-ONLY PREFLIGHT</div><h2>Preflight stopped</h2><p>The live route was rechecked and is now {result.routePolicy}. No transaction was submitted.</p><strong>{result.reason}</strong></section>;
}
