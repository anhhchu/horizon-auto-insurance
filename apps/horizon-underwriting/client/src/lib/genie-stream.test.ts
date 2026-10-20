import { afterEach, describe, expect, test, vi } from 'vitest';
import { askGenie, type GenieItem } from './genie-stream';

// Event shapes captured from the live Agent mode endpoint (2026-10-20).
const events = [
  { type: 'response.created', sequence_number: 0, response: { id: 'r1', status: 'in_progress', output: [], conversation_id: 'c1' } },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'q1', call_id: 'q1', status: 'completed', name: 'execute_sql', arguments: JSON.stringify({ title: 'West policies requiring review', sql: 'SELECT 1' }) } },
  { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call_output', id: 'q1_output', call_id: 'q1', status: 'completed', output: '| Risk Band | n |\n| --- | --- |\n| High | 203 |' } },
  { type: 'response.output_item.done', output_index: 2, item: { type: 'reasoning', id: 'r', status: 'completed', content: [{ type: 'reasoning_text', text: 'Counting by band.' }] } },
  { type: 'response.output_item.done', output_index: 3, item: { type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '242 policies require review \\[[1](https://x)\\].' }] } },
  { type: 'response.completed', sequence_number: 9, response: { conversation_id: 'c1' } },
];

function sse(chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('askGenie', () => {
  test('parses query, result, reasoning, and message items across chunk boundaries', async () => {
    const body = events.map((event) => `event:${event.type}\ndata:${JSON.stringify(event)}\n\n`).join('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([body.slice(0, 137), body.slice(137, 500), body.slice(500)])));
    const items: GenieItem[] = [];
    let conversation = '';
    await askGenie({ question: 'q' }, { onConversation: (id) => { conversation = id; }, onItem: (index, item) => { items[index] = item; } }, new AbortController().signal);
    expect(conversation).toBe('c1');
    expect(items.map((item) => item.kind)).toEqual(['query', 'result', 'reasoning', 'message']);
    expect(items[0]).toMatchObject({ title: 'West policies requiring review', sql: 'SELECT 1' });
    expect(items[3]).toMatchObject({ text: '242 policies require review \\[[1](https://x)\\].' });
  });

  test('surfaces response.failed and server errors', async () => {
    const failed = { type: 'response.failed', response: { error: { message: 'Warehouse unavailable' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([`data:${JSON.stringify(failed)}\n\n`])));
    await expect(askGenie({ question: 'q' }, { onConversation: () => {}, onItem: () => {} }, new AbortController().signal)).rejects.toThrow('Warehouse unavailable');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Genie is still answering' }), { status: 409 })));
    await expect(askGenie({ question: 'q' }, { onConversation: () => {}, onItem: () => {} }, new AbortController().signal)).rejects.toThrow('Genie is still answering');
  });
});
