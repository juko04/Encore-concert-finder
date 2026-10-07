# Encore Documentation Map

This document is the authoritative directory and context router for the Encore codebase. It points human contributors and AI coding agents directly to the canonical source of truth for each subsystem.

---

## Current Operational State

- **Active Operational Handoff:** [`AI_HANDOFF.md`](../AI_HANDOFF.md)  
  *Always read this first for current branch, active tasks, test results, blockers, and next steps.*
- **AI Agent Guidelines:** [`AGENTS.md`](../AGENTS.md)  
  *Non-negotiable engineering invariants, context-routing rules, and testing requirements.*
- **Human Contribution Guide:** [`CONTRIBUTING.md`](../CONTRIBUTING.md)

---

## Product & Domain Context

- **Product Vision & User Jobs:** [`product/vision.md`](product/vision.md)  
  *Core user problems, product modes (Tonight, Cheap & Nearby, Worth Planning For, Festivals), and UI views.*
- **Origin & Intent Context:** [`product/context.md`](product/context.md)  
  *Origin of the idea, personalization signals, willingness-to-pay philosophy, and source landscape.*
- **Recommendation Philosophy:** [`product/recommendation-philosophy.md`](product/recommendation-philosophy.md)  
  *Transparent, explainable ranking formula, tunable scoring weights, and affinity features.*
- **Festivals & Multi-Day Shows:** [`product/festivals.md`](product/festivals.md)  
  *First-class multi-day modeling, lineup depth, day passes vs. weekend passes.*
- **Alerts & Watchlists:** [`product/alerts-and-watchlists.md`](product/alerts-and-watchlists.md)  
  *Artist tracking, on-sale notifications, price drops, and lineup changes.*
- **Future Features & Email Ingestion:** [`product/future-features.md`](product/future-features.md)  
  *Deferred features, including promoter newsletter/email ingestion strategy.*

---

## Architecture & System Design

- **System Architecture Overview:** [`architecture/overview.md`](architecture/overview.md)  
  *High-level components, services, Next.js frontend, worker processes, and Supabase backend.*
- **Canonical Data Model:** [`architecture/data-model.md`](architecture/data-model.md)  
  *PostgreSQL schema, canonical tables (`events`, `artists`, `venues`), constraints, and relationships.*
- **Ingestion & Crawling Pipeline:** [`architecture/ingestion.md`](architecture/ingestion.md)  
  *Source adapters, HTTP fetching, Cheerio/Playwright rules, immutable raw ingests, and candidate extraction.*
- **Entity Resolution & Canonicalization:** [`architecture/entity-resolution.md`](architecture/entity-resolution.md)  
  *Artist/venue identity resolution, external ID precedence, event matching, field-level merging, and atomic canonicalization.*
- **Source Registry & Strategy:** [`architecture/sources.md`](architecture/sources.md)  
  *Categorization of ticketing APIs, aggregators, venues, promoters, and festivals.*
- **Security, Auth & Compliance:** [`architecture/security.md`](architecture/security.md)  
  *Supabase Auth, Row Level Security (RLS) policies, `service_role` isolation, and robots/scraping boundaries.*
- **Module Plan & Boundaries:** [`architecture/modules-and-boundaries.md`](architecture/modules-and-boundaries.md)  
  *Domain types, repository abstractions, server vs. browser boundaries, and dependency flow.*
- **Testing & Quality Assurance:** [`architecture/testing-and-quality.md`](architecture/testing-and-quality.md)  
  *Unit test suites, fixture-based parsing, local vs. CI database integration tests, and golden-path verification.*

---

## Implementation Phases

- **Completed Historical Phases:** [`phases/completed/`](phases/completed/)
  - [Phase 0 — Foundation & Infrastructure](phases/completed/PHASE_0_IMPLEMENTATION.md)
  - [Phase 1 — Canonical Inventory & Ingestion Foundation](phases/completed/PHASE_1_IMPLEMENTATION.md)
- **Active / Upcoming Phases:** [`phases/active/`](phases/active/)
  - *Active phase slot (currently awaiting Phase 2 kickoff following Learning Hub)*

---

## Decisions & Architecture Decision Records (ADRs)

- **Consolidated Decision Log:** [`decisions/index.md`](decisions/index.md)  
  *Settled architectural decisions, accepted tradeoffs, and unresolved product questions.*

---

## Project Operations & Management

- **Roadmap & Phase Breakdown:** [`project/roadmap.md`](project/roadmap.md)  
  *Phase 0 through Phase 5 scope, milestones, and deliverables.*
- **AI Agent Collaboration Model:** [`project/agent-collaboration.md`](project/agent-collaboration.md)  
  *Multi-agent workflow, branch ownership rules, and asynchronous handoffs.*
- **AI Starter Prompts:** [`project/ai-start-prompts.md`](project/ai-start-prompts.md)  
  *Prompts for bootstrapping ChatGPT, Antigravity, and Claude.*
- **Onboarding Guide:** [`project/onboarding.md`](project/onboarding.md)  
  *Initial repository orientation.*
- **GitHub Setup Guide:** [`project/github-setup.md`](project/github-setup.md)  
  *Initial repository provisioning notes.*
- **MVP Acceptance Criteria:** [`project/mvp-acceptance-criteria.md`](project/mvp-acceptance-criteria.md)  
  *Core deliverables required for release.*
- **Non-Blocking Debt & Cleanup Items:** [`project/non-blocking-debt.md`](project/non-blocking-debt.md)  
  *Post-Phase-1 non-blocking cleanup registry and future improvements.*

---

## Learning & Educational Resources

- **Beginner & Conceptual Glossary:** [`learning/glossary.md`](learning/glossary.md)  
  *Plain-English explanations, Encore examples, and technical definitions for 30+ core software and live-music concepts.*
- **Encore Project Hub / Learning Hub:** *Upcoming interactive documentation and entity visualization portal (planned next).*
