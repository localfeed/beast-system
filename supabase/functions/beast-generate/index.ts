import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude } from '../_shared/claude.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (req.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { submission_id, transcript, video_title, video_duration_s } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: submission, error } = await supabase
      .from('submissions')
      .select('*, clients(*)')
      .eq('id', submission_id)
      .single();

    if (error || !submission) throw new Error('Submission not found');

    const client = submission.clients;

    await supabase.from('submissions').update({
      status: 'processing',
      transcript,
      video_title,
      video_duration_s,
    }).eq('id', submission_id);

    const outputs = await generateAllOutputs({
      client,
      submission_id,
      transcript,
      video_title,
      video_duration_s,
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
    });

    await supabase.from('submission_outputs').insert(outputs);

    // Hand off to beast-publish
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    await fetch(`${supabaseUrl}/functions/v1/beast-publish`, {
      method: 'POST',
      headers: {
        'x-webhook-secret': webhookSecret!,
        'content-type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({ submission_id }),
    });

    return new Response(
      JSON.stringify({ ok: true, outputs_count: outputs.length }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});

// ---------------------------------------------------------------------------

async function generateAllOutputs(opts: {
  client: any;
  submission_id: string;
  transcript: string;
  video_title: string;
  video_duration_s: number;
  apiKey: string;
}) {
  const { client, submission_id, transcript, video_title, video_duration_s, apiKey } = opts;

  const postConfig: Record<string, Record<string, number>> = client.post_config ?? {};
  const shortsConfig = client.shorts_config ?? {};
  const visualConfig = client.visual_config ?? {};

  const maxShorts = shortsConfig.max_shorts ?? 5;
  const shortsDuration = shortsConfig.target_duration_seconds ?? 60;
  const shortsOutputPlatforms: string[] = shortsConfig.platforms ?? ['tiktok', 'instagram_reels', 'youtube_shorts'];

  const durationMin = Math.floor(video_duration_s / 60);
  const durationSec = video_duration_s % 60;

  // Build the per-platform post spec for Claude
  const postSpec = buildPostSpec(postConfig, client.active_platforms ?? []);

  const system = buildSystemPrompt(client);
  const user = buildUserPrompt({
    videoTitle: video_title,
    durationMin,
    durationSec,
    transcript,
    postSpec,
    maxShorts,
    shortsDuration,
    shortsOutputPlatforms,
    visualConfig,
  });

  const raw = await callClaude({ system, user, apiKey, maxTokens: 8192 });

  const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/(\{[\s\S]*\})/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : raw);

  const outputs: any[] = [];

  for (const post of parsed.written_posts ?? []) {
    outputs.push({
      submission_id,
      output_type: 'written_post',
      platform: post.platform,
      slot_id: post.slot_id,
      content: post.content,
      metadata: { post_type: post.post_type ?? 'post' },
    });
  }

  for (const visual of parsed.visual_assets ?? []) {
    outputs.push({
      submission_id,
      output_type: 'visual_asset',
      platform: visual.platform,
      slot_id: visual.slot_id,
      content: visual.content,
      metadata: visual.metadata ?? {},
    });
  }

  if (parsed.shorts_breakdown) {
    outputs.push({
      submission_id,
      output_type: 'shorts_breakdown',
      platform: null,
      slot_id: 'shorts_breakdown',
      content: parsed.shorts_breakdown.content,
      metadata: parsed.shorts_breakdown.metadata ?? {},
    });
  }

  return outputs;
}

function buildSystemPrompt(client: any): string {
  const visual = client.visual_config ?? {};
  return `You are the Beast System content engine for ${client.name}.

## Client
**Name:** ${client.name}
**Audience:** ${client.audience || 'Not specified'}

## Tone of Voice
${client.tone_of_voice || 'Professional, clear, and engaging.'}

## Visual Identity
- Primary colour: ${visual.primary_color ?? '#000000'}
- Accent colour: ${visual.accent_color ?? '#ff6b35'}
- Template style: ${visual.template_style ?? 'clean_white'}
- Font: ${visual.font ?? 'Inter'}

Always write as if you deeply understand this brand. Every piece of content must feel native to their world — their audience should never feel like it was produced by a generic tool.`;
}

function buildUserPrompt(opts: {
  videoTitle: string;
  durationMin: number;
  durationSec: number;
  transcript: string;
  postSpec: string;
  maxShorts: number;
  shortsDuration: number;
  shortsOutputPlatforms: string[];
  visualConfig: any;
}): string {
  return `Video: "${opts.videoTitle}" (${opts.durationMin}m ${opts.durationSec}s)

TRANSCRIPT:
${opts.transcript}

---
Generate a JSON object with this exact structure:

{
  "written_posts": [
${opts.postSpec}
  ],
  "visual_assets": [
    // For each platform that supports visuals (instagram carousel, linkedin slides, facebook carousel)
    // produce 1-2 visual concepts with slide breakdowns
    {
      "platform": "instagram",
      "slot_id": "instagram_carousel_1",
      "content": "Caption for the visual post. Make it native to the platform.",
      "metadata": {
        "visual_type": "carousel",
        "template_style": "${opts.visualConfig.template_style ?? 'clean_white'}",
        "primary_color": "${opts.visualConfig.primary_color ?? '#000000'}",
        "accent_color": "${opts.visualConfig.accent_color ?? '#ff6b35'}",
        "slide_count": 5,
        "slide_topics": ["Hook slide topic", "Slide 2 topic", "Slide 3 topic", "Slide 4 topic", "CTA slide"]
      }
    }
  ],
  "shorts_breakdown": {
    "content": "# Shorts Production Brief\\n\\n## Video: \\"${opts.videoTitle}\\"\\n\\n[Full markdown editor brief — written for a video editor. Include overview, each short with precise cut instructions, text overlay suggestions, music mood, and thumbnail concept.]",
    "metadata": {
      "total_shorts": ${opts.maxShorts},
      "shorts": [
        {
          "number": 1,
          "title": "Short title",
          "start_time": "MM:SS",
          "end_time": "MM:SS",
          "duration_s": ${opts.shortsDuration},
          "hook": "The exact first 3 seconds — what the viewer sees and hears",
          "key_moments": ["MM:SS — description of cut or moment"],
          "caption": "Ready-to-post caption for this short",
          "hashtags": "#tag1 #tag2 #tag3",
          "output_platforms": ${JSON.stringify(opts.shortsOutputPlatforms)},
          "editor_notes": {
            "cuts": "Specific cut instructions",
            "text_overlays": ["Overlay text at MM:SS", "Overlay text at MM:SS"],
            "transitions": "Transition style recommendations",
            "music_mood": "Energy level and mood description",
            "thumbnail_concept": "What the thumbnail should show"
          }
        }
      ]
    }
  }
}

Return only valid JSON. No markdown fences needed.`;
}

function buildPostSpec(postConfig: Record<string, Record<string, number>>, activePlatforms: string[]): string {
  const lines: string[] = [];

  const platformLabels: Record<string, string> = {
    instagram: 'Instagram',
    linkedin: 'LinkedIn',
    x: 'X (Twitter)',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    youtube: 'YouTube',
  };

  for (const platform of activePlatforms) {
    const config = postConfig[platform] ?? {};
    const label = platformLabels[platform] ?? platform;

    for (const [postType, count] of Object.entries(config)) {
      for (let i = 1; i <= (count as number); i++) {
        lines.push(`    // ${label} — ${postType} #${i}`);
        lines.push(`    { "platform": "${platform}", "slot_id": "${platform}_${postType}_${i}", "post_type": "${postType}", "content": "Full ${postType} copy here. Optimised for ${label}." }`);
      }
    }

    // Fallback: if platform has no config, generate 1 default post
    if (Object.keys(config).length === 0) {
      lines.push(`    // ${label} — default post`);
      lines.push(`    { "platform": "${platform}", "slot_id": "${platform}_post_1", "post_type": "post", "content": "Full post copy here. Optimised for ${label}." }`);
    }
  }

  return lines.join('\n');
}
