import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { useToast } from '../hooks';
import type { AiInfo } from '../types';
import { Icon, Modal, Spinner } from './ui';

/** Assembles a clean, structured debugging prompt from what the user is looking at.
 *  Facts become a bullet list; each section a heading + body. Empty values are dropped. */
export function buildPrompt(subject: string, facts: Record<string, string | number | null | undefined>, sections: { title: string; body: string | string[] }[]): string {
  const f = Object.entries(facts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const s = sections
    .map((x) => ({ title: x.title, body: (Array.isArray(x.body) ? x.body.join('\n') : x.body).trim() }))
    .filter((x) => x.body)
    .map((x) => `## ${x.title}\n${x.body}`)
    .join('\n\n');
  return [`# ${subject}`, f, s].filter(Boolean).join('\n\n').trim();
}

// Cache the AI config across the session so every button knows instantly whether inline answers exist.
let aiCache: AiInfo | undefined;
function useAi(): AiInfo | undefined {
  const [info, setInfo] = useState<AiInfo | undefined>(aiCache);
  useEffect(() => {
    if (aiCache) return;
    api.ai().then((i) => { aiCache = i; setInfo(i); }).catch(() => setInfo({ configured: false, label: '', model: '', local: false }));
  }, []);
  return info;
}

export function AskAI({ subject, build, compact }: { subject: string; build: () => string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn btn-ai ${compact ? 'btn-ai-sm' : ''}`} onClick={() => setOpen(true)}>
        <Icon name="sparkles" size={15} />Ask AI
      </button>
      {open && <AskAIModal subject={subject} context={build()} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskAIModal({ subject, context, onClose }: { subject: string; context: string; onClose: () => void }) {
  const ai = useAi();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showContext, setShowContext] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(context); toast.success('Prompt copied — paste it into any AI'); }
    catch { setShowContext(true); toast.error('Clipboard blocked — select the text below to copy'); }
  }
  async function ask() {
    setBusy(true); setError(''); setAnswer(null);
    try { const r = await api.aiAsk(context, question); setAnswer(r.answer); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal wide title="Ask AI" onClose={onClose} footer={
      <>
        <button className="btn" onClick={copy}><Icon name="copy" size={15} />Copy prompt</button>
        {ai?.configured && <button className="btn btn-primary" onClick={ask} disabled={busy}>{busy ? <Spinner size={14} /> : <Icon name="sparkles" size={15} />}{answer ? 'Ask again' : 'Ask'}</button>}
      </>
    }>
      <p className="muted small ai-subject"><Icon name="sparkles" size={14} />{subject}</p>

      {ai?.configured ? (
        <label className="ai-q">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional: ask a specific question, or just press Ask"
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) ask(); }} autoFocus />
        </label>
      ) : (
        <div className="callout"><Icon name="alert" size={16} /><span>No AI endpoint is configured, so answers can't appear inline. <b>Copy prompt</b> works now — paste it into any AI. To answer here, set <code>AI_BASE_URL</code> and <code>AI_MODEL</code> on the server (a local Ollama keeps data on your network).</span></div>
      )}

      {busy && <div className="ai-thinking"><Spinner size={16} /><span>Analysing {ai?.local ? 'on your network' : `with ${ai?.label}`}…</span></div>}
      {error && <div className="callout err"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {answer !== null && (
        <div className="ai-answer">
          <div className="ai-answer-head"><span><Icon name="sparkles" size={14} />{ai?.label}</span><button className="link" onClick={() => navigator.clipboard?.writeText(answer).then(() => toast.success('Answer copied')).catch(() => {})}>Copy answer</button></div>
          <Markdown text={answer} />
        </div>
      )}

      <button className="ai-ctx-toggle" onClick={() => setShowContext((v) => !v)}>
        <Icon name={showContext ? 'moon' : 'list'} size={13} />{showContext ? 'Hide' : 'Show'} the context ({context.length.toLocaleString()} chars)
      </button>
      {showContext && <pre className="ai-ctx" onClick={(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); }}>{context}</pre>}
      {ai?.configured && <p className="muted ai-privacy">{ai.local ? 'This endpoint is on your LAN — the context stays on your network.' : `Pressing Ask sends the context above to ${ai.label}.`}</p>}
    </Modal>
  );
}

/** Minimal Markdown → JSX: headings, bold, inline code, fenced code, ordered/unordered lists. */
function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div className="md">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={i++}>{m[1]}</code>);
    else out.push(<strong key={i++}>{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function parseBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(<pre key={k++} className="md-code">{buf.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(<p key={k++} className={`md-h md-h${h[1].length}`}>{inline(h[2])}</p>); i++; continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''))}</li>);
        i++;
      }
      out.push(ordered ? <ol key={k++} className="md-list">{items}</ol> : <ul key={k++} className="md-list">{items}</ul>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    out.push(<p key={k++} className="md-p">{inline(line)}</p>);
    i++;
  }
  return out;
}
