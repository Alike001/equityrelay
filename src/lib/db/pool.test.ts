import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { executionPool } from "./pool";

describe("durable execution prerequisite", () => {
  it("fails explicitly when DATABASE_URL is absent", () => {
    const old = process.env.DATABASE_URL;
    try { delete process.env.DATABASE_URL; expect(() => executionPool()).toThrow("EXECUTION_DATABASE_UNAVAILABLE"); }
    finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; }
  });
});
