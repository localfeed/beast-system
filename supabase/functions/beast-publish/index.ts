// beast-publish: reads generated outputs and sends written_posts to Buffer
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { scheduleBufferPost } from '../_shared/buffer-api.ts';
import type { Client, SubmissionOutput } from '../_shared/types.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (req.headers.get('x-webhook-secret') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { submission_id } = await req.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load submission + client
    const { data: submission } = await supabase
      .from('submissions')
      .select('*, clients(*)')
      .eq('id', submission_id)
      .single<any>();

    if (!submission) throw new Error('Submission not found');
    const client: Client = submission.clients;

    // Load pending written posts
    const { data: outputs } = await supabase
      .from('submission_outputs')
      .select('*')
      .eq('submission_id', submission_id)
      .eq('output_type', 'written_post')
      .eq('buffer_status', 'pending');

    const bufferToken = client.buffer_access_token;

    for (const output of (outputs ?? []) as SubmissionOutput[]) {
      const profileId = client.buffer_profiles[output.platform ?? ''];

      if (!profileId) {
        await supabase.from('submission_outputs')
          .update({ buffer_status: 'skipped' })
          .eq('id', output.id);
        continue;
      }

      const result = await scheduleBufferPost({
        profileId,
        text: output.content,
        accessToken: bufferToken,
      });

      await supabase.from('submission_outputs').update({
        buffer_status: result.success ? 'scheduled' : 'failed',
        buffer_update_id: result.id,
      }).eq('id', output.id);
    }

    // Mark submission done
    await supabase.from('submissions').update({
      status: 'done',
      processed_at: new Date().toISOString(),
    }).eq('id', submission_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
