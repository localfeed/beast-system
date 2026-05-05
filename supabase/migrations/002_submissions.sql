create type submission_status as enum (
  'pending',     -- just received, queued for processing
  'processing',  -- GitHub Actions job running
  'done',        -- all outputs generated and sent to Buffer
  'failed'       -- processing error
);

create table submissions (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  video_url        text not null,
  status           submission_status not null default 'pending',
  video_title      text,
  video_duration_s int,                -- total duration in seconds
  transcript       text,               -- raw timestamped transcript
  error_message    text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);

create index on submissions (client_id, created_at desc);
create index on submissions (status) where status = 'pending';
