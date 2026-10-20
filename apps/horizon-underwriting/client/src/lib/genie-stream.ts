// Reads the Genie Agent mode SSE stream relayed by POST /api/genie/ask.
// Event reference: https://docs.databricks.com/api/genie/v1/agent-mode-create-response

export type GenieItem =
  | { kind: 'reasoning'; id: string; text: string; done: boolean }
  | { kind: 'query'; id: string; callId: string; title: string; sql: string }
  | { kind: 'result'; id: string; callId: string; markdown: string; done: boolean }
  | { kind: 'message'; id: string; text: string; done: boolean };

interface RawItem {
  type: string;
  id?: string;
  call_id?: string;
  status?: string;
  name?: string;
  arguments?: string;
  output?: string;
  role?: string;
  content?: { type?: string; text?: string }[];
  summary?: { text?: string }[];
}

function text(parts: { text?: string }[] | undefined, separator = '') {
  return (parts ?? []).map((part) => part.text ?? '').filter(Boolean).join(separator);
}

function toItem(raw: RawItem, index: number): GenieItem | null {
  const id = raw.id ?? String(index);
  const done = raw.status === 'completed';
  if (raw.type === 'reasoning') return { kind: 'reasoning', id, text: text(raw.content) || text(raw.summary), done };
  if (raw.type === 'function_call') {
    let args: { title?: string; sql?: string } = {};
    try { args = JSON.parse(raw.arguments ?? '{}') as typeof args; } catch { /* partial arguments while streaming */ }
    return { kind: 'query', id, callId: raw.call_id ?? id, title: args.title ?? 'Query', sql: args.sql ?? '' };
  }
  if (raw.type === 'function_call_output') return { kind: 'result', id, callId: raw.call_id ?? id, markdown: raw.output ?? '', done };
  // Messages arrive as separate chunks (prose, then titled tables); keep them as separate blocks.
  if (raw.type === 'message' && raw.role !== 'user') return { kind: 'message', id, text: text(raw.content, '\n\n'), done };
  return null;
}

export interface GenieStreamHandlers {
  onConversation: (conversationId: string) => void;
  onItem: (index: number, item: GenieItem) => void;
}

export async function askGenie(
  body: { question: string; conversationId?: string; policyId?: string },
  handlers: GenieStreamHandlers,
  signal: AbortSignal,
) {
  const response = await fetch('/api/genie/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    let message = detail;
    try { message = (JSON.parse(detail) as { error?: string }).error ?? detail; } catch { /* plain text */ }
    throw new Error(message || `Genie request failed (${response.status})`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join('\n');
      if (!data) continue;
      let parsed: { type?: string; conversation_id?: string; output_index?: number; item?: RawItem; response?: { conversation_id?: string; error?: { message?: string } } };
      try { parsed = JSON.parse(data) as typeof parsed; } catch { continue; }
      const conversationId = parsed.conversation_id ?? parsed.response?.conversation_id;
      if (conversationId) handlers.onConversation(conversationId);
      if (parsed.item && typeof parsed.output_index === 'number') {
        const item = toItem(parsed.item, parsed.output_index);
        if (item) handlers.onItem(parsed.output_index, item);
      }
      if (parsed.type === 'response.failed') throw new Error(parsed.response?.error?.message ?? 'Genie could not answer this question.');
      if (parsed.type === 'response.completed') finished = true;
    }
  }
  if (!finished && !signal.aborted) throw new Error('The Genie stream ended before the answer was complete.');
}
