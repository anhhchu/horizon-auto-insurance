import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipTrigger,
} from '@databricks/appkit-ui/react';
import { ChevronRight, Info } from 'lucide-react';
import { GenieAgentPanel } from '@/components/genie-agent-panel';
import { BandDistribution, RiskBadge } from '@/components/risk';
import { EmptyState, ErrorState, PageHeader } from '@/components/states';
import { useApi, type Portfolio, type QueueRow } from '@/lib/api';
import { daysUntil, formatCurrency, formatDate, formatDateTime, formatInteger, formatProbability, hoursSince } from '@/lib/format';
import { asRiskBand, REVIEW_THRESHOLD, RISK_BANDS } from '@/lib/risk';

type QueueStatus = 'open' | 'decided' | 'all';

function topFactor(row: { speeding_events_90d: number; hard_brake_events_90d: number; distraction_events_90d: number }) {
  const factors = [
    { label: 'speeding', value: Number(row.speeding_events_90d) },
    { label: 'hard brakes', value: Number(row.hard_brake_events_90d) },
    { label: 'distraction', value: Number(row.distraction_events_90d) },
  ].sort((a, b) => b.value - a.value);
  return `${factors[0].value} ${factors[0].label}`;
}

function KpiStrip({ portfolio }: { portfolio: ReturnType<typeof useApi<Portfolio>> }) {
  if (portfolio.loading) return <Skeleton className="h-28 rounded-xl" />;
  if (portfolio.error) return <ErrorState title="Portfolio summary unavailable" message={portfolio.error} onRetry={portfolio.reload} />;
  const totals = portfolio.data;
  const staleHours = hoursSince(totals?.data_freshness);
  return (
    <section aria-label="Portfolio summary" className="hz-kpi-strip">
      <div className="hz-kpi">
        <div className="hz-eyebrow">Policies requiring review</div>
        <div className="hz-kpi-value">{formatInteger(totals?.policies_requiring_review)}</div>
        <div className="text-sm text-muted-foreground">
          <span className="hz-num">{formatInteger(totals?.policies_decided)}</span> decided · of {formatInteger(totals?.policies_in_region)} active · probability ≥ {REVIEW_THRESHOLD.toFixed(2)}
        </div>
      </div>
      <div className="hz-kpi">
        <div className="hz-eyebrow">Expected loss at risk</div>
        <div className="hz-kpi-value">{formatCurrency(totals?.expected_loss_at_risk)}</div>
        <div className="text-sm text-muted-foreground">Premium × claim risk probability</div>
      </div>
      <div className="hz-kpi">
        <div className="hz-eyebrow">Renewals in the next 30 days</div>
        <div className="hz-kpi-value">{formatInteger(totals?.renewals_next_30d)}</div>
        <div className="text-sm text-muted-foreground">
          Scored {formatDateTime(totals?.data_freshness)}
          {staleHours !== null && staleHours > 24 && <span className="font-medium text-foreground"> · more than 24 hours old</span>}
        </div>
      </div>
    </section>
  );
}

function Distribution({ portfolio }: { portfolio: ReturnType<typeof useApi<Portfolio>> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="hz-section-title">Risk distribution</CardTitle></CardHeader>
      <CardContent>
        {portfolio.loading ? <Skeleton className="h-40" />
          : portfolio.error ? <ErrorState title="Distribution unavailable" message={portfolio.error} />
          : (
            <BandDistribution rows={RISK_BANDS.map((band) => ({
              band,
              count: Number(portfolio.data?.distribution.find((row) => row.risk_band === band)?.policy_count ?? 0),
            }))} />
          )}
      </CardContent>
    </Card>
  );
}

const EMPTY: Record<QueueStatus, { title: string; description: string }> = {
  open: { title: 'Queue clear', description: 'Every renewal in your regions above the review threshold has a recorded decision.' },
  decided: { title: 'No decisions yet', description: 'Policies move here after an underwriter approves or overrides them.' },
  all: { title: 'No renewals to review', description: 'No active policies in your regions are above the review threshold.' },
};

function Queue() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<QueueStatus>('open');
  const queue = useApi<QueueRow[]>(`/api/queue?status=${status}`);
  const rows = (queue.data ?? []).slice(0, 50);

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 py-4">
        <div className="space-y-0.5">
          <CardTitle className="hz-section-title">Renewal queue</CardTitle>
          <p className="text-sm text-muted-foreground">Ranked by claim risk</p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(value) => { if (value) setStatus(value as QueueStatus); }} aria-label="Queue status">
          <ToggleGroupItem value="open" className="h-9 px-3">To review</ToggleGroupItem>
          <ToggleGroupItem value="decided" className="h-9 px-3">Decided</ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-9 px-3">All</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {queue.loading ? (
          <div className="space-y-2 px-6 pb-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>
        ) : queue.error ? (
          <div className="px-6 pb-4"><ErrorState title="Queue unavailable" message={queue.error} onRetry={queue.reload} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title={EMPTY[status].title} description={EMPTY[status].description} />
        ) : (
          <>
            {/* Desktop and tablet: table */}
            <Table className="hidden text-base md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Policy</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger className="inline-flex items-center gap-1">Probability <Info className="size-3.5" aria-hidden="true" /></TooltipTrigger>
                      <TooltipContent>Predicted probability of a claim in the next term</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">Top factor (90 days)</TableHead>
                  {status !== 'open' && <TableHead>Decision</TableHead>}
                  <TableHead className="w-10 pr-6"><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const days = daysUntil(row.renewal_date);
                  return (
                    <TableRow key={row.policy_id} className="hz-row" onClick={() => void navigate(`/policies/${row.policy_id}`)}>
                      <TableCell className="py-3 pl-6">
                        <Link to={`/policies/${row.policy_id}`} className="hz-num font-medium hover:underline" onClick={(event) => event.stopPropagation()}>{row.policy_id}</Link>
                        <div className="text-sm text-muted-foreground">{row.customer_id}</div>
                      </TableCell>
                      <TableCell>
                        {formatDate(row.renewal_date)}
                        {days !== null && days >= 0 && <div className="text-sm text-muted-foreground">in {days} days</div>}
                      </TableCell>
                      <TableCell><RiskBadge band={asRiskBand(row.risk_band)} /></TableCell>
                      <TableCell className="hz-num text-right">{formatProbability(row.claim_risk_probability)}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{topFactor(row)}</TableCell>
                      {status !== 'open' && <TableCell><DecisionStatus row={row} /></TableCell>}
                      <TableCell className="pr-6"><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Mobile: stacked list */}
            <ul className="divide-y md:hidden">
              {rows.map((row) => (
                <li key={row.policy_id}>
                  <Link to={`/policies/${row.policy_id}`} className="hz-row flex min-h-16 items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="hz-num font-medium">{row.policy_id}</span>
                        <RiskBadge band={asRiskBand(row.risk_band)} />
                        {status !== 'open' && <DecisionStatus row={row} />}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="hz-num">{formatProbability(row.claim_risk_probability)}</span> · renews {formatDate(row.renewal_date)}
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionStatus({ row }: { row: QueueRow }) {
  if (!row.latest_decision) return <span className="text-sm text-muted-foreground">Open</span>;
  return <Badge variant={row.latest_decision === 'OVERRIDDEN' ? 'outline' : 'secondary'} className="bg-card">{row.latest_decision === 'OVERRIDDEN' ? 'Overridden' : 'Approved'}</Badge>;
}

export function ReviewQueuePage() {
  const portfolio = useApi<Portfolio>('/api/portfolio');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Renewal review"
        description="Renewals in your regions, ranked by predicted claim risk. Open a policy to review the evidence and record a decision."
        meta={portfolio.data && <span>{portfolio.data.regions.length ? `Your regions: ${portfolio.data.regions.join(', ')}` : 'No regions assigned to you'}</span>}
      />
      <KpiStrip portfolio={portfolio} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Queue />
        <div className="space-y-6">
          <Distribution portfolio={portfolio} />
          <GenieAgentPanel
            title="Ask Genie about the portfolio"
            description="Questions about your book, answered from the governed metric view and guidelines, with the SQL shown."
            starters={[
              'Which risk bands drive most of the expected loss for West renewals in the next 30 days?',
              'What is the override rate by underwriter this month, and what do the guidelines say about override limits?',
            ]}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Source: policy_risk_decisions, synced from Unity Catalog to Lakebase after each scoring run. Rows are limited to your regions in Lakebase and Unity Catalog.</p>
    </div>
  );
}
