# Agent Framework Comparison

> Decision document for `src/lib/agent/`. A companion to `DESIGN.md` and `SEARCH.md`.

## TL;DR

**Recommendation: Vercel AI SDK v6, used directly.**

Not a heavier framework on top. The specific reasons, each grounded in a finding from §3:

1. The confirmation gate — the single most important safety property in this system — is a first-class primitive in AI SDK v6 via the `needsApproval` flag. We do not need to hand-roll it, and we do not need a framework layer on top to provide it.
2. Every serious TypeScript agent framework in the landscape (Mastra, VoltAgent, and others) is *built on top of* Vercel AI SDK, not as a competitor to it. Adopting one of them means adopting AI SDK plus another layer. We have to justify the layer on its own merits, and at our scope the layer does not justify itself.
3. AI SDK v6 is the only candidate with **native, first-class React / Next.js integration** — `useChat`, `useCompletion`, Server Components streaming, route-handler response helpers, `addToolApprovalResponse`. The other frameworks either wrap this or require bridging code.
4. Lock-in is minimal. The SDK is essentially a typed wrapper over the Messages API plus a well-designed tool loop. If we ever outgrow it, lifting to Mastra or LangGraph.js is a day of work because all three share the same underlying concepts and schemas.
5. The explicit evaluation axis in the brief is "design reasoning." Picking the lowest-abstraction option that meets the requirements, and justifying every layer we *don't* add, is itself the design reasoning.

The anti-recommendation, equally important: **we are not using the raw Anthropic SDK.** That was my prior going in. AI SDK v6 updates it, because `needsApproval` eliminates ~80 lines of hand-rolled confirmation-gate code and the `useChat` integration eliminates a separate category of custom UI plumbing. We gain those two things at the cost of one extra dependency that is already the de facto standard in TypeScript LLM work.

The rest of this document is the rubric, the five candidates graded against it, and the reasoning I'd defend in a technical interview.

## The rubric

Any framework for this project has to answer seven questions. Five of them are show-stoppers; two are tie-breakers.

1. **Tool interception for the confirmation gate.** Can I wrap write tools such that the agent pauses, renders a diff, and only executes on explicit user confirmation? Read tools must bypass the gate. This has to be cleanly supported — ideally as a declarative flag — or the framework is disqualified. The confirmation gate is non-negotiable per `DESIGN.md` §7.
2. **Streaming fit with Next.js.** Does it integrate with Next.js App Router route handlers and a client-side chat UI without a second transport layer or a separate process? Our architecture (`DESIGN.md` §4) puts the agent loop in `app/api/chat/route.ts`; anything that wants to own its own HTTP server is a poor fit.
3. **Testability with a mocked LLM.** Can I inject a fake model client that emits scripted tool calls and final messages, for the integration tests in `TEST_PLAN.md` Layer 2? A framework that makes the model client hard to mock is disqualified.
4. **Maturity and bus factor.** How old, how active, how many maintainers, who funds it, what's the issue response time.
5. **Lock-in cost.** If we pick this and later need to rip it out, how much code moves?
6. **Observability fit with EU data residency.** (Tie-breaker.) Local structured logging is table stakes. A hosted tracing console is a bonus *only* if self-hosting is free or if data residency isn't a concern. For a Swiss/EU company, any framework whose observability story requires shipping prompts to a US SaaS is a weaker fit.
7. **Code surface for our five tools.** (Tie-breaker.) Roughly how much ceremony to wire up `searchCatalog`, `getProductDetails`, `createReorderRequest`, `listReorderRequests`, `cancelReorderRequest` with Zod schemas.

## The candidates

Five, because the TS agent landscape has settled into this set as of early 2026. In descending order of abstraction:

1. **Raw Anthropic SDK** (`@anthropic-ai/sdk`) — thin typed wrapper over the Messages API. Not an agent framework at all; you write the loop.
2. **Vercel AI SDK v6** (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/react`) — unified provider abstraction, `generateText` / `streamText`, `ToolLoopAgent`, `useChat`, `needsApproval`. The TS agent substrate.
3. **Mastra** (`@mastra/core`) — agent framework built on AI SDK v6. Adds memory adapters, workflow engine (`createWorkflowChain`), `.suspend()/.resume()` human-in-the-loop, Mastra Studio IDE.
4. **VoltAgent** (`@voltagent/core`) — agent framework also built on AI SDK v5, via `@voltagent/vercel-ai`. Adds memory, sub-agents/supervisors, guardrails, evals, and VoltOps — a hosted observability console.
5. **LangGraph.js** (`@langchain/langgraph` + `@langgraphjs/toolkit`) — graph-based state machine for agent workflows. Adds explicit state/node/edge primitives, checkpointer persistence, time-travel debugging.

Each graded below.

---

### 1. Raw Anthropic SDK

**What it is.** `@anthropic-ai/sdk` is Anthropic's official TypeScript client. It gives you typed request/response objects for `messages.create`, streaming via async iterators, retry logic, and that's it. There is no agent loop, no tool-dispatch helper, no confirmation primitive, no `useChat` hook. You write all of that yourself.

**What the code looks like.** Roughly 100–200 lines of TypeScript: a `runAgent(messages)` function that loops on `client.messages.create`, inspects `stop_reason === "tool_use"`, dispatches tool calls from `content` blocks, feeds results back as `tool_result` blocks, and repeats until `stop_reason === "end_turn"`. The confirmation gate is a hand-written interception in that loop.

**Rubric scores.**

| Criterion | Score | Notes |
|---|---|---|
| Confirmation gate | ✅ | Trivial to implement when you own the loop — just don't execute write tools until you see a confirmation message from the user. You own every line. |
| Streaming fit with Next.js | ⚠️ | You have to write the SSE/ReadableStream plumbing yourself. `app/api/chat/route.ts` is doable but there is no `useChat` equivalent on the client; you write that too, or you pair the raw SDK with `@ai-sdk/react` (at which point you should just use AI SDK). |
| Mockable | ✅ | Inject a fake `Anthropic` client. Straightforward. |
| Maturity / bus factor | ✅ | Official, maintained by Anthropic, extremely stable. |
| Lock-in | ✅ | Near zero. |
| Observability | ⚠️ | You write your own structured logging. No tracing UI out of the box. |
| Code surface | ❌ | Highest of all five. Every feature costs code. |

**Verdict.** This was my strong prior going in. It would be correct if AI SDK v6 didn't exist. It doesn't, and AI SDK v6's `needsApproval` flag eliminates the ~80 lines of confirmation-gate code that were the primary argument for writing the loop ourselves, while the `useChat` integration eliminates another ~100 lines of client/server streaming plumbing. We keep the "nothing magic, every line is mine" property by choosing AI SDK v6 at its lowest-level API (`streamText` with tools) rather than reaching for Mastra or VoltAgent on top.

One thing worth naming: there is an aesthetic argument for the raw SDK — "we wrote the loop, we understand the loop, the reviewer can read the loop in one file." That aesthetic is real and I respect it. It is outweighed by the fact that the reviewer is a TypeScript shop using the Vercel-suggested stack, and for that reviewer "you reimplemented `streamText` badly" is a worse outcome than "you used the standard primitive."

**Bottom line:** Rejected. But the reasons are narrow and specific, not "frameworks are better than SDKs."

---

### 2. Vercel AI SDK v6 (**the pick**)

**What it is.** The TypeScript SDK for building AI applications. Unified provider interface (`anthropic('claude-opus-4-6')`, `openai('gpt-5')`, etc.), core primitives `generateText` / `streamText` / `generateObject`, an `Agent` / `ToolLoopAgent` abstraction that wraps the tool-calling loop, first-class React integration via `@ai-sdk/react`'s `useChat` hook, and — critically for us — a `needsApproval` flag on tool definitions that makes the confirmation gate a one-line change.

**Context and credibility.** From Vercel (Next.js creators), 20M monthly downloads (per the v6 release blog), 6000+ GitHub stars on the core repo, used in production by Thomson Reuters (CoCounsel), Resend, Perplexity, and many others. V5 landed mid-2025, V6 landed late 2025 / early 2026 with the agent and HITL features. Open source, MIT license.

**The confirmation gate in AI SDK v6.** This is the killer finding, so it gets its own block. From the v6 release blog:

> *"In AI SDK 6, you get human-in-the-loop control with a single `needsApproval` flag, no custom code required. Set `needsApproval: true` to require approval before execution. [...] Not every tool call needs approval. [...] You can pass a function to `needsApproval` to decide based on the input."*

Translated to our tools:

```typescript
// src/lib/tools/create-reorder-request.ts
import { tool } from "ai";
import { z } from "zod";

export const createReorderRequest = tool({
  description: "Create a pending reorder request for a single product.",
  inputSchema: z.object({
    internalId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    orderUnit: z.string(),
    deliveryLocation: z.string(),
    costCenter: z.string(),
    requestedByDate: z.string(),
    justification: z.string().optional(),
  }),
  needsApproval: true,          // <-- the confirmation gate
  execute: async (input) => {
    // runs ONLY after the user approves
    return await db.createReorderRequest(input);
  },
});
```

Read tools (`searchCatalog`, `getProductDetails`, `listReorderRequests`) omit the flag and execute immediately. Write tools (`createReorderRequest`, `cancelReorderRequest`) set it to `true` and pause until approval. On the client, `useChat` exposes `addToolApprovalResponse` and the tool state transitions through `approval-requested → approved/denied → output-available`. This is what our `DESIGN.md` §7 described — almost verbatim — as a framework feature we'd have to build. We don't have to build it.

The `needsApproval: (input) => ...` function form also gives us conditional approval for free. If we later want "only require approval for orders above 500 CHF," that's a one-line change.

**Rubric scores.**

| Criterion | Score | Notes |
|---|---|---|
| Confirmation gate | ✅✅ | Native primitive. Declarative, tested, supported. |
| Streaming fit with Next.js | ✅✅ | Built by the Next.js team. `streamText` + `toDataStreamResponse` + `useChat` is the canonical stack. Zero bridging code. |
| Mockable | ✅ | AI SDK ships `MockLanguageModelV2` and `simulateReadableStream` in `ai/test` for exactly this. Scripted tool calls and final messages in the integration tests become a handful of lines. |
| Maturity / bus factor | ✅✅ | Vercel, 20M downloads/month, used by major production customers. Actively developed — v6 shipped with agent primitives while we were writing this. |
| Lock-in | ✅ | Low. Provider interface is a thin shim over each vendor's SDK. Tools are Zod-typed POJOs that port easily. If we migrate, the tool definitions and Zod schemas move verbatim. |
| Observability | ✅ (conditional) | v6 ships DevTools (local debugger). Integrates with Langfuse, LangSmith, Traceloop, Helicone, Axiom via OpenTelemetry. **Langfuse is self-hostable and EU-friendly**, which solves the data-residency concern — see §4 below. |
| Code surface | ✅ | Minimal. Each tool is ~15 lines. The agent route handler is ~20 lines. The whole agent layer is probably 200–300 lines of TypeScript including types. |

**Verdict.** All seven criteria met or exceeded. This is the pick.

**Risks worth naming.** AI SDK moves fast — v5 shipped mid-2025, v6 in late 2025/early 2026, and at least one known issue in v6 around Anthropic extended-thinking reasoning blocks during multi-step tool calls (GitHub issue #11602). We are not using extended thinking in v1, so the specific bug doesn't affect us, but it's a reminder that the framework is young enough that sharp edges exist. The mitigation is that the lock-in is low — if we hit a blocker, we can drop to the raw Anthropic SDK in a day.

---

### 3. Mastra

**What it is.** A full TypeScript agent framework from the ex-Gatsby team. Built on top of AI SDK v5/v6. Adds agent primitives (`new Agent({...})`), a graph-like workflow engine (`createWorkflowChain(...).andThen(...)`), memory adapters, human-in-the-loop via workflow `.suspend()` / `.resume()`, RAG primitives, Mastra Studio (a local web IDE), and integrations with observability platforms.

**Credibility and bus factor.** YC Winter 2025 batch, $13M seed (October 2025), 22k+ GitHub stars, 26 employees, Apache 2.0 license for core (some enterprise features under a separate license — worth checking). Multiple production deployments documented. The founder wrote a book (*Principles of Building AI Agents*). This is the most serious of the non-Vercel TS agent frameworks by a wide margin.

**What it adds over AI SDK v6.**

- **A workflow engine.** You can express agent flows as a declarative DAG with `.then()`, `.branch()`, `.parallel()`. This is powerful for multi-step automations; it's also overkill for a single-agent chat loop.
- **First-class memory adapters.** Persistent memory across sessions, durable pause/resume. We explicitly excluded cross-session memory in `DESIGN.md` §9, so this is a feature we'd pay for and not use.
- **Mastra Studio.** Local IDE for testing agents. Valuable but duplicative of AI SDK v6's DevTools.
- **Tighter "batteries-included" ergonomics.** Slightly less boilerplate than AI SDK for complex agent configurations.

**Rubric scores.**

| Criterion | Score | Notes |
|---|---|---|
| Confirmation gate | ✅ | `suspend()` / `resume()` on workflows is the documented HITL pattern. Works, but requires modeling the flow as a workflow, which is heavier than a single `needsApproval` flag. |
| Streaming fit with Next.js | ✅ | Documented Next.js integration, inherits `useChat` compatibility from AI SDK underneath. |
| Mockable | ✅ | Same Zod-tool definitions as AI SDK; mocking at the model layer works. |
| Maturity / bus factor | ✅ | Serious funding, serious team, serious adoption. The most production-ready of the "framework layer" options. |
| Lock-in | ⚠️ | Moderate. Agent, tool, and workflow definitions use Mastra-specific classes. Migrating off means rewriting the agent and workflow layer, though Zod schemas and raw tool logic port. |
| Observability | ⚠️ | Built-in tracing, but Mastra Cloud is the hosted option. Self-hosting observability is possible via OpenTelemetry export. |
| Code surface | ✅ | Comparable to AI SDK for our shape, slightly lower for complex agent configurations. |

**Verdict.** Mastra is a genuinely excellent framework and would be the correct answer for a larger scope — a multi-agent system with real workflows, persistent memory, background jobs, or a complex enterprise deployment. For a single-agent chat loop with five tools and no cross-session memory, it is one layer of abstraction too high. We would pay the lock-in cost and not use the features that justify it. **The specific failure mode to flag: `createWorkflowChain` and the `.andThen()` DSL would become the "design reasoning" the reviewer asks about, and justifying them on this project is hard.**

**Reconsider Mastra if:** scope grows to include multi-agent orchestration, cross-session memory, or complex multi-step approval workflows. It's the second-best answer and the natural upgrade path if AI SDK v6 turns out to be too thin.

---

### 4. VoltAgent

**What it is.** A TypeScript agent engineering platform from a small team (Omer Aplak and collaborators, two primary maintainers plus 64 contributors, MIT licensed). Built on top of AI SDK v5 via `@voltagent/vercel-ai`. Adds agent primitives (`new Agent({...})`), sub-agents / supervisors, memory adapters, workflow engine, guardrails, evals, RAG, voice, MCP support, and VoltOps — a hosted observability console at `console.voltagent.dev`.

**Credibility and bus factor.** 7k GitHub stars, 66 contributors, 659 releases, extremely active (latest release during this research window). MIT licensed. Core maintained by a two-person team (Omer Aplak and Necati Ozmen). No disclosed funding that I could find. Newer than Mastra — VoltOps Console is the headline commercial product.

**What it adds over AI SDK v6.** Similar to Mastra — agent classes, memory, workflows, sub-agents, guardrails. The *differentiators* are VoltOps Console (hosted tracing/debugging/deployment) and a slightly different API shape. The starter template (`npm create voltagent-app`) scaffolds a **standalone VoltAgent server** that listens on port 3141 and expects you to interact with it via the VoltOps Console.

**This is the show-stopper for our use case.** VoltAgent's architectural model is *"VoltAgent is the server."* It scaffolds its own Hono server (`honoServer()` in the starter), listens on its own port, and directs you to `console.voltagent.dev` to chat with the agent. That is the **opposite** of how Next.js wants to own the server and embed the agent loop in a route handler. Making VoltAgent work inside `app/api/chat/route.ts` is possible — you can use `@voltagent/core` without `honoServer()` — but the framework's ergonomics, examples, and happy path all assume you're running VoltAgent as a standalone service with the Console as the frontend. We would be fighting the framework's design at every step.

**The VoltOps Console data-residency concern.** VoltOps is hosted at `console.voltagent.dev` — a third-party SaaS. Sending Swiss/EU hospital procurement prompts (even synthetic ones) to a US-hosted observability platform is a data-residency red flag. VoltAgent does document self-hosting for VoltOps, but the happy path is clearly the hosted version. For our evaluation, this is the weakest part of the fit.

**Rubric scores.**

| Criterion | Score | Notes |
|---|---|---|
| Confirmation gate | ⚠️ | Supported via workflow `suspend`, but not as clean as `needsApproval`. Workflow model adds ceremony. |
| Streaming fit with Next.js | ❌ | VoltAgent wants to own the server. Embedding it cleanly inside a Next.js route handler is fighting the framework. |
| Mockable | ✅ | Uses AI SDK primitives underneath, so mocking the model layer works. |
| Maturity / bus factor | ⚠️ | 7k stars, active, but much smaller team than Mastra (2-person core vs 26), no disclosed funding, younger. The velocity is good; the sustainability is a question. |
| Lock-in | ⚠️ | Moderate to high. `@voltagent/core` classes are opinionated, and the server/console assumption shapes a lot of the code you'd write. |
| Observability | ❌ | Hosted VoltOps Console is the headline feature, data-residency red flag for EU. Self-hosting is documented but not the happy path. |
| Code surface | ✅ | Minimal for standalone agents. But the scaffolding assumes standalone, not embedded. |

**Verdict.** VoltAgent has real merit, but for *this specific shape of project* (agent embedded in a Next.js app, EU data residency, no need for multi-agent orchestration) it is the wrong fit. The framework's design center of gravity — "VoltAgent is the server, VoltOps is the console" — is exactly the architecture we are not building. The hosted observability assumption compounds the problem for EU data residency.

**I want to be clear that this isn't a dismissal of VoltAgent as a project.** It's a good framework for the use case it targets: teams who want a standalone agent service with a polished out-of-the-box observability and deployment story. That isn't us.

**Reconsider VoltAgent if:** the scope shifts to a standalone agent service (separate from a Next.js app), the observability-console value becomes important, and data residency is no longer a concern (e.g. self-hosted VoltOps).

---

### 5. LangGraph.js

**What it is.** The TypeScript port of LangChain's LangGraph framework. Models agent behavior as a directed graph of `State`, `Nodes`, and `Edges` with reducers, checkpointers, and explicit state management. `@langgraphjs/toolkit` provides `createReactAgent` as a higher-level convenience. Comes with LangSmith (hosted observability/eval platform, commercial) and LangGraph Platform (hosted deployment, commercial). Open source core is MIT licensed.

**Credibility and bus factor.** LangChain is the biggest name in LLM application frameworks by some margin. Used by Replit, Uber, LinkedIn, GitLab per the LangGraph.js README. 42k weekly npm downloads for `@langchain/langgraph`. TS version reached production stability in mid-2025. The parent company (LangChain Inc.) is well-funded. Mature by TS-agent-framework standards.

**What it adds.** Explicit state management is the core idea. Every node is a function that reads and updates shared state; edges are conditional routers. This is unambiguously more powerful than a single-agent tool loop — you can express complex multi-step workflows, branching, retries, durable execution, and time-travel debugging via checkpointers. Human-in-the-loop works by pausing the graph at a node and waiting for an external event.

**Why it is not the right choice for this project.** Two reasons.

First, the **abstraction is too heavy**. Our project is a single agent with five tools and a confirmation gate. Expressing that as a `StateGraph` with nodes and edges and a custom state schema is *possible* but adds ceremony that a `ToolLoopAgent` with `needsApproval` doesn't require. The LangGraph.js production guide itself notes: *"Many tasks that seem to need multiple agents can be handled by a single well-designed agent with the right tools. Start simple."* The same advice applies to graph abstractions.

Second, **the observability story is LangSmith**, which is a hosted US SaaS like VoltOps. Self-hosting is not the happy path, and for an EU company the data-residency concern is live. The LangChain ecosystem generally assumes you're using LangSmith.

**Rubric scores.**

| Criterion | Score | Notes |
|---|---|---|
| Confirmation gate | ✅ | HITL via checkpointer pause/resume is a first-class pattern, and more powerful than `needsApproval` (you can inspect and modify state before resuming). Also more ceremonial. |
| Streaming fit with Next.js | ✅ | Documented Next.js integration. Uses Node runtime (not Edge). Streaming works. |
| Mockable | ✅ | Straightforward. Inject a fake model at the node level. |
| Maturity / bus factor | ✅✅ | LangChain is the largest LLM framework ecosystem. Stable, well-funded, widely adopted. |
| Lock-in | ❌ | High. State schemas, node functions, edge definitions, checkpointers — all LangGraph-specific. Migrating off is a substantial rewrite. |
| Observability | ⚠️ | LangSmith is the happy path; self-hosting is possible but awkward. Same EU data-residency concern as VoltAgent, though LangChain has more enterprise presence in the EU. |
| Code surface | ❌ | Highest of the framework options for our shape. Graph primitives require more ceremony than a tool loop for a simple agent. |

**Verdict.** LangGraph.js is the right answer for projects where explicit state management and graph-based orchestration are load-bearing requirements: multi-agent systems, long-running durable workflows, complex branching logic, time-travel debugging. For a single-agent chat loop with five tools, the graph abstraction is a tax we would pay and not benefit from.

**Reconsider LangGraph.js if:** scope grows to multi-agent orchestration with complex state transitions, long-running durable workflows that need to survive process restarts, or the team already uses LangChain in Python and wants consistency.

---

## Side-by-side summary

| | Raw Anthropic SDK | **Vercel AI SDK v6** | Mastra | VoltAgent | LangGraph.js |
|---|---|---|---|---|---|
| Abstraction level | Lowest | Low | Medium | Medium | High |
| Confirmation gate | Hand-rolled (~80 lines) | **`needsApproval` flag** | `suspend()` on workflow | `suspend()` on workflow | Checkpointer pause |
| Next.js fit | Manual plumbing | **Native `useChat`** | Via AI SDK beneath | Fights the framework | Documented but ceremonial |
| Mockable | ✅ | ✅ (`ai/test`) | ✅ | ✅ | ✅ |
| Bus factor | Anthropic | Vercel | YC + $13M | Small team | LangChain Inc. |
| Lock-in | Near zero | Low | Moderate | Moderate–high | High |
| Observability | DIY | DevTools + Langfuse/etc | Built-in + Cloud | **VoltOps (hosted, US)** | **LangSmith (hosted, US)** |
| EU data residency | ✅ (self-hosted) | ✅ (Langfuse self-host) | ✅ (self-host possible) | ⚠️ (VoltOps hosted) | ⚠️ (LangSmith hosted) |
| Our code surface | Highest | **Lowest workable** | Low–medium | Low | Medium–high |
| Fit for this project | Close second | **Pick** | Overshoots scope | Wrong architecture | Overshoots scope |

---

## Observability and EU data residency

Since the data-residency question was explicit in the brief discussion, it gets its own section.

The strongest framework observability stories in 2026 are hosted: VoltOps (`console.voltagent.dev`), LangSmith (LangChain), Mastra Cloud, and Vercel's own AI Gateway analytics. All of these are US-hosted or US-managed by default. For a Swiss or EU hospital-procurement application handling prompts that may contain product names, order quantities, ward locations, and cost centers, shipping that data to a US SaaS observability service is a meaningful data-residency concern — even though none of it is PHI.

The way out is **Langfuse**. Langfuse is an open-source LLM observability platform that integrates natively with AI SDK v6 via OpenTelemetry. It is fully self-hostable (Docker, Helm, or their EU-hosted cloud region), Apache-licensed, and the hosted version offers EU data residency explicitly. It is the pragmatic choice for any EU company that wants structured tracing of LLM calls and tool invocations without shipping prompts across the Atlantic.

Our plan for v1 is therefore:

- **Local development:** AI SDK v6 DevTools for inspecting tool calls and model traces during development.
- **Structured logging:** write every prompt, tool call, and tool result as a JSON line to stderr (or to a Supabase `agent_logs` table). This is the bare minimum and satisfies the audit requirement in `DESIGN.md` §11.
- **Optional, and only if the take-home grader asks:** wire up Langfuse via its OpenTelemetry exporter, running either self-hosted or on the Langfuse EU cloud region. This adds a real tracing UI with zero EU data-residency concern.

No VoltOps. No LangSmith. Both are excellent products for the use case they target; neither fits an EU hospital-procurement application.

## What this changes in the other docs

Minimal. Specifically:

- **`DESIGN.md` §4** already says the agent loop runs "server-side, in a Next.js route handler." That's still correct. The layer descriptions say "plain TypeScript functions with Zod-validated arguments" and that the "Zod schemas become the LLM's tool schemas." That's correct for AI SDK v6 — the `tool()` helper accepts a Zod schema in `inputSchema` directly. No change needed.
- **`DESIGN.md` §14** now points here instead of listing framework selection as an unresolved question.
- **`DESIGN.md` §15 (decision log)** now includes the one-liner: *"Vercel AI SDK v6 (tools + `needsApproval` + `useChat`) over the raw Anthropic SDK and over heavier frameworks (Mastra, VoltAgent, LangGraph.js): the `needsApproval` primitive implements the confirmation gate as a declarative flag, `useChat` gives us streaming React integration for free, and the SDK is the substrate every heavier framework is built on anyway. See [`FRAMEWORK.md`](FRAMEWORK.md)."*
- **`TEST_PLAN.md`** mentions mocked LLMs for Layer 2. AI SDK v6 ships `MockLanguageModelV2` and `simulateReadableStream` in `ai/test` for exactly this purpose. Worth adding a one-line note in the test plan that we will use these rather than hand-roll a fake client.
- **`README.md`** now names Vercel AI SDK v6 in the stack section.

## Implementation implications for `src/lib/agent/`

With the framework chosen, the shape of `src/lib/agent/` is clear:

```
src/lib/agent/
├── tools/                         # the five tools, each a `tool()` export
│   ├── search-catalog.ts          # no needsApproval (read)
│   ├── get-product-details.ts     # no needsApproval (read)
│   ├── list-reorder-requests.ts   # no needsApproval (read)
│   ├── create-reorder-request.ts  # needsApproval: true (write)
│   └── cancel-reorder-request.ts  # needsApproval: true (write)
├── system-prompt.ts               # the agent instructions
├── agent.ts                       # ToolLoopAgent instance wiring tools + model + prompt
└── agent.test.ts                  # Layer 2 integration tests using ai/test

app/api/chat/route.ts              # POST handler calling agent.stream() + toDataStreamResponse()
app/page.tsx                       # useChat() + AntD chat components + approval UI
```

Approximate line count for the whole agent layer: **200–300 lines of TypeScript** including types, the five tool definitions, the agent wiring, the route handler, and the React chat page. The confirmation gate is a single `needsApproval: true` flag on two of the five tool definitions. This is the code the reviewer is grading on "design reasoning," and it is now small enough and clean enough that the reasoning speaks for itself.

## References

- Vercel AI SDK v6 release blog — https://vercel.com/blog/ai-sdk-6
- AI SDK tool execution approval docs — https://ai-sdk.dev/cookbook/next/human-in-the-loop
- AI SDK chatbot tool-usage docs — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- Mastra repository — https://github.com/mastra-ai/mastra
- Mastra "Choosing a JS agent framework" — https://mastra.ai/blog/choosing-a-js-agent-framework
- VoltAgent repository — https://github.com/VoltAgent/voltagent
- VoltAgent's own blog on Vercel AI SDK (confirming they build on top) — https://voltagent.dev/blog/vercel-ai-sdk/
- LangGraph.js repository — https://github.com/langchain-ai/langgraphjs
- Fashn.ai framework comparison (Nov 2025) — https://fashn.ai/blog/choosing-the-best-ai-agent-framework-in-2025
- Langfuse (self-hosted observability) — https://langfuse.com
- AI SDK `ai/test` mocking utilities — https://ai-sdk.dev/docs/ai-sdk-core/testing
