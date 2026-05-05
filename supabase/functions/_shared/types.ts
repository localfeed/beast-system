export interface VisualConfig {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font: string;
  template_style: string;
  logo_url: string | null;
}

export interface ShortsConfig {
  max_shorts: number;
  target_duration_seconds: number;
  platforms: string[];
}

export interface PostConfig {
  [platform: string]: {
    [postType: string]: number; // e.g. { posts: 3, carousels: 1 }
  };
}

export interface Client {
  id: string;
  slug: string;
  name: string;
  audience: string;
  tone_of_voice: string;
  visual_config: VisualConfig;
  active_platforms: string[];
  buffer_profiles: Record<string, string>;
  buffer_access_token: string;
  post_config: PostConfig;
  shorts_config: ShortsConfig;
}

export interface Submission {
  id: string;
  client_id: string;
  video_url: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  video_title?: string;
  video_duration_s?: number;
  transcript?: string;
  error_message?: string;
  created_at: string;
  processed_at?: string;
}

export interface SubmissionOutput {
  id: string;
  submission_id: string;
  output_type: 'written_post' | 'visual_asset' | 'shorts_breakdown';
  platform?: string;
  slot_id?: string;
  content: string;
  metadata: Record<string, unknown>;
  buffer_status: 'pending' | 'scheduled' | 'failed' | 'skipped';
  buffer_update_id?: string;
}
