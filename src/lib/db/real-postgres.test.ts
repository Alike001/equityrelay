import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/execution/lost-hash", () => ({ findReservedTransaction: async () => ({ status: "UNRESOLVED", reason: "NO_MATCH" }) }));
import { consumeChallengeRate } from "@/lib/auth/rate-limit";
import { createConfirmationIntent } from "@/domain/execution/confirmation";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { abandonReservation, createExecutionStep, getExecutionRoute, reserveConfirmation } from "@/lib/execution/repository";

const url = process.env.EQUITYRELAY_TEST_DATABASE_URL;
const wallet = "0x1111111111111111111111111111111111111111";
describe.skipIf(!url)("real PostgreSQL deployment rehearsal", () => {
  it("survives a new connection and enforces replay, rollback, uniqueness and route version races", async () => {
    const pool = new pg.Pool({ connectionString: url!, max: 3 });
    const routeId = randomUUID(), challenge = randomUUID(), session = randomUUID(), token = randomUUID();
    const step1 = randomUUID(), step2 = randomUUID(), txHash = `0x${randomUUID().replaceAll("-", "").padEnd(64, "a")}`;
    const settlementHash = `0x${randomUUID().replaceAll("-", "").padEnd(64, "b")}`;
    try {
      await pool.query(`INSERT INTO auth_challenges(nonce_hash,wallet,chain_id,domain,uri,message,issued_at,expires_at)
        VALUES($1,$2,56,'localhost:3000','http://localhost:3000','rehearsal',now(),now()+interval '5 minutes')`, [challenge,wallet]);
      await pool.query("INSERT INTO auth_sessions(session_hash,wallet,chain_id,expires_at) VALUES($1,$2,56,now()+interval '8 hours')", [session,wallet]);
      await pool.query(`INSERT INTO execution_routes(route_id,wallet,chain_id,original_intent,original_source_raw,max_exposure_loss_bps,lifecycle_state,session_snapshot)
        VALUES($1,$2,56,'{}',500,50,'LEG1_REVIEW','{}')`, [routeId,wallet]);
      await pool.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt,tx_hash)
        VALUES($1,$2,'LEG1_APPROVAL','APPROVAL','hash','{}','REVIEW_READY',1,$3)`, [step1,routeId,txHash]);
      await pool.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
        VALUES($1,$2,$3,$4,'LEG1_APPROVAL','hash',0,'click',now()+interval '2 minutes')`, [randomUUID(),token,routeId,wallet]);
      await pool.query(`INSERT INTO settlement_evidence(evidence_id,route_id,stage,tx_hash,block_number,block_hash,token_in,token_out,
        amount_in_raw,amount_out_raw,log_references,evidence_source,confirmed_at)
        VALUES($1,$2,'LEG1_SWAP',$3,123,'0xblock','0xsource','0xtarget',500,1000,'{}','TEST_FIXTURE',now())`, [randomUUID(),routeId,settlementHash]);
      await pool.query("INSERT INTO execution_receipts(route_id,status,payload_v1,receipt_hash) VALUES($1,'PENDING','{}','test-pending')", [routeId]);
      const consumed = await pool.query("UPDATE auth_challenges SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL RETURNING nonce_hash", [challenge]);
      expect(consumed.rowCount).toBe(1);
      expect((await pool.query("UPDATE auth_challenges SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL RETURNING nonce_hash", [challenge])).rowCount).toBe(0);
      expect((await pool.query("UPDATE confirmation_intents SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL RETURNING intent_id", [token])).rowCount).toBe(1);
      expect((await pool.query("UPDATE confirmation_intents SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL RETURNING intent_id", [token])).rowCount).toBe(0);
      await expect(pool.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
        VALUES($1,$2,$3,$4,'LEG1_APPROVAL','hash',0,'click',now()+interval '2 minutes')`, [randomUUID(),randomUUID(),routeId,wallet])).rejects.toThrow();
      await expect(pool.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt,tx_hash)
        VALUES($1,$2,'LEG1_SWAP','SWAP','hash2','{}','PENDING',1,$3)`, [step2,routeId,txHash])).rejects.toThrow();
      await expect(pool.query(`INSERT INTO settlement_evidence(evidence_id,route_id,stage,tx_hash,block_number,block_hash,token_in,token_out,
        amount_in_raw,amount_out_raw,log_references,evidence_source,confirmed_at)
        VALUES($1,$2,'LEG2_SWAP',$3,124,'0xblock','0xsource','0xtarget',500,1000,'{}','TEST_FIXTURE',now())`, [randomUUID(),routeId,settlementHash])).rejects.toThrow();
      const rateClient = await pool.connect();
      try {
        await rateClient.query("BEGIN");
        const key = `test:${randomUUID()}`;
        await consumeChallengeRate(rateClient, [{ key, limit: 1 }]);
        await rateClient.query("COMMIT");
        await rateClient.query("BEGIN");
        await expect(consumeChallengeRate(rateClient, [{ key, limit: 1 }])).rejects.toThrow("AUTH_RATE_LIMITED");
        await rateClient.query("ROLLBACK");
      } finally { rateClient.release(); }
      const [a,b] = await Promise.all([0,1].map(() => pool.query("UPDATE execution_routes SET version=version+1 WHERE route_id=$1 AND version=0 RETURNING version", [routeId])));
      expect(a.rowCount! + b.rowCount!).toBe(1);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE execution_routes SET lifecycle_state='FAILED' WHERE route_id=$1", [routeId]);
        await client.query("ROLLBACK");
      } finally { client.release(); }
      await pool.end();
      const restarted = new pg.Client({ connectionString: url! });
      try {
        await restarted.connect();
        const result = await restarted.query(`SELECT r.version,r.lifecycle_state,s.session_hash,c.consumed_at,
          i.used_at,e.amount_out_raw::text,p.status AS receipt_status FROM execution_routes r CROSS JOIN auth_sessions s CROSS JOIN auth_challenges c
          CROSS JOIN confirmation_intents i JOIN settlement_evidence e ON e.route_id=r.route_id JOIN execution_receipts p ON p.route_id=r.route_id
          WHERE r.route_id=$1 AND s.session_hash=$2 AND c.nonce_hash=$3 AND i.token_hash=$4`, [routeId,session,challenge,token]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ lifecycle_state: "LEG1_REVIEW", session_hash: session });
        expect(result.rows[0].version).toBe("1");
        expect(result.rows[0].consumed_at).toBeTruthy();
        expect(result.rows[0].used_at).toBeTruthy();
        expect(result.rows[0].amount_out_raw).toBe("1000");
        expect(result.rows[0].receipt_status).toBe("PENDING");
      } finally { await restarted.end(); }
    } finally {
      const cleanup = new pg.Client({ connectionString: url! });
      await cleanup.connect();
      try {
        await cleanup.query("DELETE FROM confirmation_intents WHERE route_id=$1", [routeId]);
        await cleanup.query("DELETE FROM execution_receipts WHERE route_id=$1", [routeId]);
        await cleanup.query("DELETE FROM settlement_evidence WHERE route_id=$1", [routeId]);
        await cleanup.query("DELETE FROM execution_steps WHERE route_id=$1", [routeId]);
        await cleanup.query("DELETE FROM execution_routes WHERE route_id=$1", [routeId]);
        await cleanup.query("DELETE FROM auth_sessions WHERE session_hash=$1", [session]);
        await cleanup.query("DELETE FROM auth_challenges WHERE nonce_hash=$1", [challenge]);
      } finally { await cleanup.end(); await pool.end().catch(() => {}); }
    }
  }, 30_000);
  it("lets one tab reserve, then expires the prompt and requires a new action/version/token", async () => {
    process.env.DATABASE_URL = url!;
    const db = new pg.Client({ connectionString: url! });
    const routeId = randomUUID(), tokenId = randomUUID();
    const action: ExecutionActionV1 = { version: "ExecutionActionV1", routeId, stage: "LEG1_SWAP", kind: "SWAP", chainId: 56,
      from: wallet, to: "0x2222222222222222222222222222222222222222", data: "0x12345678", valueWei: "0",
      tokenIn: "0xa9ee28c80f960b889dfbd1902055218cba016f75", tokenOut: "0x55d398326f99059ff775485246999027b3197955",
      amountInRaw: "500", approvalSpender: null, approvalAmountRaw: null, planIdentity: "fixture-quote", planRevision: randomUUID() };
    const session = { id: routeId, owner: wallet, stage: "LEG1_REVIEW", originalSourceRaw: "500", initialQuote: { quoteId: "fixture-quote" },
      reviews: { LEAVE_ONDO: { allowanceSufficient: true } }, confirmations: [], events: [] };
    const actionHash = executionActionHash(action);
    const { intent, token: walletToken } = createConfirmationIntent({ routeId, wallet, stage: "LEG1_SWAP", actionHash, routeVersion: 0,
      idempotencyKey: "tab-a", expiresAt: new Date(Date.now() + 120_000).toISOString() });
    try {
      await db.connect();
      await db.query(`INSERT INTO execution_routes(route_id,wallet,chain_id,original_intent,original_source_raw,max_exposure_loss_bps,lifecycle_state,session_snapshot)
        VALUES($1,$2,56,'{}',500,50,'LEG1_REVIEW',$3)`, [routeId,wallet,JSON.stringify(session)]);
      await db.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt)
        VALUES($1,$2,'LEG1_SWAP','SWAP',$3,$4,'REVIEW_READY',1)`, [tokenId,routeId,actionHash,JSON.stringify(action)]);
      await db.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
        VALUES($1,$2,$3,$4,'LEG1_SWAP',$5,0,'tab-a',now()+interval '2 minutes')`, [intent.id,intent.tokenHash,routeId,wallet,actionHash]);
      const attempts = await Promise.allSettled([0,1].map(() => reserveConfirmation({ routeId,wallet,stage: "LEG1_SWAP",token: walletToken,actionHash,routeVersion: 0 })));
      expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
      await expect(reserveConfirmation({ routeId,wallet,stage: "LEG1_SWAP",token: walletToken,actionHash,routeVersion: 0 })).rejects.toThrow();
      process.env.EQUITYRELAY_MAINNET_EXECUTION = "true";
      await expect(abandonReservation(routeId,wallet,"LEG1_SWAP","USER_REJECTED")).rejects.toThrow("RESERVATION_REQUIRES_MANUAL_REVIEW");
      process.env.EQUITYRELAY_MAINNET_EXECUTION = "false";
      await expect(abandonReservation(routeId,wallet,"LEG1_SWAP","USER_REJECTED")).rejects.toThrow("RESERVATION_NOT_ABANDONABLE");
      await db.query("UPDATE execution_steps SET reserved_at=now()-interval '3 minutes' WHERE step_id=$1", [tokenId]);
      await abandonReservation(routeId,wallet,"LEG1_SWAP","RESERVATION_EXPIRED");
      const route = await getExecutionRoute(routeId,wallet);
      expect(route?.version).toBe(2);
      expect(route?.session.confirmations).toEqual([]);
      const fresh = await createExecutionStep(routeId,wallet,2,action);
      expect(fresh.actionHash).not.toBe(actionHash);
      expect(fresh.action.planRevision).not.toBe(action.planRevision);
      expect((await db.query("SELECT used_at FROM confirmation_intents WHERE intent_id=$1", [intent.id])).rows[0].used_at).toBeTruthy();
    } finally {
      await db.query("DELETE FROM confirmation_intents WHERE route_id=$1", [routeId]).catch(() => {});
      await db.query("DELETE FROM execution_steps WHERE route_id=$1", [routeId]).catch(() => {});
      await db.query("DELETE FROM execution_routes WHERE route_id=$1", [routeId]).catch(() => {});
      await db.end().catch(() => {});
      delete process.env.DATABASE_URL;
      delete process.env.EQUITYRELAY_MAINNET_EXECUTION;
    }
  }, 30_000);
});
