create type output_type as enum (
  'written_post',      -- text post for a social platform
  'visual_asset',      -- caption + style for a visual card/carousel
  'shorts_breakdown'   -- video editor instructions doc (one per submission)
);

create type buffer_status as enum (
  'pending',
  'scheduled',
  'failed',
  'skipped'            -- no Buffer profile configured for this platform
);

create table submission_outputs (
  id               uuid primary key default uuid_generate_v4(),
  submission_id    uuid not null references submissions(id) on delete cascade,
  output_type      output_type not null,
  platform         text,                  -- null for shorts_breakdown (not platform-specific)
  slot_id          text,                  -- e.g. 'instagram_post_1', 'linkedin_post_1'
  content          text not null,         -- full text of the post or breakdown doc
  metadata         jsonb not null default '{}',
  buffer_status    buffer_status not null default 'pending',
  buffer_update_id text,
  created_at       timestamptz not null default now()
);

create index on submission_outputs (submission_id);
create index on submission_outputs (buffer_status) where buffer_status = 'pending';
