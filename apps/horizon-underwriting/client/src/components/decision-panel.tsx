import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, Label, RadioGroup, RadioGroupItem, Spinner, Textarea,
} from '@databricks/appkit-ui/react';
import { ArrowRight, CircleCheck } from 'lucide-react';
import { ErrorState } from '@/components/states';
import { postJson, type Decision } from '@/lib/api';
import { ACTIONS, actionLabel, type ActionCode } from '@/lib/risk';

interface DecisionPanelProps {
  policyId: string;
  recommendedAction: ActionCode;
  nextPolicyId?: string;
  onRecorded: () => void;
}

export function DecisionPanel({ policyId, recommendedAction, nextPolicyId, onRecorded }: DecisionPanelProps) {
  const [selected, setSelected] = useState<ActionCode>(recommendedAction);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [recorded, setRecorded] = useState<Decision | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOverride = selected !== recommendedAction;
  const noteMissing = isOverride && !notes.trim();

  async function submit() {
    setSubmitting(true); setError('');
    try {
      const decision = await postJson<Decision>('/api/decisions', {
        policyId,
        decision: isOverride ? 'OVERRIDDEN' : 'APPROVED',
        recommendedAction,
        selectedAction: selected,
        overrideReason: isOverride ? notes.trim() : undefined,
        notes: notes.trim() || undefined,
        modelVersion: 'policy_risk_decisions rule recommendation',
      });
      setRecorded(decision);
      toast.success(isOverride ? 'Override recorded' : 'Approval recorded', { description: `${policyId} · ${actionLabel(selected)} · saved to Lakebase` });
      onRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision write failed');
    } finally {
      setSubmitting(false); setConfirmOpen(false);
    }
  }

  if (recorded) {
    return (
      <Card>
        <CardHeader><CardTitle className="hz-section-title">Decision</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">{recorded.decision === 'OVERRIDDEN' ? 'Override recorded' : 'Approval recorded'}</p>
              <p className="text-sm text-muted-foreground">{actionLabel(recorded.selected_action)} · {recorded.reviewer_email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {nextPolicyId
              ? <Button asChild className="font-bold"><Link to={`/policies/${nextPolicyId}`}>Next policy <ArrowRight /></Link></Button>
              : <Button asChild className="font-bold"><Link to="/">Back to queue</Link></Button>}
            <Button variant="outline" onClick={() => setRecorded(null)}>Record another</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="hz-section-title">Decision</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); if (isOverride) setConfirmOpen(true); else void submit(); }}>
          <FieldSet>
            <FieldLegend variant="label">Intervention</FieldLegend>
            <RadioGroup value={selected} onValueChange={(value) => setSelected(value as ActionCode)} className="gap-2">
              {ACTIONS.map((action) => (
                <Label
                  key={action.code}
                  htmlFor={`action-${action.code}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-muted"
                >
                  <RadioGroupItem id={`action-${action.code}`} value={action.code} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {action.label}
                      {action.code === recommendedAction && <Badge variant="secondary">Recommended</Badge>}
                    </span>
                    <span className="block text-sm text-muted-foreground">{action.description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </FieldSet>

          <Field data-invalid={noteMissing || undefined}>
            <FieldLabel htmlFor="decision-note">{isOverride ? 'Override reason' : 'Note (optional)'}</FieldLabel>
            <Textarea
              id="decision-note"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              aria-invalid={noteMissing || undefined}
              placeholder={isOverride ? 'Why this action instead of the recommendation' : 'Context for the audit record'}
            />
            <FieldDescription>{isOverride ? 'Required. Stored with the decision in the audit log.' : 'Stored with the decision in the audit log.'}</FieldDescription>
          </Field>

          {error && <ErrorState title="Decision not saved" message={error} />}

          <Button type="submit" className="h-11 w-full font-bold" disabled={submitting || noteMissing}>
            {submitting && <Spinner />}
            {submitting ? 'Saving' : isOverride ? 'Record override' : 'Approve recommendation'}
          </Button>
        </form>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Override the recommendation?</AlertDialogTitle>
              <AlertDialogDescription>
                {policyId} will be recorded as {actionLabel(selected)} instead of {actionLabel(recommendedAction)}. The override and your reason are written to the audit log.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="font-bold" onClick={(event) => { event.preventDefault(); void submit(); }} disabled={submitting}>
                {submitting ? 'Saving' : 'Record override'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
