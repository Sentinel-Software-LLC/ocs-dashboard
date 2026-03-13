/**
 * A5: DApp allowlist — X-Build-Id header for Engine API calls.
 * D1: Tamper-evident UI — build ID for checksum banner.
 * Fetches /build-id.json (from postbuild) and caches.
 */
let cached: Record<string, string> | null = null;

export async function getApiHeaders(): Promise<Record<string, string>> {
  if (cached) return cached;
  try {
    const r = await fetch('/build-id.json');
    const d = await r.json();
    if (d?.buildId) cached = { 'X-Build-Id': d.buildId };
    else cached = {};
  } catch {
    cached = {};
  }
  return cached;
}

/** D1: Returns build ID for tamper-evident banner. Cached after first fetch. */
export async function getBuildId(): Promise<string | null> {
  const h = await getApiHeaders();
  return h['X-Build-Id'] ?? null;
}
