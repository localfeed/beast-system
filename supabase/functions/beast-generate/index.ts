// beast-generate: called by GitHub Actions after video processing (transcript + metadata ready)
// It receives the processed transcript and generates all content outputs.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callClaude } from '../_shared/claude.ts';
import type { Client, Submission } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  const authHeader = req.headers.get('x-webhook-secret');
  if (authHeader !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { submission_id, transcript, video_title, video_duration_s } = await req.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load submission + client
    const { data: submission } = await supabase
      .from('submissions')
      .select('*, clients(*)')
      .eq('id', submission_id)
      .single<Submission & { clients: Client }>();

    if (!submission) throw new Error('Submission not found');
    const client = submission.clients;

    // Update submission with transcript
    await supabase.from('submissions').update({
      status: 'processing',
      transcript,
      video_title,
      video_duration_s,
    }).eq('id', submission_id);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    const maxShorts = client.shorts_config?.max_shorts ?? 5;
    const shortsDuration = client.shorts_config?.target_duration_seconds ?? 60;
    const platforms = client.active_platforms;

    // Build system prompt
    const system = `You are the Beast System content engine for ${client.name}.
${client.brand_voice ? `\nBrand voice:\n${client.brand_voice}` : ''}

You will receive a video transcript with timestamps and produce a structured JSON response with all content outputs.`;

    // Build user prompt
    const user = `Video: "${video_title}" (${Math.floor((video_duration_s ?? 0) / 60)}m ${(video_duration_s ?? 0) % 60}s)

TRANSCRIPT:
${transcript}

---
Generate a JSON object with this exact structure:

{
  "written_posts": [
    // One object per platform per post. Platforms to cover: ${platforms.join(', ')}
    {
      "platform": "instagram",
      "slot_id": "instagram_post_1",
      "content": "Full post copy here, including hashtags if appropriate for the platform"
    }
    // Produce 2-3 posts per platform where applicable
  ],
  "visual_assets": [
    // 1-2 carousel/card concepts per platform (instagram, facebook, linkedin if in platforms)
    {
      "platform": "instagram",
      "slot_id": "instagram_carousel_1",
      "content": "Caption for the visual post",
      "metadata": {
        "visual_type": "carousel",
        "slide_count": 5,
        "slide_topics": ["Slide 1 topic", "Slide 2 topic", ...]
      }
    }
  ],
  "shorts_breakdown": {
    "content": "Complete video editor brief as a formatted markdown document",
    "metadata": {
      "total_shorts": ${maxShorts},
      "shorts": [
        {
          "number": 1,
          "title": "Short title",
          "start_time": "MM:SS",
          "end_time": "MM:SS",
          "hook": "First 3 seconds hook line",
          "key_moments": ["timestamp - description", ...],
          "caption": "Ready-to-post caption for this short",
          "platforms": ["tiktok", "instagram_reels", "youtube_shorts"],
          "editor_notes": "Specific cuts, transitions, text overlays, music suggestions"
        }
      ]
    }
  }
}

Target short duration: ~${shortsDuration} seconds each. Return only valid JSON.`;

    const raw = await callClaude({ system, user, apiKey, maxTokens: 8192 });

    // Extract JSON (Claude may wrap in markdown)
    const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/(\{[\s\S]*\})/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : raw);

    // Store outputs
    const outputs: any[] = [];

    for (const post of parsed.written_posts ?? []) {
      outputs.push({
        submission_id,
        output_type: 'written_post',
        platform: post.platform,
        slot_id: post.slot_id,
        content: post.content,
        metadata: {},
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

    return new Response(JSON.stringify({ ok: true, outputs_count: outputs.length }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
