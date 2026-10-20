import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Badge, Button, Card, CardContent, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, ToggleGroup, ToggleGroupItem,
} from '@databricks/appkit-ui/react';
import { ChevronRight, History } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader } from '@/components/states';
import { useDecisions, type Decision } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { actionLabel } from '@/lib/risk';

type Filter = 'ALL' | 'APPROVED' | 'OVERRIDDEN';

function DecisionBadge({ decision }: { decision: Decision['decision'] }) {
  return decision === 'OVERRIDDEN'
    ? <Badge variant="outline" className="bg-card">Overridden</Badge>
    : <Badge variant="secondary">Approved</Badge>;
}

export function DecisionsPage() {
  const navigate = useNavigate();
  const { rows, loading, error, reload } = useDecisions();
  const [filter, setFilter] = useState<Filter>('ALL');
  const visible = filter === 'ALL' ? rows : rows.filter((row) => row.decision === filter);
  const overrides = rows.filter((row) => row.decision === 'OVERRIDDEN').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decisions"
        description="Every approval and override recorded in Lakebase, newest first."
        meta={!loading && !error && rows.length > 0 && <span><span className="hz-num">{rows.length}</span> decisions · <span className="hz-num">{overrides}</span> overrides</span>}
      />

      <ToggleGroup type="single" variant="outline" value={filter} onValueChange={(value) => { if (value) setFilter(value as Filter); }} aria-label="Filter decisions">
        <ToggleGroupItem value="ALL" className="h-10 px-4">All</ToggleGroupItem>
        <ToggleGroupItem value="APPROVED" className="h-10 px-4">Approved</ToggleGroupItem>
        <ToggleGroupItem value="OVERRIDDEN" className="h-10 px-4">Overridden</ToggleGroupItem>
      </ToggleGroup>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>
          ) : error ? (
            <div className="p-6"><ErrorState title="Decisions unavailable" message={error} onRetry={reload} /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<History />}
              title="No decisions yet"
              description="Approvals and overrides appear here after an underwriter records them."
              action={<Button asChild variant="outline"><Link to="/">Open the review queue</Link></Button>}
            />
          ) : visible.length === 0 ? (
            <EmptyState icon={<History />} title="No matching decisions" description="No decisions match this filter." />
          ) : (
            <>
              <Table className="hidden text-base md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Policy</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden lg:table-cell">Reviewer</TableHead>
                    <TableHead>Recorded</TableHead>
                    <TableHead className="w-10 pr-6"><span className="sr-only">Open</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.decision_id} className="hz-row" onClick={() => void navigate(`/policies/${row.policy_id}`)}>
                      <TableCell className="py-3 pl-6">
                        <Link to={`/policies/${row.policy_id}`} className="hz-num font-medium hover:underline" onClick={(event) => event.stopPropagation()}>{row.policy_id}</Link>
                      </TableCell>
                      <TableCell><DecisionBadge decision={row.decision} /></TableCell>
                      <TableCell>
                        {actionLabel(row.selected_action)}
                        {row.decision === 'OVERRIDDEN' && <div className="text-sm text-muted-foreground">Recommended: {actionLabel(row.recommended_action)}</div>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{row.reviewer_email}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(row.decided_at)}</TableCell>
                      <TableCell className="pr-6"><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <ul className="divide-y md:hidden">
                {visible.map((row) => (
                  <li key={row.decision_id}>
                    <Link to={`/policies/${row.policy_id}`} className="hz-row flex min-h-16 items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2"><span className="hz-num font-medium">{row.policy_id}</span><DecisionBadge decision={row.decision} /></div>
                        <div className="text-sm text-muted-foreground">{actionLabel(row.selected_action)} · {formatDateTime(row.decided_at)}</div>
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
    </div>
  );
}
