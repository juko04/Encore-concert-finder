# Encore Software & Domain Glossary

A beginner-friendly learning guide to the fundamental software engineering, database, and live-music domain concepts used in Encore.

This document serves as the canonical Markdown text for developers, new contributors, and the upcoming interactive **Encore Project Hub / Learning Hub**.

---

## Table of Contents

1. [Software Development & Version Control](#1-software-development--version-control)
   - [Repository](#repository)
   - [Branch](#branch)
   - [Commit](#commit)
   - [Pull Request (PR)](#pull-request-pr)
   - [CI / Continuous Integration](#ci--continuous-integration)
   - [GitHub Actions](#github-actions)
2. [Application Architecture & Languages](#2-application-architecture--languages)
   - [Frontend](#frontend)
   - [Backend](#backend)
   - [API (Application Programming Interface)](#api-application-programming-interface)
   - [TypeScript](#typescript)
   - [Next.js](#nextjs)
   - [Repository Pattern](#repository-pattern)
3. [Databases & Persistence](#3-databases--persistence)
   - [Database](#database)
   - [PostgreSQL](#postgresql)
   - [Supabase](#supabase)
   - [Migration](#migration)
   - [Schema](#schema)
   - [Row](#row)
   - [Primary Key](#primary-key)
   - [Foreign Key](#foreign-key)
   - [UUID (Universally Unique Identifier)](#uuid-universally-unique-identifier)
   - [RLS (Row Level Security)](#rls-row-level-security)
   - [RPC (Remote Procedure Call)](#rpc-remote-procedure-call)
   - [Transaction](#transaction)
   - [Atomicity](#atomicity)
4. [Live-Music Ingestion & Data Pipeline](#4-live-music-ingestion--data-pipeline)
   - [Ingestion](#ingestion)
   - [Crawler](#crawler)
   - [Scraper](#scraper)
   - [Raw Ingest](#raw-ingest)
   - [Event Candidate](#event-candidate)
   - [Canonical Event](#canonical-event)
   - [Provenance](#provenance)
   - [Entity Resolution](#entity-resolution)
   - [Normalized Value](#normalized-value)
   - [Idempotency](#idempotency)
   - [Immutable Observation](#immutable-observation)
5. [Testing & Quality Assurance](#5-testing--quality-assurance)
   - [Unit Test](#unit-test)
   - [Integration Test](#integration-test)
   - [End-to-End (E2E) Test](#end-to-end-e2e-test)

---

## 1. Software Development & Version Control

### Repository

- **Plain-English:** The project folder that contains all the code, documentation, tests, and the entire recorded history of every change made to them.
- **Encore example:** The GitHub repository `juko04/Encore-concert-finder`.
- **Why Encore needs it:** Keeps all contributors and AI coding agents aligned on a single shared source of truth.
- **Technical meaning:** A Git version-control store containing a `.git` database tracking snapshots and commit trees.
- **Where to learn more:** [`project/onboarding.md`](../project/onboarding.md)

### Branch

- **Plain-English:** An isolated workspace where you make and test changes without affecting the working code in the main project.
- **Encore example:** Creating `chore/repository-context-cleanup` to reorganize documentation without touching `main`.
- **Why Encore needs it:** Prevents unfinished work from breaking production or other agents' active coding tasks.
- **Technical meaning:** A lightweight, movable pointer to a specific commit in Git history.
- **Where to learn more:** [`project/agent-collaboration.md`](../project/agent-collaboration.md)

### Commit

- **Plain-English:** A permanent snapshot of your files at a specific moment in time, accompanied by a message explaining why the change was made.
- **Encore example:** `git commit -m "docs: close Phase 1 handoff"`.
- **Why Encore needs it:** Allows rolling back mistakes, auditing changes, and proving which code caused which behavior.
- **Technical meaning:** An immutable Git object containing a tree SHA, parent commit SHAs, author metadata, and a cryptographic hash.
- **Where to learn more:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md)

### Pull Request (PR)

- **Plain-English:** A formal proposal to merge code from one branch into another, allowing team members and automated bots to review and test the changes.
- **Encore example:** Opening a pull request from `feature/canonical-inventory-foundation` to merge into `main`.
- **Why Encore needs it:** Enforces independent code review and automated CI checks before anything touches production.
- **Technical meaning:** A platform-level collaboration mechanism on GitHub that tracks code diffs, discussions, and review statuses.
- **Where to learn more:** [`project/agent-collaboration.md`](../project/agent-collaboration.md)

### CI / Continuous Integration

- **Plain-English:** An automated system that runs your tests, linter, and build commands every time someone proposes changes.
- **Encore example:** Automatically running all 86 unit tests and 21 database integration tests whenever a PR is created.
- **Why Encore needs it:** Catches bugs, security regressions, and broken links immediately before code reaches the user.
- **Technical meaning:** Automated pipeline triggered by webhooks executing verification scripts in a fresh virtual machine.
- **Where to learn more:** [`architecture/testing-and-quality.md`](../architecture/testing-and-quality.md)

### GitHub Actions

- **Plain-English:** GitHub's built-in platform for executing automated tasks, such as testing code, building Docker images, or deploying apps.
- **Encore example:** The workflow defined in `.github/workflows/ci.yml`.
- **Why Encore needs it:** Runs our PostgreSQL and Supabase integration tests on a real cloud runner.
- **Technical meaning:** Cloud orchestration runner defined in YAML executing discrete step actions inside containers or VMs.
- **Where to learn more:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

---

## 2. Application Architecture & Languages

### Frontend

- **Plain-English:** The visual, interactive part of the application that runs directly in the user's web browser on their phone or laptop.
- **Encore example:** The `/discover` page showing event cards with artist names, ticket prices, and venue locations.
- **Why Encore needs it:** Gives music fans an intuitive, beautiful interface to explore shows and personalize preferences.
- **Technical meaning:** React component hierarchy rendered on the server and hydrated in the browser with Tailwind styles.
- **Where to learn more:** [`architecture/overview.md`](../architecture/overview.md)

### Backend

- **Plain-English:** The behind-the-scenes server and database layer that fetches data, runs calculations, secures accounts, and saves records.
- **Encore example:** The crawler jobs that fetch venue calendars, run entity resolution, and write to PostgreSQL.
- **Why Encore needs it:** Protects secrets, runs heavy scheduled tasks, and manages data integrity away from browser tampering.
- **Technical meaning:** Node.js/Next.js server-side route handlers, background worker jobs, and Supabase RPC procedures.
- **Where to learn more:** [`architecture/overview.md`](../architecture/overview.md)

### API (Application Programming Interface)

- **Plain-English:** A standardized digital contract that allows two different computer programs to talk to each other and exchange information.
- **Encore example:** Calling the Ticketmaster Discovery API or Spotify Web API to fetch events or artist metadata.
- **Why Encore needs it:** Connects Encore to the wider music ecosystem without needing to manually copy and paste show data.
- **Technical meaning:** HTTP REST or GraphQL endpoints accepting structured JSON requests and returning structured JSON responses.
- **Where to learn more:** [`architecture/sources.md`](../architecture/sources.md)

### TypeScript

- **Plain-English:** A version of JavaScript that adds strict type checking, catching typos, wrong arguments, and missing properties while you write code.
- **Encore example:** Defining `EventCandidate` so code cannot accidentally use `candidate.eventTime` when the field is named `candidate.startsAt`.
- **Why Encore needs it:** Eliminates entire categories of runtime bugs across thousands of lines of complex ingestion and catalog code.
- **Technical meaning:** Statically typed superset of JavaScript compiled down to plain JavaScript via the `tsc` compiler.
- **Where to learn more:** [`architecture/modules-and-boundaries.md`](../architecture/modules-and-boundaries.md)

### Next.js

- **Plain-English:** A modern web development framework built on top of React that handles routing, server-side rendering, and production builds.
- **Encore example:** The `app/` directory routing, where `app/discover/page.tsx` automatically powers the `/discover` URL.
- **Why Encore needs it:** Enables fast page loading, search-engine indexing, and clean separation between browser and server code.
- **Technical meaning:** Full-stack React framework featuring the App Router, Server Components, and optimized bundler pipelines.
- **Where to learn more:** [`architecture/overview.md`](../architecture/overview.md)

### Repository Pattern

- **Plain-English:** A coding practice where all database query logic is hidden behind simple methods (like `.getById()` or `.create()`) so UI code never runs raw SQL.
- **Encore example:** `SupabaseCatalogRepository` and `MemoryCatalogRepository` implementing the shared `ICatalogRepository` interface.
- **Why Encore needs it:** Allows testing the entire app in memory using fast unit tests without needing a real database running, and keeps UI code clean.
- **Technical meaning:** Domain-driven architectural layer mediating between domain objects and data mapping infrastructure.
- **Where to learn more:** [`architecture/modules-and-boundaries.md`](../architecture/modules-and-boundaries.md)

---

## 3. Databases & Persistence

### Database

- **Plain-English:** An organized, persistent storage system where application data is saved so it isn't lost when the computer restarts.
- **Encore example:** The database storing our tables for `events`, `venues`, `artists`, `event_candidates`, and `profiles`.
- **Why Encore needs it:** Safely stores hundreds of thousands of concert dates, ticket URLs, and user recommendations.
- **Technical meaning:** Relational database management system (RDBMS) ensuring ACID transactional durability.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### PostgreSQL

- **Plain-English:** One of the most powerful, reliable, and battle-tested open-source relational database engines in the world.
- **Encore example:** The specific database engine powering Encore's backend.
- **Why Encore needs it:** Supports advanced JSONB queries, check constraints, partial indexes, and cryptographic UUIDs.
- **Technical meaning:** Enterprise-grade object-relational database management system supporting standard SQL and custom extensions.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### Supabase

- **Plain-English:** An open-source cloud platform built on top of PostgreSQL that provides authentication, APIs, instant local dev tools, and security controls out of the box.
- **Encore example:** Using Supabase local CLI (`supabase start`, `supabase db reset`) to run a real database during CI and local testing.
- **Why Encore needs it:** Gives us enterprise-grade PostgreSQL with zero vendor lock-in and simple local Docker orchestration.
- **Technical meaning:** Backend-as-a-Service architecture pairing PostgreSQL with PostgREST, GoTrue Auth, and local developer toolchains.
- **Where to learn more:** [`architecture/security.md`](../architecture/security.md)

### Migration

- **Plain-English:** A numbered SQL script that makes a specific, repeatable change to your database structure (like adding a table or a column).
- **Encore example:** `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`.
- **Why Encore needs it:** Guarantees that every developer, CI server, and production database has the exact same schema.
- **Technical meaning:** Version-controlled DDL script executed sequentially by migration runners to evolve database schemas.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### Schema

- **Plain-English:** The blueprint or structural design of the database that specifies what tables exist and what columns each table contains.
- **Encore example:** The `events` schema declaring that every event must have a `name`, `timezone`, and `local_start_date`.
- **Why Encore needs it:** Prevents corrupted, incomplete, or malformed data from ever entering the system.
- **Technical meaning:** The collection of tables, columns, data types, indexes, and constraints within a PostgreSQL namespace.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### Row

- **Plain-English:** A single record or item stored in a database table.
- **Encore example:** A row in the `venues` table representing "Red Rocks Amphitheatre".
- **Why Encore needs it:** Each row represents a real-world entity or observation.
- **Technical meaning:** A tuple of typed attribute values conforming to a relation's schema.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### Primary Key

- **Plain-English:** A unique identifier that belongs to only one row in a table, guaranteeing it can never be confused with any other row.
- **Encore example:** The `id` column on the `events` table (e.g. `f47ac10b-58cc-4372-a567-0e02b2c3d479`).
- **Why Encore needs it:** Allows looking up an exact event without ambiguous duplicates.
- **Technical meaning:** A relational constraint enforcing non-null uniqueness on a specified column, backed by a unique B-tree index.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### Foreign Key

- **Plain-English:** A rule that connects a column in one table to the primary key of another table, ensuring references never point to imaginary records.
- **Encore example:** `events.venue_id` linking to `venues.id`.
- **Why Encore needs it:** Guarantees that every concert is connected to a venue that actually exists in the database.
- **Technical meaning:** Referential integrity constraint verifying that values in the referencing table exist in the referenced relation.
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### UUID (Universally Unique Identifier)

- **Plain-English:** A 128-bit random number formatted as text (e.g. `123e4567-e89b-12d3-a456-426614174000`) that is practically guaranteed to be globally unique across the universe.
- **Encore example:** All primary keys in Encore use UUIDs rather than simple numbers like 1, 2, 3.
- **Why Encore needs it:** Allows generating IDs in memory or across multiple distributed scrapers without risking ID collisions or leaking row counts.
- **Technical meaning:** RFC 4122/9562 standard identifier generated via cryptographic random generators (`gen_random_uuid()` or `crypto.randomUUID()`).
- **Where to learn more:** [`architecture/data-model.md`](../architecture/data-model.md)

### RLS (Row Level Security)

- **Plain-English:** Database security rules that inspect who is currently logged in and control exactly which rows they are allowed to read or modify.
- **Encore example:** The rule on `profiles` that says a user can only read and update their own profile, not someone else's.
- **Why Encore needs it:** Prevents malicious users from stealing private user data, saved concerts, or modifying catalog records.
- **Technical meaning:** PostgreSQL engine-level security evaluating `USING` and `WITH CHECK` boolean expressions for each query under current session credentials.
- **Where to learn more:** [`architecture/security.md`](../architecture/security.md)

### RPC (Remote Procedure Call)

- **Plain-English:** A function that runs directly inside the database server and can be invoked from application code with parameters.
- **Encore example:** `apply_canonicalization(payload)`, which saves an entire concert and all its evidence in one step.
- **Why Encore needs it:** Executes complex multi-table logic safely inside the database without network round-trips.
- **Technical meaning:** A stored PL/pgSQL function executed on the database server, callable over PostgREST API with authorization checks.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

### Transaction

- **Plain-English:** A bundle of database operations that either completely succeed together or completely fail together, leaving no halfway state.
- **Encore example:** Inserting a venue, creating an event, linking artists, and recording evidence inside a single transaction.
- **Why Encore needs it:** If inserting an event fails midway, the newly created venue and artist are rolled back so no orphaned junk remains.
- **Technical meaning:** An atomic unit of database execution delineated by `BEGIN` and `COMMIT` or `ROLLBACK`.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

### Atomicity

- **Plain-English:** The "all-or-nothing" rule of transactions: either 100% of the changes happen, or 0% happen.
- **Encore example:** Proving in `catalog-rls.test.ts` that an intentional failure leaves zero orphaned venue or artist rows.
- **Why Encore needs it:** Prevents database corruption when scrapers encounter network errors or bad data.
- **Technical meaning:** The "A" in ACID (Atomicity, Consistency, Isolation, Durability) database guarantees.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

---

## 4. Live-Music Ingestion & Data Pipeline

### Ingestion

- **Plain-English:** The automated process of discovering, downloading, and absorbing event data from external websites and APIs into Encore.
- **Encore example:** Fetching upcoming concerts from a club's calendar page every morning at 4:00 AM.
- **Why Encore needs it:** Live music changes constantly (shows get announced, sell out, or reschedule); ingestion keeps our catalog fresh.
- **Technical meaning:** Extract, Transform, Load (ETL) pipeline capturing external sources into internal domain records.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Crawler

- **Plain-English:** A bot that navigates across web pages or API pagination links to discover and download event listings.
- **Encore example:** Following "Next Page" links on a promoter's website to gather all upcoming dates.
- **Why Encore needs it:** Finds all shows across multi-page calendars without human intervention.
- **Technical meaning:** Automated HTTP agent traversing hyperlinks according to robots policy and crawling limits.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Scraper

- **Plain-English:** A specialized program that extracts specific facts (like show title, date, ticket price, doors time) from the HTML of a webpage.
- **Encore example:** Parsing `<span class="date">Oct 17</span>` into calendar date `2026-10-17`.
- **Why Encore needs it:** Many small clubs and independent venues do not have APIs; scraping is the only way to get their shows.
- **Technical meaning:** Parser extracting structured fields from DOM trees using Cheerio, regex, or JSON-LD schema objects.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Raw Ingest

- **Plain-English:** An exact, untouched copy of the original payload or HTML downloaded from a source, stored alongside a cryptographic hash and timestamp.
- **Encore example:** A row in `raw_ingests` containing the raw JSON response from Ticketmaster or the raw HTML of a venue page.
- **Why Encore needs it:** If a scraper has a bug, we can fix the code and re-parse the raw ingest without having to crawl the external website again.
- **Technical meaning:** Immutable audit record storing source URL, HTTP status, payload hash, timestamp, and content body.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Event Candidate

- **Plain-English:** A parsed, standardized observation of a concert extracted from a raw ingest, representing what that specific source claimed.
- **Encore example:** A row in `event_candidates` stating: "The Mountain Echoes on Oct 15 at Red Rocks Amphitheatre, tickets \$45".
- **Why Encore needs it:** Isolates source-specific quirks before attempting to merge facts into the master catalog.
- **Technical meaning:** Normalized candidate entity linking upstream source identity with raw ingest provenance.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Canonical Event

- **Plain-English:** The single, authoritative, deduplicated concert shown to the user in the app, synthesized from all matching candidate observations.
- **Encore example:** A single card for "The Mountain Echoes Live" combining the accurate start time from the venue and ticket links from Ticketmaster.
- **Why Encore needs it:** Users want to see one show once, not five identical duplicates from five different ticketing sites.
- **Technical meaning:** Master catalog row in `events` table linked to one or more `event_sources` and backed by `event_field_evidence`.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

### Provenance

- **Plain-English:** The complete origin story and audit trail of every fact in the database, proving which source claimed it, when it was seen, and how confident we are.
- **Encore example:** Checking `event_field_evidence` to see that a show was rescheduled because the venue's official website updated on Oct 6.
- **Why Encore needs it:** Prevents untrustworthy or low-quality sources from overwriting accurate information from official venues.
- **Technical meaning:** Fine-grained metadata linking attributes back to source URLs, timestamps, parser versions, and candidate observations.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

### Entity Resolution

- **Plain-English:** The algorithmic process of deciding whether two pieces of information from different sources are talking about the same real-world artist, venue, or concert.
- **Encore example:** Recognizing that "Red Rocks Amphitheater" and "Red Rocks Amphitheatre, Morrison CO" are the exact same place.
- **Why Encore needs it:** Without entity resolution, every scraper run would flood the app with duplicate venues and conflicting shows.
- **Technical meaning:** Identity matching pipeline comparing external IDs, normalized strings, temporal bounds, and billing hierarchies.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

### Normalized Value

- **Plain-English:** A cleaned-up, standardized version of a string or URL stripped of irrelevant differences like casing, punctuation, or tracking codes.
- **Encore example:** Normalizing `"The Mountain Echoes!"` to `"mountain echoes"` and `"https://tix.com?utm_source=fb"` to `"https://tix.com"`.
- **Why Encore needs it:** Allows matching values reliably regardless of formatting quirks.
- **Technical meaning:** Canonical string representation computed via deterministic transformation rules (`normalizeName()`, `normalizeUrl()`).
- **Where to learn more:** [`architecture/modules-and-boundaries.md`](../architecture/modules-and-boundaries.md)

### Idempotency

- **Plain-English:** A property of a system where running the exact same operation multiple times produces the exact same result as running it once, without creating duplicates.
- **Encore example:** Replaying a batch of 50 candidates through `candidateRepo.createMany()` reuses the existing rows instead of inserting 50 duplicates.
- **Why Encore needs it:** Ingestion jobs run repeatedly on cron schedules; duplicate runs must never corrupt the database.
- **Technical meaning:** The property of an operation $f$ where $f(f(x)) = f(x)$.
- **Where to learn more:** [`architecture/ingestion.md`](../architecture/ingestion.md)

### Immutable Observation

- **Plain-English:** The architectural rule that once an observation is recorded, it can never be edited or deleted—only new observations can be added.
- **Encore example:** If a show moves from Oct 15 to Oct 17, we do not update the old candidate row; we record a new candidate row under the new raw crawl.
- **Why Encore needs it:** Preserves complete history so we can see how show times, prices, and lineups changed over time.
- **Technical meaning:** Append-only persistence pattern for source data points, avoiding destructive in-place updates.
- **Where to learn more:** [`architecture/entity-resolution.md`](../architecture/entity-resolution.md)

---

## 5. Testing & Quality Assurance

### Unit Test

- **Plain-English:** A fast, isolated test that verifies a single function or class works correctly without talking to external networks or real databases.
- **Encore example:** Testing that `deriveLocalDateFromInstant("2026-10-15T02:00:00Z", "America/Denver")` correctly produces `"2026-10-14"`.
- **Why Encore needs it:** Runs in milliseconds, giving immediate feedback on logic errors during development.
- **Technical meaning:** Test executing against in-memory mocks validating deterministic input/output behavior.
- **Where to learn more:** [`architecture/testing-and-quality.md`](../architecture/testing-and-quality.md)

### Integration Test

- **Plain-English:** A test that verifies multiple real subsystems (like our repository code, SQL queries, and PostgreSQL check constraints) work together properly.
- **Encore example:** `tests/integration/golden-path.test.ts`, which runs the real crawler output through PostgreSQL and verifies composite foreign keys.
- **Why Encore needs it:** Proves that code works with real database constraints rather than trusting fake mocks.
- **Technical meaning:** Test exercising boundary contracts between application runtime and external infrastructure (e.g. Supabase Docker container).
- **Where to learn more:** [`architecture/testing-and-quality.md`](../architecture/testing-and-quality.md)

### End-to-End (E2E) Test

- **Plain-English:** A test that boots up the whole application and uses an automated browser to click, scroll, and verify the user experience just like a real person.
- **Encore example:** Playwright opening the browser, navigating to `/discover`, and verifying that the page title and event cards render properly.
- **Why Encore needs it:** Ensures that frontend styles, server rendering, and browser hydration are working smoothly.
- **Technical meaning:** Browser automation suite (Playwright) driving a headless browser against a compiled production server build.
- **Where to learn more:** [`architecture/testing-and-quality.md`](../architecture/testing-and-quality.md)
