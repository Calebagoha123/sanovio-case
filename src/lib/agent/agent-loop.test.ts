import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { v4 as uuidv4 } from "uuid";
import { runAgentTurn } from "./loop";
import { getServiceClient } from "../db/client";
import { ingestExcel } from "../ingest/ingest";
import path from "path";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const db = getServiceClient();

beforeAll(async () => {
  await ingestExcel(EXCEL_PATH);
});

beforeEach(async () => {
  await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// doGenerate response types
type ToolCallContent = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: string; // JSON string
};
type TextContent = { type: "text"; id: string; text: string };

type MockResponse = { content: (ToolCallContent | TextContent)[]; finishReason: "stop" | "tool-calls" };

const MOCK_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function mockDoGenerate(responses: MockResponse[]) {
  let callIdx = 0;
  return new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async () => {
      const resp = responses[callIdx] ?? responses[responses.length - 1];
      callIdx++;
      return {
        content: resp.content,
        finishReason: { unified: resp.finishReason, raw: resp.finishReason },
        usage: MOCK_USAGE,
        warnings: [],
      // The cast is needed because TextContent's `id` field is optional in some SDK versions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    },
  });
}

describe("agent loop — integration (mocked LLM)", () => {
  it("does not inject a stale internal ID when a new order message names a product", async () => {
    const model = mockDoGenerate([
      {
        content: [{ type: "text", id: "txt-stale-001", text: "Let me check the catalog." }],
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId: uuidv4(),
      userMessage: "order syringes for Ward 3B",
      history: [
        { role: "user", content: "show me product 1" },
        { role: "assistant", content: "Here are the product 1 details." },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = model.doGenerateCalls[0]?.prompt as any[];
    const latestUserMessage = prompt[prompt.length - 1];

    expect(getMessageText(latestUserMessage.content)).toContain("order syringes for Ward 3B");
    expect(getMessageText(latestUserMessage.content)).not.toContain("internal ID 1");
    expect(result.updatedHistory.at(-2)).toEqual({
      role: "user",
      content: "order syringes for Ward 3B",
    });
  });

  it("keeps recent-product context transient and out of persisted history", async () => {
    const model = mockDoGenerate([
      {
        content: [{ type: "text", id: "txt-context-001", text: "I can prepare that request." }],
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId: uuidv4(),
      userMessage: "order 5 boxes to Ward 3B",
      history: [
        { role: "user", content: "show me product 1" },
        { role: "assistant", content: "Here are the product 1 details." },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = model.doGenerateCalls[0]?.prompt as any[];
    const latestUserMessage = prompt[prompt.length - 1];

    expect(getMessageText(latestUserMessage.content)).toContain("internal ID 1");
    expect(result.updatedHistory.at(-2)).toEqual({
      role: "user",
      content: "order 5 boxes to Ward 3B",
    });
    expect(getMessageText(result.updatedHistory.at(-2)?.content)).not.toContain(
      "Context: the most recently referenced exact product"
    );
  });

  it("single read turn: dispatches searchCatalog and returns final text without DB write", async () => {
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-001",
            toolName: "searchCatalog",
            input: JSON.stringify({ query: "nitrile gloves", limit: 5 }),
          },
        ],
        finishReason: "tool-calls",
      },
      {
        content: [{ type: "text", id: "txt-001", text: "Here are the nitrile gloves I found." }],
        finishReason: "stop",
      },
    ]);

    const sessionId = uuidv4();
    const result = await runAgentTurn({
      model,
      sessionId,
      userMessage: "find me nitrile gloves",
      history: [],
    });

    expect(result.toolCallsMade).toContain("searchCatalog");
    expect(result.requiresApproval).toBe(false);
    expect(result.text).toBe("Here are the nitrile gloves I found.");

    // No DB writes
    const { count } = await db
      .from("reorder_requests")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(0);
  });

  it("logs model generation timing for the turn", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const model = mockDoGenerate([
      {
        content: [{ type: "text", id: "txt-000", text: "Ready." }],
        finishReason: "stop",
      },
    ]);

    await runAgentTurn({
      model,
      sessionId: uuidv4(),
      userMessage: "hello",
      history: [],
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"model_generation_complete"')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"stepCount":1')
    );
  });

  it("preserves multiple search result artifacts when the model searches for more than one product", async () => {
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-search-001",
            toolName: "searchCatalog",
            input: JSON.stringify({ query: "nitrile gloves", limit: 5 }),
          },
          {
            type: "tool-call",
            toolCallId: "tc-search-002",
            toolName: "searchCatalog",
            input: JSON.stringify({ query: "syringes", limit: 5 }),
          },
        ],
        finishReason: "tool-calls",
      },
      {
        content: [{ type: "text", id: "txt-002", text: "I found gloves and syringes." }],
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId: uuidv4(),
      userMessage: "find nitrile gloves and syringes",
      history: [],
    });

    const searchArtifacts = result.artifacts.filter((artifact) => artifact.type === "search_results");
    expect(searchArtifacts).toHaveLength(2);
    expect(searchArtifacts).toMatchObject([
      { type: "search_results", query: "nitrile gloves" },
      { type: "search_results", query: "syringes" },
    ]);
  });

  it("preserves multiple product detail artifacts when the model inspects more than one product", async () => {
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-details-101",
            toolName: "getProductDetails",
            input: JSON.stringify({ internalId: 1 }),
          },
          {
            type: "tool-call",
            toolCallId: "tc-details-102",
            toolName: "getProductDetails",
            input: JSON.stringify({ internalId: 3 }),
          },
        ],
        finishReason: "tool-calls",
      },
      {
        content: [{ type: "text", id: "txt-003", text: "Here are both product records." }],
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId: uuidv4(),
      userMessage: "show me product 1 and product 3",
      history: [],
    });

    const detailArtifacts = result.artifacts.filter((artifact) => artifact.type === "product_details");
    expect(detailArtifacts).toHaveLength(2);
    expect(detailArtifacts).toMatchObject([
      { type: "product_details", product: { internalId: 1 } },
      { type: "product_details", product: { internalId: 3 } },
    ]);
  });

  it("write turn: createReorderRequest is intercepted and returns a pending approval (no DB write)", async () => {
    const sessionId = uuidv4();
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-write-001",
            toolName: "createReorderRequest",
            input: JSON.stringify({
              sessionId,
              internalId: 1,
              quantity: 5,
              requestedUnit: "box",
              deliveryLocation: "Ward 3B",
              costCenter: "CC-4412",
              requestedByDate: "2026-06-01",
            }),
          },
        ],
        finishReason: "tool-calls",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId,
      userMessage: "order 5 boxes of product 1 to Ward 3B, CC-4412, by 2026-06-01",
      history: [],
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingToolCall?.toolName).toBe("createReorderRequest");
    expect(result.pendingToolCall?.toolInput).toMatchObject({
      sessionId,
      internalId: 1,
      quantity: 5,
      requestedUnit: "box",
      requestedByDate: "2026-06-01",
    });
    expect(result.pendingToolCall?.summary).toMatch(/Ward 3B/);
    expect(result.pendingToolCall?.summary).toMatch(/1000 Piece/);
    expect(result.pendingToolCall?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.pendingToolCall?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // No DB write — user has not confirmed
    const { count } = await db
      .from("reorder_requests")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(0);
  });

  it("write turn: createBasketReorderRequest is intercepted and returns a grouped pending approval", async () => {
    const sessionId = uuidv4();
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-basket-001",
            toolName: "createBasketReorderRequest",
            input: JSON.stringify({
              items: [
                { internalId: 1, quantity: 5, requestedUnit: "box" },
                { internalId: 2, quantity: 2, requestedUnit: "pcs" },
              ],
              deliveryLocation: "Ward 3B",
              costCenter: "CC-4412",
              requestedByDate: "2026-06-01",
            }),
          },
        ],
        finishReason: "tool-calls",
      },
    ]);

    const result = await runAgentTurn({
      model,
      sessionId,
      userMessage: "order 5 boxes of product 1 and 2 boxes of product 2 to Ward 3B, CC-4412, by 2026-06-01",
      history: [],
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.pendingToolCall?.toolName).toBe("createBasketReorderRequest");
    expect(result.pendingToolCall?.toolInput).toMatchObject({
      sessionId,
      items: [
        { internalId: 1, quantity: 5, requestedUnit: "box" },
        { internalId: 2, quantity: 2, requestedUnit: "pcs" },
      ],
      requestedByDate: "2026-06-01",
    });
    expect(result.pendingToolCall?.summary).toMatch(/Create reorder basket/);
    expect(result.pendingToolCall?.summary).toMatch(/#1/);
    expect(result.pendingToolCall?.summary).toMatch(/#2/);
    expect(result.pendingToolCall?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.pendingToolCall?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const { count } = await db
      .from("reorder_requests")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(0);
  });

  it("failure surfacing: tool throws ProductNotFoundError → error captured, no write", async () => {
    const missingInternalId = 999999;
    const model = mockDoGenerate([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-details-001",
            toolName: "getProductDetails",
            input: JSON.stringify({ internalId: missingInternalId }),
          },
        ],
        finishReason: "tool-calls",
      },
      {
        content: [
          {
            type: "text",
            id: "txt-002",
            text: "I couldn't find product 9999 in the catalog.",
          },
        ],
        finishReason: "stop",
      },
    ]);

    const sessionId = uuidv4();
    const result = await runAgentTurn({
      model,
      sessionId,
      userMessage: `show me details for product ${missingInternalId}`,
      history: [],
    });

    expect(result.toolErrors).toHaveLength(1);
    expect(result.toolErrors[0]).toMatch(String(missingInternalId));
    expect(result.requiresApproval).toBe(false);
  });
});

function getMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }

      return "";
    })
    .join("\n");
}
