# PR review fixes — QA log (Agent 4, Phase 1)

Baseline: branch fix/ui-discover-auth-v2, commit 9607682 (git archive copy, fresh `npm ci`, Linux VM).

## Baseline results (executed)
| Check | Result |
|---|---|
| `tsc --noEmit` | PASS (exit 0) |
| `vitest run` (unit) | PASS — 78 files, 1035 tests |
| `eslint .` | FAIL (exit 1) — 35 errors / 29 warnings, ALL in test files + `next-env.d.ts` (no product-source errors); not caused by this PR's source |
| `prettier --check .` | FAIL — only 5 scraped HTML fixtures in tests/fixtures (parse errors) |
| `test:integration` | 5 failed / 93 passed / 27 skipped — needs local Supabase/Postgres, unreachable from VM; NOT a valid result |
| `test:e2e` (Playwright) | NOT RUN — `playwright install chromium` download failure in VM |
| SQL / migration tests | NOT RUN — no Docker/psql in VM |

## Regression tests (tests/regression, run: `npx vitest run --config tests/regression/vitest.config.ts`)
Baseline (9607682): 9 of 13 FAIL + card-features file fails to load (EventImage.tsx absent). Working tree snapshot (other agents' in-progress edits): 13 of 16 pass.
| Test | Baseline | Working tree |
|---|---|---|
| search-uri-too-long (list/count/page 2, q="a") | FAIL x3 "URI too long" | PASS |
| search-startdate-leak (3 cases) | FAIL x3 | PASS |
| startdate-leak: historical startDate still allowed | PASS | FAIL (fix forces excludePastShowtimes always; repo then treats past fromDate as "today" -> drops that day's earlier shows) — review |
| genre: reggaeton -> latin | FAIL (classified 'reggae') | PASS |
| genre: dislike beats similarity / reggaeton≠techno | PASS | PASS |
| discover: See-all hrefs keep filters | PASS | PASS |
| discover: cross-row duplication <= 25% (pool of 80 identical results) | FAIL (60%) | FAIL (60%) |
| SearchClient controls re-sync on prop change | FAIL | FAIL (still stale) |
| card image cascade event->artist->venue->graphic | FAIL (module missing) | PASS |
Not yet covered: apply_canonicalization/migrations (needs Postgres), city restore cookie->profile, venue selector, verified sold-out chips, pagination across sorts (needs real DB).

## Manual browser (localhost/127.0.0.1:3000)
- Broad search `q=a` page 1 & 2: FAIL on baseline (HTTP 500 URI too long). `q=the`, `q=Ogden`, sort=price_asc page 2: PASS.
- `/search?startDate=2026-11-24&endDate=2026-11-24` (375px): PASS renders 3 shows; NOTE a "Cancelled" show is listed in normal results.
- Console: transient Header.tsx syntax error from an in-progress edit (not a product bug once fixed); re-verify in Phase 2.
- Login/invite-only, password reset, Spotify, 768/1280 layouts, Load More: NOT RUN (Phase 2).

## Phase 2 — independent verification of e2c75ea (fresh `git archive` copy)
- tsc PASS; vitest unit 88 files / 1177 tests PASS; tests/regression 5 files / 16 tests PASS.
- eslint 35 errors / 29 warnings (unchanged from baseline; only tests + next-env.d.ts). prettier: same 5 HTML fixtures + 2 new `tests/sql/*.mjs` files unformatted.
- Integration, Playwright, SQL migration scripts: NOT RUN (VM has no Docker/Chromium/Postgres).
- Live (Mac dev server, real local data, 173 events): `q=a` p1/p2 200 (totalCount 173), page=500 -> 200 empty hasMore=false; bad startDate/minPrice -> 400; Tonight URL returns only same-day shows; homepage chip + See-all hrefs keep date/free/genre filters; mobile 375 menu opens (Close button, nav links); 768 /search renders; /login (invite-only magic link + password tab + Forgot password) and /login/reset-password render; /search with garbage dates renders.
- NOT RUN live: client-side navigation control re-sync (value of search box), sold-out/low-inventory chips against verified data, image fallback with real 404 images, signed-in flows, Spotify.
