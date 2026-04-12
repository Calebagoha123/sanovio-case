# Test Plan

This project is developed test-first. Tests are not an afterthought — they are the mechanism by which the design decisions in [`DESIGN.md`](DESIGN.md) are defended. Every "your call, justify it" answer in the brief becomes a test that pins the decision in place.

This document began as a forward-looking plan. The repository now implements a working subset of it:

- fast deterministic CI-safe tests
- local DB-backed unit tests
- mocked agent-loop integration tests
- optional real-model e2e tests

This document lists the tests we intend to write, grouped by layer. The actual test code is not written yet; this is the directional plan that drives implementation order.

**Stack.** Tests run under **Vitest** (fast, first-class TypeScript support, same ESM module resolution as Next.js). A small CI-safe suite runs without Docker. The broader unit and integration layers run against a **local Supabase** stack (`supabase start`). The e2e layer hits the real **Claude** API.

## Principles

- **Assert on behavior, not prose.** Integration and e2e tests check which tools the agent called with what arguments, not the exact words the LLM produced.
- **Push logic down the stack.** Anything that can be tested without an LLM should be tested without an LLM. The unit layer is where most bugs are caught.
- **Each test names the decision it defends.** When a test fails, the failure should point at a specific design commitment, not a vague "something broke."
- **Green before moving on.** Each implementation step lands with its tests passing before the next step starts.

## Layer 1 — Unit tests (fast, deterministic, no LLM)

These run in milliseconds and form the bulk of the suite. Target: < 2 seconds for the full unit layer. Location: colocated with source, `src/lib/**/*.test.ts`.

### `src/lib/ingest/ingest.test.ts`
Defends the ingestion contract against the messy source data.

- Loads the sample Excel and produces exactly 10 product rows in the `products` table.
- Strips leading/trailing whitespace from every string column.
- Coerces GTIN/EAN from the leading-apostrophe string form to a clean digit string.
- Normalizes the `role` / `Role` casing inconsistency on row 10.
- Parses `net_target_price` as `numeric`, `annual_quantity` and `base_units_per_bme` as `integer`.
- Rejects an input file that is missing expected columns with a clear error.
- Is idempotent: re-running ingestion on the same file produces the same DB state (upsert, not duplicate insert).
- The generated `search_tsv` column is populated and non-empty for every row.

### `src/lib/units/convert.test.ts`
Defends the single most testable correctness property: unit conversion.

- `convert(5, "box", { internalId: 1 })` returns `{ quantity: 1000, unit: "Piece" }` (5 × 200).
- `convert(1, "pack", { internalId: 3 })` returns `{ quantity: 100, unit: "Piece" }`.
- `convert(1, "role", { internalId: 10 })` returns `{ quantity: 1, unit: "role" }` (base unit == order unit).
- Invalid order unit for a product throws `InvalidUnitError` with the valid options in the message.
- Invalid internal id throws `ProductNotFoundError`.
- Zero and negative quantities throw `InvalidQuantityError`.
- `normalizeRequestedQuantity(1000, "Piece", { internalId: 1 })` returns the canonical purchasing quantity `{ quantity: 5, orderUnit: "box", baseUnitQuantity: 1000 }`.
- A non-exact pack multiple (for example `normalizeRequestedQuantity(900, "Piece", { internalId: 1 })`) throws `NonExactPackMultipleError` with the nearest valid purchasing options.

### `src/lib/dates/resolve-requested-by-date.test.ts`
Defends server-side date normalization so the write path does not depend on model date arithmetic.

- `tomorrow` resolves relative to the configured hospital timezone.
- `Monday` resolves to the next occurrence strictly after the current local date.
- `next Monday` resolves deterministically and matches the confirmation transcript format (`YYYY-MM-DD`).
- An already-past ISO date is rejected.
- An unparseable or ambiguous date phrase fails clearly and does not reach the write proposal.

### `src/lib/db/reorder-requests.test.ts`
Defends the DB layer.

- `createReorderRequest(...)` inserts a row with status `pending` and a generated UUID.
- `createReorderRequest(...)` requires and persists `session_id`.
- `listReorderRequests()` returns requests in creation order (stable ordering by `created_at`).
- `listReorderRequests(sessionA)` does not return rows from `sessionB`.
- `cancelReorderRequest(id)` transitions `pending` → `cancelled`.
- Cancelling a request from another session is rejected as `RequestNotFoundError` for the current session scope.
- Cancelling a non-existent id throws `RequestNotFoundError`.
- Cancelling an already-cancelled request throws `InvalidStatusTransitionError`.
- A failed insert (e.g. FK violation on a bad `internal_id`) leaves no partial row — Postgres transaction rolls back cleanly.
- Row-level operations use the **service-role** Supabase client, not the anon client, and that client is never imported into `app/` client code. (Static test: the import is only reachable from server-only modules.)

### `src/lib/tools/*.test.ts`
Defends each tool's input validation and output shape, with no LLM in the loop.

- **`searchCatalog`**
  - `"glove"` returns at least product 1 (Nitrile) and product 8 (latex).
  - `"nitrile"` returns product 1 first.
  - An exact GTIN/EAN or article-code query returns the exact matching product without going through fuzzy ranking.
  - `"xyzzy"` returns an empty list, not an error.
  - Result shape matches the documented Zod schema.
  - `limit: 2` returns at most 2 results.
  - Synonym expansion: `"needle"` matches product 6 (cannula).
- **`getProductDetails`**
  - Valid id returns the full normalized record.
  - Invalid id throws `ProductNotFoundError`.
- **`createReorderRequest`**
  - Valid input returns a request id and computes `baseUnitQuantity` correctly.
  - A valid base-unit request that is an exact multiple canonicalizes to the persisted purchasing unit before confirmation.
  - A non-exact pack multiple fails with `NonExactPackMultipleError` rather than rounding.
  - Unknown `internalId` throws `ProductNotFoundError`.
  - Wrong `requestedUnit` throws `InvalidUnitError`.
  - Missing mandatory field fails Zod validation at the boundary.
  - `requestedByDate` in the past or an unparseable relative phrase fails validation before any write proposal is shown.
- **`listReorderRequests`**
  - Empty table returns `[]`.
  - After two creates, returns both in order.
- **`cancelReorderRequest`**
  - Valid pending id transitions to cancelled.
  - Unknown id throws `RequestNotFoundError`.

### `src/lib/agent/confirmation-gate.test.ts`
Defends the write-confirmation mechanic, which is the core safety property.

- A write tool invoked without prior confirmation does **not** execute; it returns a "pending confirmation" sentinel with the proposed args.
- The same write tool invoked with an explicit confirmation token **does** execute.
- Confirmation tokens are single-use: replaying the same token is rejected.
- Editing any field after the proposal invalidates the prior confirmation; a new token is required.
- Read tools bypass the gate entirely.
- The structured diff for a create includes the computed `baseUnitQuantity` and the canonical purchasing quantity in the human-readable form.

## Layer 2 — Integration tests (mocked LLM)

These exercise the agent loop end-to-end but replace Claude with a scripted fake that emits a predetermined sequence of tool calls and final messages. They run in under a second and are the primary regression net for the agent loop's control flow. Location: `src/lib/agent/agent-loop.test.ts`.

- **Single read turn.** Scripted LLM emits one `searchCatalog` call then a final message. Agent dispatches the tool, feeds the result back, terminates cleanly. DB unchanged.
- **Multi-tool read turn.** Scripted LLM emits `searchCatalog` then `getProductDetails`, then finalizes. Both dispatched in order, results threaded correctly.
- **Write with confirmation.** Scripted LLM emits `createReorderRequest`. Agent intercepts, produces the structured diff, pauses. Test injects `yes`. Tool executes. DB now has one row.
- **Write with refusal.** Same as above but test injects `no`. Tool does not execute. DB unchanged. Agent emits an acknowledgement.
- **Write with edit-then-confirm.** Test injects `edit`, supplies a new quantity. Agent re-proposes with the new quantity. Test injects `yes`. DB has one row with the **edited** quantity, not the original.
- **Session-scoped history.** After creating requests in two distinct sessions, `listReorderRequests` only returns rows from the active session and `cancelReorderRequest` cannot affect the other one.
- **Failure surfacing.** Tool throws `ProductNotFoundError`. Agent catches, reports to user, does not crash, does not write.
- **Malformed tool args.** Scripted LLM emits a call with an invalid argument type. Agent's Zod validation catches it, re-prompts once, then surfaces the failure if the retry also fails.
- **History cap.** Conversation exceeds the turn cap; oldest non-system messages are truncated; the agent still functions.

## Layer 3 — End-to-end tests (real LLM, tool-trace assertions)

Small fixed set, 5–10 conversations, run against the real Claude model. Each asserts on which tools were called with what arguments, not on the LLM's wording. These are the slowest and least deterministic layer, so we keep them few and focused. Gated behind `ANTHROPIC_API_KEY` being present in the env, skipped otherwise. Location: `src/lib/agent/conversations.e2e.test.ts`.

- **find_gloves.** User: `"find me nitrile gloves"`. Expect: `searchCatalog` called with a query containing `glove` or `nitrile`; result set includes `internalId: 1`.
- **product_details.** User: `"show me details for product 4"`. Expect: exactly one call to `getProductDetails({ internalId: 4 })`.
- **order_happy_path.** User: `"order 5 boxes of product 1 to Ward 3B, cost center CC-4412, needed by next Monday"`. Expect: `createReorderRequest` **proposed** (not executed) with `internalId: 1, quantity: 5, orderUnit: "box"`; agent renders confirmation; user confirms; DB row exists with status `pending`.
- **exact_identifier_lookup.** User: a GTIN/EAN or article-code query copied from the catalog. Expect: exact product hit returned without disambiguation.
- **order_refused.** Same setup; user says `no`. Expect: no DB row.
- **order_edited.** User proposes, then says `"make it 10 boxes instead"`, then confirms. Expect: DB row with `quantity: 10`, not 5.
- **ambiguous_query.** User: `"gloves"`. Expect: the agent either asks a clarifying question or presents multiple results; it does **not** silently pick one and order it.
- **hallucinated_id.** User: `"order 5 of product 999"`. Expect: `createReorderRequest` or `getProductDetails` throws `ProductNotFoundError`; the agent surfaces the error; no DB write.
- **list_and_cancel.** User creates a request, then says `"what have I ordered?"`, then `"cancel the last one"`. Expect: `listReorderRequests` call, then `cancelReorderRequest` proposal, then confirmation, then DB status `cancelled`.
- **unit_normalization.** User: `"I need 1000 gloves"` with product 1 in context. Expect: the write proposal is canonicalized to `quantity: 5, orderUnit: "box"` via deterministic tool-side normalization, not silent model arithmetic.

## What is not tested

Listed so it's clear these are omissions by choice, not by oversight:

- **Exact LLM wording.** Brittle, low-signal, changes with every model update.
- **Latency under load.** Out of scope for v1; measured informally during development.
- **Security / penetration.** Out of scope for v1. The agent has no auth and assumes a trusted single user. Supabase RLS policies would defend this layer if auth were wired up.
- **UI component tests.** The Ant Design chat layer is thin; manual smoke-test is sufficient for v1. Playwright or React Testing Library would be the next step if UI logic grew.
- **Cross-session memory.** The design excludes it; there is nothing to test.
- **ERP round-tripping.** Out of scope.
- **Vector search quality.** Not in v1; would be added with the backend.

## Execution order during development

1. Write `ingest.test.ts` → implement `src/lib/ingest/` → green.
2. Write `convert.test.ts` and `reorder-requests.test.ts` → implement `src/lib/units/` and `src/lib/db/` → green.
3. Write the five `src/lib/tools/*.test.ts` files → implement the tool modules → green.
4. Write `confirmation-gate.test.ts` → implement the gate inside `src/lib/agent/` → green.
5. Write `agent-loop.test.ts` → implement `src/lib/agent/loop.ts` against a mocked LLM → green.
6. Implement the Next.js chat route (`app/api/chat/route.ts`) and the Ant Design UI (`app/page.tsx`). No automated tests at this layer; manual smoke.
7. Write `conversations.e2e.test.ts` → run against the real model → green.
8. Polish pass: structured logging, error messages, and the README demo transcript updated from a real session.

Only after step 7 is green do we consider the v1 build complete.

## Running the tests

```bash
pnpm test:ci           # fast deterministic suite for GitHub Actions
pnpm test              # local DB-backed unit + integration
pnpm test:unit         # local unit suite
pnpm test:integration  # mocked LLM integration
pnpm test:e2e          # real LLM, gated on ANTHROPIC_API_KEY
```

Vitest is configured with separate `projects` so the layers can run independently. Supabase is started once for the session (`supabase start`) and each test file uses a fresh schema via a `beforeEach` that truncates the `products` and `reorder_requests` tables.
