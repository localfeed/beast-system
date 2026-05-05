const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export async function callClaude(opts: {
  system: string;
  user: string;
  apiKey: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? 'claude-opus-4-7',
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content[0].text as string;
}
