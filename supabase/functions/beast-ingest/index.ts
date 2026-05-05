import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_slug, video_url } = await req.json();
    if (!client_slug || !video_url) {
      return new Response(JSON.stringify({ error: 'client_slug and video_url required' }), {
        status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name')
      .eq('slug', client_slug)
      .single();

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: 'Unknown client' }), {
        status: 404, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    // Create submission
    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .insert({ client_id: client.id, video_url, status: 'pending' })
      .select('id')
      .single();

    if (subErr || !submission) throw subErr;

    // Trigger GitHub Actions to process the submission
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const githubRepo = Deno.env.get('GITHUB_REPO'); // e.g. localfeed/beast-system
    if (githubToken && githubRepo) {
      await fetch(`https://api.github.com/repos/${githubRepo}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: 'beast-submission',
          client_payload: { submission_id: submission.id },
        }),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, submission_id: submission.id, client: client.name }),
      { status: 201, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
