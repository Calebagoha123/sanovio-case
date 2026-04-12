# Design Docs

These documents capture the reasoning behind the v1 reorder-agent implementation and the intended path into a more production-ready v2.

## What To Read First

- [`DESIGN.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/DESIGN.md)
  Product scope, architectural decisions, safety boundaries, and tradeoffs.

- [`SEARCH.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/SEARCH.md)
  Search strategy, ranking choices, and the proposed growth path from v1 lexical retrieval to hybrid retrieval.

- [`TEST_PLAN.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/TEST_PLAN.md)
  Test philosophy and layered coverage plan.

- [`FRAMEWORK.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/FRAMEWORK.md)
  Why the AI SDK / agent-loop setup was chosen.

## Current Implementation Status

The repository now includes a working v1 implementation:

- Next.js 16 frontend and chat route
- AI SDK agent loop with approval-gated writes
- Supabase-backed catalog and reorder persistence
- Structured UI rendering for search results, product details, and approval previews
- Deterministic date and unit validation
- Streaming responses and basic backend observability

Some of the longer design docs still discuss future work. Treat those sections as roadmap material, not as statements that the repo is unimplemented.

## Where The Docs Still Point Forward

The codebase is intentionally still missing several production concerns:

- authentication and authorization
- multi-user tenancy
- production SLOs and alerting
- benchmark harnesses and large-scale synthetic-load testing
- hybrid retrieval / reranking backend

Those are the right topics to cover in the follow-up systems design discussion.
