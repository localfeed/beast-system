const BUFFER_API = 'https://api.bufferapp.com/1';

export async function scheduleBufferPost(opts: {
  profileId: string;
  text: string;
  mediaUrls?: string[];
  accessToken: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const body = new URLSearchParams({
    profile_ids[]: opts.profileId,
    text: opts.text,
    access_token: opts.accessToken,
  });

  if (opts.mediaUrls?.length) {
    opts.mediaUrls.forEach((url, i) => {
      body.append(`media[picture]`, url);
    });
  }

  const res = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: 'POST',
    body,
  });

  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? res.statusText };
  return { success: true, id: data.updates?.[0]?.id };
}
