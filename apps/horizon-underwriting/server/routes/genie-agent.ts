import { Readable } from 'node:stream';
import { Config } from '@databricks/sdk-experimental';
import type { Request, Response } from 'express';
import { z } from 'zod';

// Proxies the Genie Agent mode API (POST /api/2.0/genie/agents/{id}/responses) as the
// signed-in user and streams its Server-Sent Events to the browser unchanged.
// Agent mode plans multi-step answers over the governed tables, metric view, and the
// underwriting_guidelines volume, with citations. AppKit's genie plugin only speaks the
// Conversation API, so this route calls the endpoint directly.

export const GenieAskBody = z.object({
  question: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  policyId: z.string().optional(),
});

// DATABRICKS_HOST is set in Databricks Apps; local dev resolves the host from the CLI profile.
async function workspaceHost() {
  const host = process.env.DATABRICKS_HOST ?? (await new Config({}).getHost()).toString();
  return (host.startsWith('http') ? host : `https://${host}`).replace(/\/$/, '');
}

export async function streamGenieAnswer(req: Request, res: Response, input: z.infer<typeof GenieAskBody>) {
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID;
  const token = req.header('x-forwarded-access-token');
  if (!spaceId) throw new Error('DATABRICKS_GENIE_SPACE_ID is not set');
  if (!token) {
    res.status(401).json({ error: 'No user token. Genie runs as the signed-in user.' });
    return;
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const upstream = await fetch(`${await workspaceHost()}/api/2.0/genie/agents/${spaceId}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input.question }] }],
      ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    }),
    signal: controller.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    const message = upstream.status === 409
      ? 'Genie is still answering the previous question in this conversation.'
      : (() => { try { return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { return text; } })();
    res.status(upstream.status === 409 ? 409 : 502).json({ error: message || `Genie returned ${upstream.status}` });
    return;
  }

  res.status(200);
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  Readable.fromWeb(upstream.body)
    .on('error', () => res.end())
    .pipe(res);
}
