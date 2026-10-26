import { useCallback, useEffect, useState } from 'react';

export interface Decision {
  decision_id: string;
  policy_id: string;
  reviewer_email: string;
  decision: 'APPROVED' | 'OVERRIDDEN' | 'INTERVENTION_ASSIGNED';
  recommended_action: string;
  selected_action: string;
  override_reason: string | null;
  notes: string | null;
  model_version: string | null;
  decided_at: string;
}

interface LatestDecision {
  latest_decision: Decision['decision'] | null;
  latest_decided_at: string | null;
}

export interface QueueRow extends LatestDecision {
  policy_id: string;
  customer_id: string;
  region: string;
  renewal_date: string;
  annual_premium: number;
  claim_risk_probability: number;
  risk_band: string;
  recommended_action: string;
  model_alias: string;
  speeding_events_90d: number;
  hard_brake_events_90d: number;
  distraction_events_90d: number;
}

export interface QueuePage {
  rows: QueueRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Policy extends LatestDecision {
  policy_id: string;
  customer_id: string;
  region: string;
  renewal_date: string;
  annual_premium: number;
  claim_risk_probability: number;
  risk_band: string;
  recommended_action: string;
  expected_loss: number;
  requires_review: boolean;
  model_alias: string;
  scored_at: string;
  trip_count_90d: number;
  miles_90d: number;
  nighttime_miles_pct: number;
  severe_weather_miles_pct: number;
  speeding_events_90d: number;
  hard_brake_events_90d: number;
  distraction_events_90d: number;
  prior_claim_count: number;
  prior_incurred_amount: number;
  next_policy_id: string | null;
}

export interface Portfolio {
  policies_in_region: number;
  policies_requiring_review: number;
  policies_decided: number;
  expected_loss_at_risk: number;
  renewals_next_30d: number;
  data_freshness: string | null;
  regions: string[];
  distribution: { risk_band: string; policy_count: number }[];
}


export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readError(response: Response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : text;
  } catch {
    return text || `Request failed with status ${response.status}`;
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return response.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return response.json() as Promise<T>;
}

interface ApiState<T> { key: string; data: T | null; error: string; status: number }

// Fetches `url`; `loading` is true only until the first response for that URL, so
// reload() refreshes in place without flashing skeletons.
export function useApi<T>(url: string) {
  const [version, setVersion] = useState(0);
  const key = `${url}#${version}`;
  const [state, setState] = useState<ApiState<T>>({ key: '', data: null, error: '', status: 0 });

  useEffect(() => {
    let active = true;
    getJson<T>(url)
      .then((data) => { if (active) setState({ key, data, error: '', status: 200 }); })
      .catch((cause: unknown) => {
        if (active) setState({ key, data: null, error: cause instanceof Error ? cause.message : String(cause), status: cause instanceof ApiError ? cause.status : 0 });
      });
    return () => { active = false; };
  }, [url, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const loading = state.key === '' || state.key.slice(0, state.key.lastIndexOf('#')) !== url;
  return { data: state.data, loading, error: state.key === key ? state.error : '', status: state.status, reload };
}

export function useDecisions(policyId?: string) {
  const result = useApi<Decision[]>(policyId ? `/api/decisions?policyId=${encodeURIComponent(policyId)}` : '/api/decisions');
  return { rows: result.data ?? [], loading: result.loading, error: result.error, reload: result.reload };
}
