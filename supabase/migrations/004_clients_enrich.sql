-- Rename brand_voice → tone_of_voice and add full client config columns

alter table clients rename column brand_voice to tone_of_voice;

alter table clients
  add column if not exists audience          text not null default '',
  add column if not exists visual_config     jsonb not null default '{
    "primary_color": "#000000",
    "secondary_color": "#ffffff",
    "accent_color": "#ff6b35",
    "font": "Inter",
    "template_style": "clean_white",
    "logo_url": null
  }'::jsonb,
  add column if not exists post_config       jsonb not null default '{}'::jsonb,
  add column if not exists buffer_access_token text not null default '';

comment on column clients.tone_of_voice is
  'Full brand voice guidelines: persona, writing style, dos/donts, example phrases';

comment on column clients.audience is
  'Who this client is talking to — used to tailor every piece of content';

comment on column clients.visual_config is
  'Brand visual identity: primary_color, secondary_color, accent_color, font, template_style, logo_url';

comment on column clients.post_config is
  'Per-platform post counts and types. Example:
   {
     "instagram":  {"posts": 3, "carousels": 1},
     "linkedin":   {"posts": 2},
     "x":          {"posts": 3, "threads": 1},
     "facebook":   {"posts": 2},
     "tiktok":     {"captions": 3},
     "youtube":    {"descriptions": 1, "community_posts": 2}
   }';

comment on column clients.buffer_access_token is
  'Client-specific Buffer OAuth access token';
