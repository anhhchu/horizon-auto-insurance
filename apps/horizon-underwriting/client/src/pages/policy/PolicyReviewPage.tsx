import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator, Button, Card, CardContent, CardHeader, CardTitle, Skeleton,
  Tabs, TabsContent, TabsList, TabsTrigger, useIsMobile,
} from '@databricks/appkit-ui/react';
import { GenieAgentPanel } from '@/components/genie-agent-panel';
import { DecisionPanel } from '@/components/decision-panel';
import { RiskBadge, RiskMeter } from '@/components/risk';
import { EmptyState, ErrorState } from '@/components/states';
import { useApi, useDecisions, type Policy } from '@/lib/api';
import { daysUntil, formatCurrency, formatDate, formatDateTime, formatInteger, formatPercent } from '@/lib/format';
import { actionLabel, asActionCode, asRiskBand } from '@/lib/risk';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="hz-eyebrow">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EvidenceRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt>
        {label}
        {detail && <span className="block text-sm text-muted-foreground">{detail}</span>}
      </dt>
      <dd className="hz-num text-lg font-medium">{value}</dd>
    </div>
  );
}

function DecisionHistory({ policyId, history }: { policyId: string; history: ReturnType<typeof useDecisions> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="hz-section-title">History for {policyId}</CardTitle></CardHeader>
      <CardContent>
        {history.loading ? <Skeleton className="h-16" />
          : history.error ? <ErrorState title="History unavailable" message={history.error} onRetry={history.reload} />
          : history.rows.length === 0 ? <p className="text-sm text-muted-foreground">No decisions recorded for this policy yet.</p>
          : (
            <ol className="divide-y">
              {history.rows.map((row) => (
                <li key={row.decision_id} className="space-y-0.5 py-3 first:pt-0 last:pb-0">
                  <div className="font-medium">{row.decision === 'OVERRIDDEN' ? 'Overridden' : 'Approved'} · {actionLabel(row.selected_action)}</div>
                  <div className="text-sm text-muted-foreground">{row.reviewer_email} · {formatDateTime(row.decided_at)}</div>
                  {row.override_reason && <p className="text-sm">{row.override_reason}</p>}
                </li>
              ))}
            </ol>
          )}
      </CardContent>
    </Card>
  );
}

export function PolicyReviewPage() {
  const { policyId = '' } = useParams();
  const isMobile = useIsMobile();
  const detail = useApi<Policy>(`/api/policies/${encodeURIComponent(policyId)}`);
  const history = useDecisions(policyId);

  const policy = detail.data;

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Review queue</Link></BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage className="hz-num">{policyId}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  if (detail.loading) {
    return (
      <div className="space-y-6">
        {breadcrumb}
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"><Skeleton className="h-96 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
      </div>
    );
  }

  if (detail.error && detail.status !== 404) {
    return <div className="space-y-6">{breadcrumb}<ErrorState title="Policy evidence unavailable" message={detail.error} onRetry={detail.reload} /></div>;
  }

  if (!policy) {
    return (
      <div className="space-y-6">
        {breadcrumb}
        <EmptyState
          title="Policy not found"
          description={`${policyId} is not an active West policy you have access to.`}
          action={<Button asChild variant="outline"><Link to="/">Back to queue</Link></Button>}
        />
      </div>
    );
  }

  const probability = Number(policy.claim_risk_probability);
  const band = asRiskBand(policy.risk_band);
  const days = daysUntil(policy.renewal_date);

  const header = (
    <Card>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="hz-page-title hz-num">{policy.policy_id}</h1>
            <RiskBadge band={band} />
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Customer"><span className="hz-num">{policy.customer_id}</span></Fact>
            <Fact label="Renewal">{formatDate(policy.renewal_date)}{days !== null && days >= 0 && <span className="block text-sm text-muted-foreground">in {days} days</span>}</Fact>
            <Fact label="Annual premium"><span className="hz-num">{formatCurrency(policy.annual_premium)}</span></Fact>
            <Fact label="Expected loss"><span className="hz-num">{formatCurrency(policy.expected_loss)}</span></Fact>
          </dl>
        </div>
        <RiskMeter probability={probability} band={band} />
      </CardContent>
    </Card>
  );

  const evidence = (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="hz-section-title">Driving evidence</CardTitle>
        <p className="text-sm text-muted-foreground">Last 90 days of telematics from VectorDrive.</p>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <EvidenceRow label="Speeding events" value={formatInteger(policy.speeding_events_90d)} />
          <EvidenceRow label="Hard-brake events" value={formatInteger(policy.hard_brake_events_90d)} />
          <EvidenceRow label="Distraction events" value={formatInteger(policy.distraction_events_90d)} />
          <EvidenceRow label="Night-time miles" value={formatPercent(policy.nighttime_miles_pct)} />
          <EvidenceRow label="Severe-weather miles" value={formatPercent(policy.severe_weather_miles_pct)} />
          <EvidenceRow label="Trips" value={formatInteger(policy.trip_count_90d)} detail={`${formatInteger(Math.round(Number(policy.miles_90d)))} miles`} />
          <EvidenceRow label="Prior claims" value={formatInteger(policy.prior_claim_count)} detail={`${formatCurrency(policy.prior_incurred_amount)} incurred`} />
        </dl>
      </CardContent>
    </Card>
  );

  const recommendedAction = asActionCode(policy.recommended_action);
  const nextPolicyId = policy.next_policy_id;
  const genie = (
    <GenieAgentPanel
      key={policy.policy_id}
      policyId={policy.policy_id}
      title="Ask Genie about this policy"
      description="Genie answers from governed policy data and the underwriting guidelines, as you, and cites its sources. It does not record decisions."
      starters={[
        `Explain the driving risk for ${policy.policy_id} and the main contributing factors.`,
        `Which interventions do the underwriting guidelines allow for ${policy.policy_id}, and why?`,
        `Can ${policy.policy_id} move to a deductible review at this renewal? Check the guidelines and the state notice period.`,
      ]}
    />
  );
  const decision = (
    <DecisionPanel
      key={policy.policy_id}
      policyId={policy.policy_id}
      recommendedAction={recommendedAction}
      nextPolicyId={nextPolicyId ?? undefined}
      onRecorded={() => { history.reload(); detail.reload(); }}
    />
  );
  const footnote = (
    <p className="text-sm text-muted-foreground">
      Model {policy.model_alias} · scored {formatDateTime(policy.scored_at)} · Source: policy_risk_decisions, synced to Lakebase after each scoring run.
    </p>
  );

  if (isMobile) {
    return (
      <div className="space-y-4">
        {breadcrumb}
        {header}
        <Tabs defaultValue="evidence">
          <TabsList className="grid h-11 w-full grid-cols-3">
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="genie">Ask Genie</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
          </TabsList>
          <TabsContent value="evidence" className="mt-4">{evidence}</TabsContent>
          <TabsContent value="genie" forceMount className="mt-4 data-[state=inactive]:hidden">{genie}</TabsContent>
          <TabsContent value="decision" forceMount className="mt-4 space-y-4 data-[state=inactive]:hidden">
            {decision}
            <DecisionHistory policyId={policy.policy_id} history={history} />
          </TabsContent>
        </Tabs>
        {footnote}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {breadcrumb}
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="space-y-6">
          {evidence}
          {genie}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-20" aria-label="Decision">
          {decision}
          <DecisionHistory policyId={policy.policy_id} history={history} />
        </aside>
      </div>
      {footnote}
    </div>
  );
}
