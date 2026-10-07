# 13 — Agent Collaboration

## Goal

Use the local Git repository + GitHub as the durable shared workspace between humans and multiple AI coding agents, including ChatGPT Personal, Antigravity, and Claude.

Do not rely on one model's chat history as project memory.

## Recommended source of truth

```text
GitHub repository
  ├── code
  ├── issues
  ├── pull requests
  ├── README.md
  ├── AGENTS.md
  └── docs/
```

Every agent should read the repository before making changes. The recommended default roles are ChatGPT Personal for architecture/review, Antigravity for primary implementation, and Claude for independent review/testing/risk analysis.

## Recommended workflow

### 1. Architecture/product work
Use ChatGPT for:
- product decisions
- architecture reviews
- research
- ranking design
- schema reasoning
- debugging strategy
- code review

### 2. Implementation
Use either Codex or Antigravity for repository-level implementation:
- create/edit files
- run tests
- run build/typecheck
- browser-test flows
- refactors

### 3. GitHub carries the conversation
For any meaningful task, create/update one of:
- GitHub issue
- implementation plan in PR description
- architecture doc
- ADR/decision entry

Agent A does not need to literally chat with Agent B if both can read the same explicit task/state.

## Branch pattern

```text
main
feature/ticketmaster-ingestion
feature/spotify-affinity
feature/festival-schema
fix/cervantes-parser
```

Keep concurrent agents on different branches/worktrees where possible.

## Handoff template

When one agent hands work to another, leave a concise note:

```text
Goal:
What changed:
Files changed:
Tests run:
Known problems:
Next recommended action:
Relevant issue/PR:
```

This can be a PR description, issue comment, or `HANDOFF.md` for temporary work.

## Direct agent-to-agent communication

The most reliable initial setup is shared state rather than direct conversational control:

```text
ChatGPT/Codex <-> GitHub repo/issues/PRs <-> Antigravity
```

This is auditable and keeps the human in control.

## MCP

Model Context Protocol (MCP) can connect agents to shared tools/services. Antigravity supports MCP. If both environments can access the same GitHub/project-management/database tooling, they can operate on shared external state.

However, MCP does not inherently mean one AI model "controls" another model. A direct agent-to-agent bridge would require a purpose-built service/API/MCP server that exposes one agent as a callable tool to the other, plus authentication, permissions, and guardrails.

That is unnecessary for MVP development and creates extra complexity.

## Recommended practical setup

Start with:

1. GitHub repo as source of truth.
2. `AGENTS.md` shared rules.
3. GitHub issues for tasks.
4. One branch per task/agent.
5. Pull requests for review/handoff.
6. CI checks before merge.

Later, add MCP integrations for useful shared tools such as:
- GitHub
- Supabase/database inspection
- deployment logs
- issue tracker

## Human control

Do not let multiple agents push to `main` without review while the project is young.

Require pull requests for meaningful changes until the codebase and tests are mature.
