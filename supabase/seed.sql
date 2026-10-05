-- Phase 1: Deterministic seed data.
-- Inserts baseline source registry records for local testing and verification.

insert into public.sources (
  id,
  slug,
  name,
  source_type,
  acquisition_method,
  base_url,
  reliability_score,
  active,
  parser_version
) values (
  'a0000000-0000-0000-0000-000000000001',
  'fake-venue-adapter',
  'Fake Venue Source Adapter',
  'venue',
  'structured_json',
  'https://venue.example.com',
  0.95,
  true,
  '1.1.0'
) on conflict (slug) do nothing;
