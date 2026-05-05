create extension if not exists "uuid-ossp";

create table clients (
  id              uuid primary key default uuid_generate_v4(),
  slug            text unique not null,          -- used in submission URL: /submit/{slug}
  name            text not null,
  brand_voice     text not null default '',      -- Claude instructions for this client's tone/style
  active_platforms text[] not null default '{}', -- e.g. ['instagram','tiktok','linkedin','x','youtube','facebook']
  buffer_profiles jsonb not null default '{}',   -- { "instagram": "buffer_profile_id", ... }
  shorts_config   jsonb not null default '{}',   -- { "max_shorts": 5, "target_duration_seconds": 60 }
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on clients (slug);

-- auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at
  before update on clients
  for each row execute function set_updated_at();
