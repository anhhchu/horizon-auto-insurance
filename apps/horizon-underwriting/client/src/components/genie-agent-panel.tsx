import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, FieldLabel, Spinner, Textarea } from '@databricks/appkit-ui/react';
import { ChevronRight, Database, MessageSquareText } from 'lucide-react';
import { Markdown } from '@/components/markdown';
import { ErrorState } from '@/components/states';
import { askGenie, type GenieItem } from '@/lib/genie-stream';

interface Turn {
  question: string;
  items: GenieItem[];
  error: string;
  done: boolean;
}

interface GenieAgentPanelProps {
  title: string;
  description: string;
  starters: string[];
  policyId?: string;
}

function Steps({ items, running }: { items: GenieItem[]; running: boolean }) {
  const steps = items.filter((item) => item.kind !== 'message');
  if (steps.length === 0) return null;
  const queries = steps.filter((item): item is Extract<GenieItem, { kind: 'query' }> => item.kind === 'query');
  const results = new Map(steps.filter((item): item is Extract<GenieItem, { kind: 'result' }> => item.kind === 'result').map((item) => [item.callId, item]));
  const latest = queries.at(-1);
  return (
    <details className="group rounded-md border bg-card" open={running}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        <Database className="size-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{running && latest ? `Running: ${latest.title}` : `How Genie answered · ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}`}</span>
      </summary>
      <ol className="space-y-4 border-t px-3 py-3">
        {steps.map((item) => {
          if (item.kind === 'reasoning') return item.text ? <li key={item.id} className="text-sm text-muted-foreground">{item.text}</li> : null;
          if (item.kind === 'query') {
            const result = results.get(item.callId);
            return (
              <li key={item.id} className="space-y-2">
                <div className="text-sm font-medium">{item.title}</div>
                {item.sql && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-sm leading-6"><code>{item.sql}</code></pre>}
                {result?.markdown && <Markdown text={result.markdown.replace(/^\*\*[^*]+\*\*\s*/, '')} />}
              </li>
            );
          }
          return null;
        })}
      </ol>
    </details>
  );
}

export function GenieAgentPanel({ title, description, starters, policyId }: GenieAgentPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const updateLast = (update: (turn: Turn) => Turn) =>
    setTurns((current) => current.map((turn, index) => (index === current.length - 1 ? update(turn) : turn)));

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setElapsed(0); setQuestion('');
    setTurns((current) => [...current, { question: trimmed, items: [], error: '', done: false }]);
    try {
      await askGenie({ question: trimmed, conversationId, policyId }, {
        onConversation: setConversationId,
        onItem: (index, item) => updateLast((turn) => {
          const items = [...turn.items];
          items[index] = item;
          return { ...turn, items };
        }),
      }, controller.signal);
      updateLast((turn) => ({ ...turn, done: true }));
    } catch (cause) {
      if (!controller.signal.aborted) updateLast((turn) => ({ ...turn, done: true, error: cause instanceof Error ? cause.message : 'Genie request failed' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="hz-section-title flex items-center gap-2"><MessageSquareText className="size-5" aria-hidden="true" />{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {turns.length === 0 && (
          <div className="flex flex-col gap-2">
            {starters.map((starter) => (
              <Button key={starter} variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left font-normal" onClick={() => void ask(starter)}>
                {starter}
              </Button>
            ))}
          </div>
        )}

        {turns.map((turn, index) => {
          const running = busy && index === turns.length - 1;
          const answer = turn.items.filter((item): item is Extract<GenieItem, { kind: 'message' }> => item.kind === 'message').map((item) => item.text).join('\n\n');
          return (
            <section key={index} aria-label={`Question ${index + 1}`} className="space-y-3">
              <p className="rounded-md bg-muted px-3 py-2 font-medium">{turn.question}</p>
              <Steps items={turn.items} running={running} />
              {running && !answer && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                  <Spinner /> Genie is working · <span className="hz-num">{elapsed}s</span>
                </p>
              )}
              {answer && <Markdown text={answer} />}
              {turn.error && <ErrorState title="Genie could not answer" message={turn.error} onRetry={!busy ? () => void ask(turn.question) : undefined} />}
            </section>
          );
        })}

        {turns.some((turn) => turn.done && !turn.error) && (
          <p className="border-t pt-3 text-sm text-muted-foreground">AI-generated by Genie from governed data and the underwriting guidelines, as you. Check the sources before you decide.</p>
        )}

        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <Field>
            <FieldLabel htmlFor={`genie-question-${policyId ?? 'portfolio'}`}>{turns.length ? 'Follow-up question' : 'Your question'}</FieldLabel>
            <Textarea
              id={`genie-question-${policyId ?? 'portfolio'}`}
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(question); } }}
              placeholder={policyId ? `Ask about ${policyId}` : 'Ask about the West portfolio'}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy || !question.trim()}>
            {busy && <Spinner />}{busy ? 'Genie is answering' : 'Ask Genie'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
