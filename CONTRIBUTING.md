# Contributing

## Source of truth

The Git repository is the durable project record. Product or architecture decisions made in chat should be written into the appropriate document before they are treated as settled project behavior.

## Branches

Use focused branches, for example:

- `chore/bootstrap-foundation`
- `feature/ticketmaster-ingestion`
- `feature/spotify-affinity`
- `feature/festival-schema`
- `fix/event-deduplication`

Avoid multiple agents editing the same branch at the same time.

## Before coding

- Read `AGENTS.md`.
- Read `docs/index.md` and relevant specification document(s).
- Check `AI_HANDOFF.md` for active work.
- Confirm the task has a clear scope and acceptance criteria.

## Before requesting merge

Run the checks appropriate to the repository once they exist:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Add or update tests for changed behavior.

## Documentation

Update documentation when a change alters:

- architecture
- data model
- source strategy
- public/internal API contracts
- recommendation behavior
- security/privacy behavior
- project roadmap

Record major approved architectural decisions in `docs/decisions/index.md`.

## Secrets

Never commit credentials, API keys, OAuth secrets, session cookies, private user exports, or `.env.local`.

Use `.env.example` for variable names and non-secret descriptions only.
