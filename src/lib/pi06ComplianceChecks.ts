/**
 * PI.06 diagnostics — shared by ComplianceTab and MVP-3 orchestrator.
 * Hits the same endpoints as scripts/Test-PI06-Compliance.ps1 (Engine repo).
 */

export type Pi06CheckRow = {
  id: string;
  label: string;
  criterion: string;
  detail: string;
  pass: boolean;
};

export type Pi06FetchDiag = { path: string; status: number; hint?: string };

function arr<T>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

function pickTemplates(data: Record<string, unknown> | null): { id?: string; subject?: string }[] | null {
  if (!data) return null;
  return arr(data.templates) ?? arr(data.Templates);
}

function pickPlaybooks(data: Record<string, unknown> | null): { id?: string; name?: string; raci?: string }[] | null {
  if (!data) return null;
  return arr(data.playbooks) ?? arr(data.Playbooks);
}

export type Pi06ComplianceRunResult = {
  rows: Pi06CheckRow[];
  fetchDiag: Pi06FetchDiag[];
  f4: Record<string, unknown> | null;
  e2: Record<string, unknown> | null;
  h5: Record<string, unknown> | null;
  g4: Record<string, unknown> | null;
  m2StatusLine: string;
  error: string | null;
};

/** `standalone` = Audit tab / user refresh (M2 label: demo attestation). `mvp3Suite` = full MVP-3 orchestrator (M2 label: full suite). */
export type Pi06RunContext = 'standalone' | 'mvp3Suite';

export async function runPi06ComplianceChecks(
  diagnosticsBase: string,
  getApiHeaders: () => Promise<Record<string, string>>,
  context: Pi06RunContext = 'standalone',
): Promise<Pi06ComplianceRunResult> {
  const empty: Pi06ComplianceRunResult = {
    rows: [],
    fetchDiag: [],
    f4: null,
    e2: null,
    h5: null,
    g4: null,
    m2StatusLine: '—',
    error: null,
  };

  try {
    const h = await getApiHeaders();
    const paths = ['comms-templates', 'geofencing', 'eip7702-policy', 'playbooks'] as const;
    const responses = await Promise.all(
      paths.map((p) => fetch(`${diagnosticsBase}/${p}`, { headers: h })),
    );
    const fetchDiag: Pi06FetchDiag[] = [];
    responses.forEach((r, i) => {
      let hint: string | undefined;
      if (r.status === 403) {
        hint = 'If A5 DApp allowlist is on, dashboard needs a matching X-Build-Id (see build-id.json).';
      }
      fetchDiag.push({ path: paths[i], status: r.status, hint });
    });

    const [rF4, rE2, rH5, rG4] = responses;
    const jF4 = rF4.ok ? ((await rF4.json()) as Record<string, unknown>) : null;
    const jE2 = rE2.ok ? ((await rE2.json()) as Record<string, unknown>) : null;
    const jH5 = rH5.ok ? ((await rH5.json()) as Record<string, unknown>) : null;
    const jG4 = rG4.ok ? ((await rG4.json()) as Record<string, unknown>) : null;

    const f4List = pickTemplates(jF4);
    const g4List = pickPlaybooks(jG4);
    const travelKnown =
      jE2 !== null
      && (typeof jE2.travelModeEnabled === 'boolean' || typeof jE2.TravelModeEnabled === 'boolean');
    const h5Known =
      jH5 !== null
      && (typeof jH5.blockUnverifiedDelegation === 'boolean' || typeof jH5.BlockUnverifiedDelegation === 'boolean');

    const allGetOk = responses.every((r) => r.ok);
    let m2Pass = false;
    let m2Detail = 'Skipped (fix GET failures first)';
    let m2StatusLine = '—';

    const m2Payload =
      context === 'mvp3Suite'
        ? { attestationPayload: 'mvp3-suite-stub', deviceId: 'mvp3-orchestrator' }
        : { attestationPayload: 'director-demo-stub', deviceId: 'compliance-tab' };
    const m2OkLabel = context === 'mvp3Suite' ? 'Accepted (MVP-3 full suite)' : 'Accepted (demo attestation)';

    if (allGetOk) {
      try {
        const rM2 = await fetch(`${diagnosticsBase}/recovery-attestation`, {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify(m2Payload),
        });
        const data = rM2.ok ? await rM2.json() : null;
        const valid = data && typeof data === 'object' && 'valid' in data && (data as { valid?: boolean }).valid === true;
        m2Pass = valid;
        m2Detail = valid
          ? 'POST 200, valid: true'
          : rM2.ok
            ? '200 but valid not true'
            : `HTTP ${rM2.status}`;
        m2StatusLine = valid ? m2OkLabel : `HTTP ${rM2.status}`;
      } catch (e) {
        m2Pass = false;
        m2Detail = e instanceof Error ? e.message : 'Request failed';
        m2StatusLine = 'Request failed';
      }
    }

    const rows: Pi06CheckRow[] = [
      {
        id: 'F4',
        label: 'Customer comms templates',
        criterion: 'GET comms-templates → 200, ≥1 template',
        detail:
          rF4.ok && f4List && f4List.length > 0
            ? `OK (${f4List.length} template(s))`
            : !rF4.ok
              ? `HTTP ${rF4.status}`
              : '200 but empty templates',
        pass: rF4.ok && !!f4List?.length,
      },
      {
        id: 'E2',
        label: 'Geofencing policy',
        criterion: 'GET geofencing → 200, travel mode present',
        detail:
          rE2.ok && travelKnown
            ? `OK (travelMode=${String(jE2?.travelModeEnabled ?? jE2?.TravelModeEnabled)})`
            : !rE2.ok
              ? `HTTP ${rE2.status}`
              : '200 but no travel flag',
        pass: rE2.ok && travelKnown,
      },
      {
        id: 'H5',
        label: 'EIP-7702 abuse policy',
        criterion: 'GET eip7702-policy → 200, block-unverified flag present',
        detail:
          rH5.ok && h5Known
            ? `OK (blockUnverifiedDelegation=${String(jH5?.blockUnverifiedDelegation ?? jH5?.BlockUnverifiedDelegation)})`
            : !rH5.ok
              ? `HTTP ${rH5.status}`
              : '200 but no block flag',
        pass: rH5.ok && h5Known,
      },
      {
        id: 'G4',
        label: 'Incident playbooks',
        criterion: 'GET playbooks → 200, ≥1 playbook',
        detail:
          rG4.ok && g4List && g4List.length > 0
            ? `OK (${g4List.length} playbook(s))`
            : !rG4.ok
              ? `HTTP ${rG4.status}`
              : '200 but empty playbooks',
        pass: rG4.ok && !!g4List?.length,
      },
      {
        id: 'M2',
        label: 'Recovery attestation',
        criterion: 'POST recovery-attestation → 200, valid: true',
        detail: m2Detail,
        pass: m2Pass,
      },
    ];

    return {
      rows,
      fetchDiag,
      f4: jF4,
      e2: jE2,
      h5: jH5,
      g4: jG4,
      m2StatusLine,
      error: null,
    };
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : 'Failed to fetch',
    };
  }
}
