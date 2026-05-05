#!/usr/bin/env node
/**
 * process-video.mjs
 * Picks up a pending submission, downloads the video transcript via yt-dlp,
 * falls back to Whisper (Groq) if no captions, then calls beast-generate.
 *
 * Usage:
 *   node scripts/process-video.mjs --submission-id <uuid>
 *   BEAST_SUBMISSION_ID=<uuid> node scripts/process-video.mjs
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const submissionId = process.env.BEAST_SUBMISSION_ID
  ?? process.argv.find((a, i) => process.argv[i - 1] === '--submission-id');

if (!submissionId) {
  console.error('No submission ID. Set BEAST_SUBMISSION_ID or pass --submission-id <uuid>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log(`[beast] Processing submission ${submissionId}`);

  // Load submission
  const { data: submission, error } = await supabase
    .from('submissions')
    .select('*, clients(*)')
    .eq('id', submissionId)
    .single();

  if (error || !submission) {
    console.error('Submission not found:', error);
    process.exit(1);
  }

  await supabase.from('submissions').update({ status: 'processing' }).eq('id', submissionId);

  const workDir = join(tmpdir(), `beast-${submissionId.slice(0, 8)}`);
  mkdirSync(workDir, { recursive: true });

  try {
    const { transcript, videoTitle, videoDurationS } = await getTranscript(
      submission.video_url, workDir,
    );

    console.log(`[beast] Got transcript for "${videoTitle}" (${videoDurationS}s)`);
    console.log(`[beast] Transcript length: ${transcript.length} chars`);

    // Call beast-generate edge function with the transcript
    const res = await fetch(`${SUPABASE_URL}/functions/v1/beast-generate`, {
      method: 'POST',
      headers: {
        'x-webhook-secret': WEBHOOK_SECRET,
        'content-type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        submission_id: submissionId,
        transcript,
        video_title: videoTitle,
        video_duration_s: videoDurationS,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`beast-generate failed: ${JSON.stringify(data)}`);
    console.log(`[beast] Generated ${data.outputs_count} outputs`);

  } catch (err) {
    console.error('[beast] Processing failed:', err);
    await supabase.from('submissions').update({
      status: 'failed',
      error_message: String(err),
    }).eq('id', submissionId);
    process.exit(1);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function getTranscript(videoUrl, workDir) {
  // 1. Try native captions via yt-dlp
  const vttPath = join(workDir, 'captions.vtt');
  const infoPath = join(workDir, 'info.json');

  const dlResult = spawnSync('yt-dlp', [
    '--write-auto-subs',
    '--write-subs',
    '--sub-lang', 'en',
    '--sub-format', 'vtt',
    '--skip-download',
    '--write-info-json',
    '--output', join(workDir, 'video'),
    videoUrl,
  ], { encoding: 'utf8' });

  let videoTitle = 'Unknown Video';
  let videoDurationS = 0;

  // Parse video info
  const infoFiles = existsSync(workDir)
    ? execSync(`find "${workDir}" -name "*.info.json" 2>/dev/null`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    : [];
  if (infoFiles[0] && existsSync(infoFiles[0])) {
    const info = JSON.parse(readFileSync(infoFiles[0], 'utf8'));
    videoTitle = info.title ?? videoTitle;
    videoDurationS = info.duration ?? 0;
  }

  // Find VTT file
  const vttFiles = existsSync(workDir)
    ? execSync(`find "${workDir}" -name "*.vtt" 2>/dev/null`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    : [];

  if (vttFiles[0] && existsSync(vttFiles[0])) {
    const transcript = parseVtt(readFileSync(vttFiles[0], 'utf8'));
    if (transcript.length > 100) {
      return { transcript, videoTitle, videoDurationS };
    }
  }

  // 2. Fallback: Whisper via Groq
  if (!GROQ_API_KEY) {
    throw new Error('No captions found and GROQ_API_KEY not set for Whisper fallback');
  }

  console.log('[beast] No captions found, extracting audio for Whisper...');
  const audioPath = join(workDir, 'audio.mp3');
  execSync(
    `yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${audioPath.replace('.mp3', '')}" "${videoUrl}"`,
    { encoding: 'utf8' },
  );

  const actualAudio = existsSync(audioPath)
    ? audioPath
    : execSync(`find "${workDir}" -name "*.mp3" | head -1`, { encoding: 'utf8' }).trim();

  const formData = new FormData();
  formData.append('file', new Blob([readFileSync(actualAudio)], { type: 'audio/mpeg' }), 'audio.mp3');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!whisperRes.ok) throw new Error(`Whisper failed: ${await whisperRes.text()}`);
  const whisperData = await whisperRes.json();

  const transcript = (whisperData.segments ?? [])
    .map((s) => `[${formatTime(s.start)}] ${s.text.trim()}`)
    .join('\n');

  return { transcript, videoTitle, videoDurationS };
}

function parseVtt(vtt) {
  const lines = vtt.split('\n');
  const segments = [];
  let timestamp = '';
  let text = [];

  for (const line of lines) {
    const tsMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+) -->/);
    if (tsMatch) {
      if (text.length && timestamp) {
        segments.push(`[${timestamp}] ${text.join(' ').trim()}`);
      }
      timestamp = tsMatch[1].substring(0, 5); // MM:SS
      text = [];
    } else if (line.trim() && !line.startsWith('WEBVTT') && !/^\d+$/.test(line.trim())) {
      const clean = line.replace(/<[^>]+>/g, '').trim();
      if (clean) text.push(clean);
    }
  }
  if (text.length && timestamp) segments.push(`[${timestamp}] ${text.join(' ').trim()}`);

  // Deduplicate consecutive identical lines (common in auto-captions)
  return segments.filter((s, i) => i === 0 || s !== segments[i - 1]).join('\n');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

main();
