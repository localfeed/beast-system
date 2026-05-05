-- Row Level Security: wall off client data completely
-- Edge functions run with service_role which bypasses RLS.
-- RLS protects against accidental leaks from anon/authenticated roles.

alter table clients           enable row level security;
alter table submissions       enable row level security;
alter table submission_outputs enable row level security;

-- Service role bypasses RLS automatically in Supabase.
-- These policies cover any future authenticated (dashboard) use.

-- Clients: only service role reads/writes (no client-facing dashboard yet)
create policy "service_role_only" on clients
  using (false);  -- deny all by default; service_role bypasses this

-- Submissions: scoped by client_id
create policy "service_role_only" on submissions
  using (false);

-- Outputs: scoped by submission → client
create policy "service_role_only" on submission_outputs
  using (false);
