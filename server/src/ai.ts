// "Ask AI" — forwards a dashboard-assembled debugging context to an operator-configured,
// OpenAI-compatible chat endpoint (Ollama, LM Studio, OpenAI, OpenRouter, …). The endpoint is
// set by env only (no SSRF surface), and the context is data the user can already see.
import type { FastifyInstance } from 'fastify';
import { aiConfigured, cfg } from './config.js';
import { HttpError, notConfigured } from './errors.js';

const SYSTEM = `You are a senior Proxmox VE and Linux homelab SRE helping debug a self-hosted server through its dashboard (SPL Console). You are given real logs and system facts. Answer concisely in Markdown with three short sections:

**Most likely cause** — one or two sentences, naming the exact unit, vmid, device or service from the evidence.
**Fix** — concrete ordered steps; include the exact shell/pct/qm commands where useful.
**Verify** — how to confirm it worked.

Rules: use only the evidence provided; never invent log lines or values. If the evidence is insufficient, say precisely what to check or collect next. Prefer Proxmox/Debian specifics. Be direct and brief — this is for an operator who knows the system.`;

const PRIVATE_HOST = /^(https?:\/\/)?(10\.|127\.|localhost|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function registerAi(app: FastifyInstance) {
  app.get('/api/ai', async () => ({
    configured: aiConfigured(),
    label: cfg.ai.label || cfg.ai.model || 'AI assistant',
    model: cfg.ai.model,
    local: aiConfigured() && PRIVATE_HOST.test(cfg.ai.baseUrl), // true => the endpoint is on this LAN; data stays local
  }));

  app.post<{ Body: { context?: string; question?: string } }>('/api/ai/ask', async (req) => {
    if (!aiConfigured()) throw notConfigured('AI assistant');
    const context = String(req.body?.context ?? '').slice(0, 24000);
    const question = String(req.body?.question ?? '').slice(0, 500).trim();
    if (!context.trim()) throw new HttpError(400, 'BAD_REQUEST', 'No context to analyse');

    const content = `${question ? `The operator asks: ${question}\n\n` : 'Diagnose the following.\n\n'}${context}`;
    let res: Response;
    try {
      res = await fetch(`${cfg.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.ai.apiKey ? { Authorization: `Bearer ${cfg.ai.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.ai.model,
          temperature: 0.2,
          max_tokens: 900,
          stream: false,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      throw new HttpError(502, 'AI_UNREACHABLE', `Cannot reach the AI endpoint: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new HttpError(502, 'AI_ERROR', `AI endpoint returned ${res.status}: ${t.slice(0, 200) || res.statusText}`);
    }
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new HttpError(502, 'AI_ERROR', 'The AI endpoint returned an empty or unexpected response');
    req.log.info({ user: req.user?.username, model: cfg.ai.model, chars: context.length }, 'ai ask');
    return { answer: answer.trim(), model: cfg.ai.model };
  });
}
