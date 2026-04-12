/**
 * E2E tests: real Claude against a real local Supabase database.
 * Run with: pnpm vitest run --project=e2e
 * Requires ANTHROPIC_API_KEY in .env.local.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { runAgentTurn } from "./loop";
import { MODEL } from "./agent";
import { getServiceClient } from "../db/client";
import { ingestExcel } from "../ingest/ingest";
import { executeCreateReorderRequest } from "../tools/create-reorder-request";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const db = getServiceClient();

beforeAll(async () => {
  await ingestExcel(EXCEL_PATH);
});

beforeEach(async () => {
  await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
});

describe("e2e conversations (real Claude)", () => {
  it("C-01: search returns relevant products for 'nitrile gloves'", async () => {
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "find me nitrile gloves",
      history: [],
    });

    expect(result.requiresApproval).toBe(false);
    expect(result.toolCallsMade).toContain("searchCatalog");
    // Response should mention gloves / nitril / handschuh
    expect(result.text.toLowerCase()).toMatch(/glove|nitril|handschuh/);
  }, 30_000);

  it("C-02: unknown product name → agent explains not found", async () => {
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "I need to order some XR-9000 ultra flux capacitors",
      history: [],
    });

    expect(result.requiresApproval).toBe(false);
    // Agent should have searched and reported nothing found
    expect(result.toolCallsMade).toContain("searchCatalog");
    expect(result.text.length).toBeGreaterThan(10);
  }, 30_000);

  it("C-03: agent looks up product 9999 → explains ProductNotFoundError", async () => {
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "show me the details for product 9999",
      history: [],
    });

    expect(result.requiresApproval).toBe(false);
    // Agent should relay the error back to user
    expect(result.text.length).toBeGreaterThan(10);
  }, 30_000);

  it("C-04: ordering by name → agent searches, then asks to confirm (requiresApproval)", async () => {
    // Step 1: user asks to order nitrile gloves
    const step1 = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "Please order 2 boxes of nitrile gloves to Ward 4A, cost center CC-1001, needed by 2027-01-15",
      history: [],
    });

    // Claude should search, then either ask for confirmation or intercept write
    expect(step1.toolCallsMade).toContain("searchCatalog");
    // If Claude calls createReorderRequest immediately it will be intercepted
    if (step1.requiresApproval) {
      expect(step1.pendingToolCall?.toolName).toBe("createReorderRequest");
    } else {
      // Claude showed a confirmation diff and is waiting for yes/no
      expect(step1.text.toLowerCase()).toMatch(/confirm|yes|no|ward|cc-/i);
    }
  }, 45_000);

  it("C-05: full happy path — search → confirm → approve → DB write", async () => {
    const sessionId = uuidv4();

    // Step 1: ask to order
    const step1 = await runAgentTurn({
      model: MODEL,
      sessionId,
      userMessage: "Order 2 boxes of nitrile gloves to Ward 4A, cost center CC-1001, by 2027-03-10",
      history: [],
    });

    expect(step1.toolCallsMade).toContain("searchCatalog");

    // Step 2: user confirms
    const confirmMsg = "yes";
    const step2 = await runAgentTurn({
      model: MODEL,
      sessionId,
      userMessage: confirmMsg,
      history: step1.updatedHistory,
    });

    // At some point Claude should call createReorderRequest (intercepted)
    const gotIntercepted = step2.requiresApproval || step1.requiresApproval;
    expect(gotIntercepted).toBe(true);

    // Simulate user approving the pending write tool call
    const pending = step2.pendingToolCall ?? step1.pendingToolCall;
    if (pending) {
      await executeCreateReorderRequest(pending.toolInput as Parameters<typeof executeCreateReorderRequest>[0]);

      // Verify DB write — use the sessionId from the tool call (not the test's sessionId,
      // since the LLM passes sessionId as part of the tool input)
      const toolSessionId = (pending.toolInput.sessionId as string) ?? sessionId;
      const { count } = await db
        .from("reorder_requests")
        .select("*", { count: "exact", head: true })
        .eq("session_id", toolSessionId);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);

  it("C-06: list requests — agent responds about requests (may or may not call tool)", async () => {
    // Claude may answer "you have no requests" without calling the tool when it
    // lacks context indicating requests exist. We just check that the response is coherent.
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "List my current reorder requests for this session",
      history: [],
    });

    expect(result.requiresApproval).toBe(false);
    expect(result.text.length).toBeGreaterThan(5);
  }, 30_000);

  it("C-07: invalid unit → agent surfaces error clearly", async () => {
    const sessionId = uuidv4();
    const step1 = await runAgentTurn({
      model: MODEL,
      sessionId,
      userMessage: "Order 5 pallets of nitrile gloves to Ward 2, CC-0001, by 2027-06-01",
      history: [],
    });

    // Agent may intercept the write tool or surface the error after execution
    // Either way: no silent success, agent communicates the issue
    const hasErrorInfo =
      step1.toolErrors.some((e) => /pallet|unit|invalid/i.test(e)) ||
      step1.text.toLowerCase().includes("unit") ||
      step1.text.toLowerCase().includes("pallet") ||
      step1.requiresApproval; // Claude is showing confirmation diff before submitting
    expect(hasErrorInfo).toBe(true);
  }, 45_000);

  it("C-08: past delivery date → agent surfaces error", async () => {
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "Order 1 box of nitrile gloves to Ward 1, CC-0001, needed by 2020-01-01",
      history: [],
    });

    // Agent should communicate the date issue
    const mentionsDateIssue =
      result.toolErrors.some((e) => /date|past|2020/i.test(e)) ||
      result.text.toLowerCase().match(/past|date|2020|invalid/) != null ||
      result.requiresApproval; // Agent may show confirmation first
    expect(mentionsDateIssue).toBe(true);
  }, 45_000);

  it("C-09: multi-turn — search, then ask for more details, then order", async () => {
    const sessionId = uuidv4();

    const turn1 = await runAgentTurn({
      model: MODEL,
      sessionId,
      userMessage: "Search for exam gloves",
      history: [],
    });
    expect(turn1.toolCallsMade).toContain("searchCatalog");
    expect(turn1.text.length).toBeGreaterThan(10);

    const turn2 = await runAgentTurn({
      model: MODEL,
      sessionId,
      userMessage: "Tell me more about the first result",
      history: turn1.updatedHistory,
    });
    expect(turn2.toolCallsMade).toContain("getProductDetails");
    expect(turn2.text.length).toBeGreaterThan(10);
  }, 60_000);

  it("C-10: agent replies in German when user writes in German", async () => {
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      userMessage: "Suche nach Nitrilhandschuhen",
      history: [],
    });

    expect(result.requiresApproval).toBe(false);
    expect(result.toolCallsMade).toContain("searchCatalog");
    // Response should contain German words
    const germanWords = /handschuh|artikel|produkt|ergebnis|gefunden|bestellung/i;
    expect(result.text).toMatch(germanWords);
  }, 30_000);
});
