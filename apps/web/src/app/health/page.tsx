/**
 * Public health page. Phase 1 hits the API directly. Phase 18 moves
 * this to a server-side probe so we can mark readiness without a
 * round trip.
 *
 * Phase 19: failures are reported with a generic message. The previous
 * version surfaced the raw fetch error, which on a public (unauthenticated)
 * page can disclose the internal API host and port.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

type HealthPayload = { status: 'ok' | 'error'; service?: string; detail?: string };

async function fetchHealth(): Promise<HealthPayload> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/health`, { cache: 'no-store' });
    if (!res.ok) {
      return { status: 'error', detail: `API returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as HealthPayload;
    return { ...data, status: 'ok' };
  } catch {
    // Never render the underlying error: it can contain the internal API URL.
    return { status: 'error', detail: 'API is unreachable' };
  }
}

export const dynamic = 'force-dynamic';

export default async function HealthPage(): Promise<JSX.Element> {
  const health = await fetchHealth();
  return (
    <main style={{ padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>API health</h1>
      <p>
        Status: <strong>{health.status}</strong>
      </p>
      {health.service ? (
        <p>
          Service: <code>{health.service}</code>
        </p>
      ) : null}
      {health.detail ? <p>Detail: {health.detail}</p> : null}
    </main>
  );
}
