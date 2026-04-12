# Reorder Agent — Design Document

## 1. Problem statement

A chat-based AI agent for hospital procurement staff. The agent is the primary interface. Users search a product catalog in natural language, inspect product details, and create reorder requests. Write actions require explicit user confirmation.

The brief is deliberately under-specified: most design questions were returned as "your call, justify it." This document records the decisions and the reasoning behind them.

**Stack.** We follow the reviewer's suggested stack: **Next.js (App Router) + TypeScript + Supabase (hosted Postgres) + Ant Design**, with **Anthropic Claude** as the LLM. The brief permits deviation, but the guidance is the clearest signal we have about what the reviewer wants to see, and it genuinely strengthens the scaling story (Supabase ships with `pgvector`, so the search growth path in §5 becomes cleaner, not weaker). The one place we may deviate is at the styling layer — Ant Design is the default, but any equivalent enterprise component library would be defensible if it were better aligned with the team's existing codebase.

## 2. Scope

### In scope
- Ingesting the provided Excel catalog into a normalized Supabase (Postgres) store.
- Natural-language search over the catalog.
- Product detail retrieval.
- Creating reorder requests, gated by explicit user confirmation.
- Listing reorder requests created in the current session.
- A Next.js chat interface sufficient to demonstrate the above end-to-end.
- An automated test suite that asserts on tool-call behavior, not LLM prose.

### Non-goals (v1)
Each of these is excluded deliberately, not forgotten:

- Price negotiation, supplier communication, invoice matching, goods receiving, returns.
- Real ERP integration (SAP / Oracle / Workday). Reorder requests are written to Supabase only.
- Authentication, roles, multi-tenancy. A single assumed user. (Supabase Auth is available as a near-zero-cost upgrade path but is not wired up in v1.)
- Cross-session memory or per-user preference learning.
- Approval workflows. A confirmed reorder request is final within v1's model.
- Vector or hybrid search. See §5.
- Multi-line reorder requests. One product per request in v1; the schema allows extension.
- Inventory / stock awareness. The catalog has no stock field.
- Formulary, GPO, or contracted-supplier enforcement. Not present in the source data.

## 3. Source data observations

The provided file (`sample-challenge-v01-2.xlsx`, sheet `" Table 3"`) contains **10 rows, 13 columns**. Key observations that shape the design:

- **European / Swiss medical-device context.** Prices in CHF, MDR risk classes (I, IIa), brands Hartmann / B. Braun / Schülke / Medline / Ansell / Sarstedt. Compliance framing is EU MDR, not US HCPCS/NDC/GPO.
- **No stock, no lot/expiry, no hazardous flag, no category hierarchy.** `Annual quantity` is the only demand signal and is treated as a suggested-reorder hint, not as live inventory.
- **Unit hierarchy is non-trivial.** Each row has an `Order quantity unit` (box / pack / pcs / can / role), a `Base unit of measure` (Piece / Cloth / role), and `Base units per BME` (the multiplier). "5 boxes of gloves" means 5 × 200 = 1000 pieces. Unit conversion is the single most testable correctness property in the system and is handled in tool code, never delegated to the LLM.
- **Dirty data.** Leading spaces on nearly every string field, GTINs stored as text with a leading apostrophe, `role` appears in lowercase where siblings are capitalized, sheet name has a leading space. Ingestion normalizes all of this.
- **Ten rows is a design signal.** At this scale, lexical search is not just sufficient — it is correct. Any heavier retrieval approach would be a failure of tool calibration.

## 4. Architecture

```
User
  │
  ▼
Next.js chat UI  ──►  Agent loop  ──►  Tool dispatcher  ──►  Supabase (Postgres)
(App Router,             │                    │
 Ant Design)             ▼                    ▼
                    Claude (tools API)   Confirmation gate (writes only)
```

Five layers, each replaceable:

1. **Ingestion** — one-shot TypeScript script (`src/lib/ingest.ts`) that reads the Excel via `xlsx`, normalizes strings and units, upserts into Supabase via the service-role client.
2. **Storage** — Supabase (hosted Postgres). Two tables: `products`, `reorder_requests`. Justification: the reviewer suggested it, the operational cost is zero, and it gives us Postgres full-text search for v1 *and* `pgvector` for the v2 dense-retrieval upgrade without introducing a new service. See §5 for the search-backend discussion and [`SEARCH.md`](SEARCH.md) for the full argument.
3. **Tools** — plain TypeScript functions with Zod-validated arguments and JSDoc. The Zod schemas become the LLM's tool schemas (via the SDK's schema conversion). Read tools execute directly; write tools go through the confirmation gate.
4. **Agent loop** — implemented with Vercel AI SDK v6. It receives a user message, calls Claude with the tool schemas, dispatches tool calls, loops until the model returns a final text response or a write requires confirmation. Runs server-side in a Next.js route handler so the Anthropic API key never touches the browser.
5. **Chat UI** — Next.js App Router page with Ant Design components. Streams assistant messages and tool-call traces via Server-Sent Events or the Vercel AI SDK's streaming primitives. The chat route is the only surface the user touches.

## 5. Search strategy

**Decision:** normalized lexical search with light synonym handling, using Postgres full-text search.

**Implementation sketch:** first, detect exact identifier queries (for example internal ID, GTIN/EAN, or supplier article code) and resolve them against dedicated indexed columns. Otherwise, query a generated `tsvector` column over `description || ' ' || brand`, indexed with GIN, using `plainto_tsquery` (or `websearch_to_tsquery` for quote-aware queries) and ranked by `ts_rank_cd`. A small synonym map expands common queries at the application layer before the query hits Postgres (`glove` → also match `latex`, `nitrile`; `needle` → `cannula`; `wipe` → `cloth`). Top-*k* with k=5 default.

**Rejected alternatives (for v1):**
- *Dense / vector search over embeddings.* Adds an embedding model call per query and a `pgvector` index for a 10-row catalog. Pure overkill. Would be the right answer above ~10k rows where lexical recall starts to hurt — and because Supabase ships `pgvector` as a built-in extension, the upgrade is `create extension vector` plus one column, not a new service.
- *Hybrid (lexical + vectors + RRF fusion + cross-encoder rerank).* The right answer at realistic scale; see [`SEARCH.md`](SEARCH.md) for the full architecture and literature review. Not justified at N=10.
- *LLM-based semantic matching inside the tool.* Slower, non-deterministic, harder to test.

**Extension path:** the `search_catalog` tool signature hides the backend. Swapping exact lookup + Postgres FTS → that + pgvector + RRF → that + a cross-encoder reranker requires no change to the agent loop or the tool schema. The growth path is documented step-by-step in [`SEARCH.md`](SEARCH.md) §5.2.

## 6. Tool surface

Five tools. Three are the minimum required by the brief; two are additions justified below.

| Tool | Kind | Confirmation | Purpose |
|---|---|---|---|
| `search_catalog(query, limit=5)` | read | no | Natural-language search. Returns ranked list of `{internal_id, description, brand, order_unit, price, currency}`. |
| `get_product_details(internal_id)` | read | no | Full record for one product, including unit hierarchy and MDR class. |
| `create_reorder_request(internal_id, quantity, requested_unit, delivery_location, cost_center, requested_by_date, justification?)` | **write** | **yes** | Creates a pending reorder request. Validates `internal_id` exists and `requested_unit` is either the catalog order unit or the product's base unit. Exact base-unit multiples are canonicalized to the order unit; silent rounding is rejected. Returns a request ID after confirmation. |
| `list_reorder_requests()` | read | no | Lists requests created in the current session, filtered by explicit `session_id`. Added so the agent can answer "what have I ordered?" without a memory subsystem. |
| `cancel_reorder_request(request_id)` | **write** | **yes** | Marks a request as cancelled, but only within the current session scope. Added to demonstrate the write-confirmation pattern on a second verb and to give the lifecycle a visible end state. |

All tool inputs are validated before execution. Hallucinated IDs return a structured error the agent must surface to the user.

## 7. Confirmation mechanic

Writes never execute on the first tool call. The flow is:

1. LLM emits a write tool call with proposed arguments.
2. The agent intercepts it, formats a **structured diff** for the user:
   ```
   I'm about to create a reorder request:
     Product:   Nitrile glove Sensicare Ice blue L (Medline, #486803)
     Quantity:  5 box  (= 1000 Piece)
     Deliver:   Ward 3B
     Cost ctr:  CC-4412
     Needed by: 2026-04-20
   Confirm? (yes / no / edit)
   ```
3. `yes` → the tool executes. `no` → the tool is cancelled and the agent acknowledges. `edit` → the agent collects changes and re-proposes; confirmation is **re-required** on any field change.
4. The unit conversion shown in parentheses (`= 1000 Piece`) is computed in tool code and passed to the UI. The LLM does not do this math. If the user expressed quantity in base units ("1000 gloves"), exact multiples are converted deterministically to purchasing units before confirmation; non-exact multiples require clarification.
5. Every proposed and every confirmed write is logged with timestamp, arguments, and outcome.

## 8. Reorder request model

A reorder request is a row in the Supabase `reorder_requests` table, status ∈ {`pending`, `cancelled`}. There is no "submitted to supplier" state in v1 — that would be out-of-scope ERP integration.

Mandatory fields: `session_id`, `internal_id`, `quantity`, `order_unit`, `delivery_location`, `cost_center`, `requested_by_date`.
Optional: `justification`.
System-generated: `request_id` (UUID), `created_at` (timestamptz), `status`, `base_unit_quantity` (computed).

Single product per request in v1. The schema is deliberately modelled as `reorder_requests` (one row per request) rather than a header/lines pair, but the shape is compatible with adding a `reorder_request_items` child table later without migrating existing data.

The persisted row stores the **canonical purchasing quantity** (`quantity` + `order_unit`) plus `base_unit_quantity`. Raw user phrasing lives in logs and the confirmation transcript, not in the table. This keeps downstream behavior deterministic while preserving an audit trail.

Session scoping in v1 is explicit: the chat API issues or accepts a UUID `session_id` on first load, the browser sends it on every request, and `reorder_requests.session_id` stores it. `list_reorder_requests()` filters by that `session_id`; `cancel_reorder_request()` only operates on rows from the same session. This is a UX scoping mechanism, **not** a security boundary. v1 still assumes a single trusted user because authentication is out of scope.

Dates in v1 are **date-only**, not datetimes. Relative phrases such as `today`, `tomorrow`, `Monday`, and `next Monday` are resolved server-side in the configured hospital timezone (default `Europe/Zurich`) before confirmation. A bare weekday means the next occurrence strictly after the current local date. Resolved past dates are rejected and must be clarified.

## 9. Conversation & memory

**Decision:** single-session, in-memory chat history, with explicit persisted `session_id` scoping on reorder rows but no cross-session conversational memory.

- Anaphora ("that product we just looked at") is handled by the model's own context window over recent tool results. No separate memory store, no retrieval-over-history.
- Conversation history and reorder history are deliberately different things: the former is ephemeral message state, the latter is DB state keyed by `session_id`.
- History is capped at N turns (default 20) with naive truncation from the oldest non-system message. If a conversation exceeds the cap in testing, that's a signal the cap is wrong, not that a summarization layer is needed.
- The brief explicitly excludes user preference learning, so "my usual reorder" is not supported.

## 10. Failure modes

| Situation | Behavior |
|---|---|
| Ambiguous search (many matches) | Return top-k; agent asks the user to disambiguate. |
| No results | Tool returns empty list; agent says so and suggests broadening the query. |
| Hallucinated `internal_id` | Tool returns `ProductNotFound`; agent surfaces the error and offers to search. |
| Unit mismatch (e.g. order unit `piece` when product is sold by `box`) | Tool returns `InvalidUnit` with the valid options. |
| User requests a base-unit quantity that is not an exact order-unit multiple | Tool returns `NonExactPackMultiple`; agent explains the valid packaging and asks the user to choose a valid order quantity. |
| Relative date phrase (`next Monday`) | Server resolves it to `YYYY-MM-DD` in the configured timezone before confirmation; if resolution is ambiguous or in the past, the agent asks for clarification. |
| `request_id` exists but belongs to another session | Tool returns `RequestNotFound` for the current session scope. |
| Tool exception mid-flow | Caught by the agent loop, reported to the user, no partial write. |
| User says "no" at confirmation | Write is dropped; agent acknowledges and waits. |
| Model emits malformed tool args | Agent catches the validation error, re-prompts the model once, then surfaces the failure if it repeats. |

## 11. Non-functional targets (v1)

These are *targets*, not SLAs. Calibrated to a take-home's reality.

- **Latency:** p50 < 2s for a search turn, < 4s for a full write turn including confirmation rendering. Dominated by LLM round-trip.
- **Reliability:** the agent should never silently fail a write. Every tool error is surfaced to the user.
- **Data consistency:** writes use Postgres transactions; the confirmation gate ensures no partial state even across a multi-step tool flow.
- **Security:** no secrets in the repo; Anthropic API key and Supabase service-role key read from env vars, never shipped to the client. The service-role key is used only in server-side code (route handlers, ingestion script). Inputs validated at the tool boundary via Zod. No PHI is handled; prompts and tool calls may be logged.
- **Observability:** structured JSON log of every LLM call and every tool call, sufficient to reconstruct any session for debugging or audit.
- **Testability:** tool behavior is deterministic and unit-testable without an LLM in the loop. See §13.

## 12. Compliance framing

EU MDR context. No patient data, no PHI, no PII beyond the assumed single user. Logging of prompts and tool calls is the only audit requirement invoked here. Anything stronger (signed audit trail, 21 CFR Part 11, GxP) is out of scope and would need explicit requirements.

## 13. Test strategy

This project is developed test-first. The full plan lives in [`TEST_PLAN.md`](TEST_PLAN.md); the summary here is that there are three layers:

### Unit tests (fast, no LLM)
- **Ingestion:** raw Excel → normalized Postgres. Strips whitespace, coerces types, handles the leading-apostrophe GTIN, normalizes `role` casing. Asserts row count and a spot-check on each column. Runs against a local Supabase instance or a disposable test schema.
- **Unit conversion:** `convert(5, "box", internalId: 1)` → `1000 Piece`. Round-trip, edge cases, invalid unit.
- **Each tool in isolation:** valid input → expected output; invalid input → expected error type. No LLM involved.
- **Confirmation gate:** a write tool called without confirmation is intercepted; called with confirmation executes; `edit` path re-requires confirmation.
- **DB layer:** reorder request create / list / cancel, status transitions, transactional rollback on error.

### Integration tests (agent loop with a mocked LLM)
- Given a scripted sequence of LLM responses (tool calls and final messages), the agent loop dispatches correctly, applies the confirmation gate, and produces the expected DB state.
- Failure injection: tool raises → agent surfaces error, no partial state.
- Conversation buffer truncation at the cap.

### End-to-end tests (real LLM, small fixed query set)
A handful (5–10) of scripted conversations run against the real Claude model, asserting on **tool-call traces**, not on the LLM's prose:
- "find me nitrile gloves" → expect `search_catalog` called with a query containing `glove` or `nitrile`; expect internal_id 1 in results.
- "show me details for product 4" → expect `get_product_details(4)`.
- "order 5 boxes of product 1 to Ward 3B, cost center CC-4412, needed by next Monday" → expect a `create_reorder_request` proposal with `quantity=5, order_unit="box"`; expect the agent to ask for confirmation; on confirmation, expect the DB row to exist.
- "what have I ordered?" → expect `list_reorder_requests`.
- "cancel the last one" → expect `cancel_reorder_request` with confirmation.
- Ambiguous query ("gloves") → expect disambiguation, not a guess.
- Hallucinated ID ("order 5 of product 999") → expect `ProductNotFound` surfaced to the user, no write.

### What is explicitly not tested
- Exact LLM wording. Brittle and low-value.
- Latency under load. Out of scope for v1.
- Security penetration. Out of scope for v1.

## 14. Open questions deferred to implementation

- **Synonym map contents.** Grown empirically from the e2e test set.
- **Session transport details.** Cookie vs. explicit client-generated UUID in the request body/header; the semantics are fixed either way (`session_id` exists and scopes request history), only the transport is open.
- **Local Supabase vs. hosted project for development.** The Supabase CLI provides a local Postgres + Studio stack; hosted is faster to start but local is faster to iterate. Default to local for dev, hosted for the demo deployment.

## 15. Decision log (one-liners)

- Supabase (Postgres) over local SQLite: reviewer's suggested stack, zero ops, and `pgvector` is a built-in upgrade path for the v2 hybrid retriever.
- Next.js + TypeScript + Ant Design over Python + Streamlit: reviewer's suggested stack, stronger chat-UI story, TypeScript tooling and tests run natively in the same process as the agent loop.
- Vercel AI SDK v6 (tools + `needsApproval` + `useChat`) over the raw Anthropic SDK and over heavier frameworks (Mastra, VoltAgent, LangGraph.js): the confirmation gate is a declarative primitive, streaming is native to Next.js, and lock-in stays low. See [`FRAMEWORK.md`](FRAMEWORK.md).
- Lexical (Postgres FTS) plus exact identifier lookup over vector for v1: N=10, calibration. Full argument in [`SEARCH.md`](SEARCH.md).
- Single-line reorders: scope control, clean extension path.
- No cross-session conversational memory: brief excludes preference learning. Session-scoped reorder history still persists via `session_id`.
- Structured diff confirmation: auditable, unambiguous, re-required on edit.
- Unit conversion and pack normalization in tool code: testable, deterministic, and silent rounding is forbidden.
- Five tools, not three: read-lifecycle and cancel demonstrate the pattern without scope creep.
- EU MDR framing: matches the source data.
- Test-first: the brief rewards defensible decisions, and tests are the defense.
