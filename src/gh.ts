export async function ghRest(token: string, path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
}

export async function ghGraphQL<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graphql: HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`graphql: ${JSON.stringify(body.errors)}`);
  return body.data;
}

export async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const res = await ghRest(
    token,
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: { Accept: 'application/vnd.github.raw' } },
  );
  if (!res.ok) throw new Error(`contents ${path}: HTTP ${res.status}`);
  return res.text();
}

export async function listDirectory(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<Array<{ name: string; path: string; type: string }>> {
  const res = await ghRest(
    token,
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (!res.ok) throw new Error(`list ${path}: HTTP ${res.status}`);
  return res.json();
}
