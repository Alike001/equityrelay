import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrations = ["001_execution.sql", "002_reservation_time.sql", "003_auth_rate_limit.sql"].map(file => join(process.cwd(), "db/migrations", file));
const routeId = "11111111-1111-4111-8111-111111111111";
const wallet = "0x1111111111111111111111111111111111111111";
describe("PostgreSQL durable schema", () => {
  it("survives restart and enforces single-use hashes, active steps, tx hashes, and version CAS", async () => {
    const directory = await mkdtemp(join(tmpdir(), "equityrelay-db-"));
    try {
      let db = new PGlite(directory);
      for (const migration of migrations) await db.exec(await readFile(migration, "utf8"));
      await db.query(`INSERT INTO execution_routes(route_id,wallet,chain_id,original_intent,original_source_raw,max_exposure_loss_bps,lifecycle_state,session_snapshot)
        VALUES ($1,$2,56,'{}',500,50,'LEG1_REVIEW','{}')`, [routeId,wallet]);
      await db.query(`INSERT INTO auth_challenges(nonce_hash,wallet,chain_id,domain,uri,message,issued_at,expires_at)
        VALUES ('noncehash',$1,56,'localhost:3000','http://localhost:3000','challenge',now(),now()+interval '5 minutes')`, [wallet]);
      await expect(db.query(`INSERT INTO auth_challenges(nonce_hash,wallet,chain_id,domain,uri,message,issued_at,expires_at)
        VALUES ('noncehash',$1,56,'localhost:3000','http://localhost:3000','challenge',now(),now()+interval '5 minutes')`, [wallet])).rejects.toThrow();
      await db.query(`INSERT INTO auth_sessions(session_hash,wallet,chain_id,expires_at) VALUES('sessionhash',$1,56,now()+interval '8 hours')`, [wallet]);
      await db.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt,tx_hash)
        VALUES('33333333-3333-4333-8333-333333333333',$1,'LEG1_APPROVAL','APPROVAL','hash-1','{}','REVIEW_READY',1,$2)`, [routeId, `0x${"a".repeat(64)}`]);
      await expect(db.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt)
        VALUES('44444444-4444-4444-8444-444444444444',$1,'LEG1_APPROVAL','APPROVAL','hash-2','{}','REVIEW_READY',2)`, [routeId])).rejects.toThrow();
      await expect(db.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt,tx_hash)
        VALUES('55555555-5555-4555-8555-555555555555',$1,'LEG1_SWAP','SWAP','hash-3','{}','PENDING',1,$2)`, [routeId, `0x${"a".repeat(64)}`])).rejects.toThrow();
      await db.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
        VALUES('22222222-2222-4222-8222-222222222222','tokenhash',$1,$2,'LEG1_APPROVAL','actionhash',0,'click-1',now()+interval '2 minutes')`, [routeId,wallet]);
      const [firstUse, secondUse] = await Promise.all([0, 1].map(() => db.query(`UPDATE confirmation_intents SET used_at=now()
        WHERE token_hash='tokenhash' AND used_at IS NULL AND expires_at>now() RETURNING intent_id`)));
      expect(firstUse.rows.length + secondUse.rows.length).toBe(1);
      await expect(db.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
        VALUES('66666666-6666-4666-8666-666666666666','tokenhash',$1,$2,'LEG1_SWAP','actionhash',0,'click-2',now()+interval '2 minutes')`, [routeId,wallet])).rejects.toThrow();
      const [firstTab, secondTab] = await Promise.all([0, 1].map(() => db.query(`UPDATE execution_routes SET version=version+1
        WHERE route_id=$1 AND version=0 RETURNING version`, [routeId])));
      expect(firstTab.rows.length + secondTab.rows.length).toBe(1);
      await db.query("UPDATE execution_steps SET status='AWAITING_WALLET_TX',tx_hash=NULL,reserved_at=now() WHERE route_id=$1 AND stage='LEG1_APPROVAL'", [routeId]);
      const early = await db.query(`UPDATE execution_steps SET status='RESERVATION_EXPIRED' WHERE route_id=$1
        AND status='AWAITING_WALLET_TX' AND reserved_at<now()-interval '2 minutes' RETURNING step_id`, [routeId]);
      expect(early.rows).toHaveLength(0);
      await db.query("UPDATE execution_steps SET reserved_at=now()-interval '3 minutes' WHERE route_id=$1 AND stage='LEG1_APPROVAL'", [routeId]);
      const expired = await db.query(`UPDATE execution_steps SET status='RESERVATION_EXPIRED' WHERE route_id=$1
        AND status='AWAITING_WALLET_TX' AND reserved_at<now()-interval '2 minutes' RETURNING step_id`, [routeId]);
      expect(expired.rows).toHaveLength(1);
      await db.close();
      db = new PGlite(directory);
      const restored = await db.query<{ version: string; used_at: Date }>(`SELECT version,used_at FROM execution_routes r JOIN confirmation_intents c ON c.route_id=r.route_id WHERE r.route_id=$1`, [routeId]);
      expect(restored.rows).toHaveLength(1);
      expect(restored.rows[0].used_at).not.toBeNull();
      await db.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
});
