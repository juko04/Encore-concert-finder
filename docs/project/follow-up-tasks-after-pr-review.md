# Follow-up tasks deferred from the PR review-fix pass

Deliberately NOT part of branch `fix/ui-discover-auth-v2` (demo scope freeze).

1. **Calendar tab** - month/agenda view of upcoming and saved shows.
2. **Saved-show ticker** - lightweight strip of saved shows on the Discover home.
3. **Personal reviews** - per-user show/venue notes and ratings.
4. **Decision: hide cancelled shows on `/search`?** Homepage hides them; search shows them with a Cancelled badge.
5. **Decision: persist Spotify-imported artists** (e.g. into `user_artist_preferences`)? Today the signal is an in-memory cache, lost on token expiry/cold start. Architecture change.
6. **Search performance:** broad text queries issue ~25 bounded sub-queries per page; an RPC or search-vector column would be better (`supabase/**`).
7. **Venue chips** should link by `venueId` (needs a field on `DiscoverChip`) instead of name substring.
8. **/search location-awareness:** no scoring path there today.
9. `apply_canonicalization` is `security definer` without `set search_path` (pre-existing); harden in its own migration.
10. Unify "Official Tickets" vs "Tickets" labels (needs test updates).
