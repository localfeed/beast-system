export interface Client {
  id: string;
  slug: string;
  name: string;
  brand_voice: string;
  active_platforms: string[];
  buffer_profiles: Record<string, string>;
  shorts_config: {
    max_shorts?: number;
    target_duration_seconds?: number;
  };
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

export interface GeneratePayload {
  submission_id: string;
  webhook_secret: string;
}

export interface PublishPayload {
  submission_id: string;
  webhook_secret: string;
}
