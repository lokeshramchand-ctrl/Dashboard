import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Spinner } from './ui';

type State = 'connecting' | 'live' | 'closed' | 'error';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function theme() {
  return {
    background: '#0c0c0c', foreground: '#f2f2f2', cursor: '#f2f2f2', selectionBackground: '#ffffff33',
    red: css('--red'), green: css('--green'), blue: css('--blue'), magenta: css('--peri'),
    brightRed: css('--red'), brightGreen: css('--green'), brightBlue: css('--blue'), brightMagenta: css('--peri'),
  };
}

/** Root shell for a guest over GET /api/guests/:vmid/shell (WebSocket). Protocol is documented in server/src/shell.ts. */
export function Terminal({ vmid, active }: { vmid: number; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm>();
  const fit = useRef<FitAddon>();
  const ws = useRef<WebSocket>();
  const [state, setState] = useState<State>('connecting');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState(0);

  // One xterm instance for the lifetime of the tab.
  useEffect(() => {
    if (!host.current) return;
    const t = new XTerm({
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13.5, cursorBlink: true, scrollback: 5000,
      allowProposedApi: false, theme: theme(),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    f.fit();
    term.current = t;
    fit.current = f;
    const data = t.onData((d) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: 'i', d })); });
    const ro = new ResizeObserver(() => { try { f.fit(); } catch { /* hidden */ } });
    ro.observe(host.current);
    const resize = t.onResize(({ cols, rows }) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: 'r', cols, rows })); });
    return () => { data.dispose(); resize.dispose(); ro.disconnect(); t.dispose(); };
  }, []);

  // (Re)connect whenever the tab is shown or the user asks for a new session.
  useEffect(() => {
    const t = term.current;
    if (!active || !t) return;
    setState('connecting');
    setMessage('');
    t.reset();
    try { fit.current?.fit(); } catch { /* hidden */ }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}/api/guests/${vmid}/shell?cols=${t.cols}&rows=${t.rows}`);
    s.binaryType = 'arraybuffer';
    ws.current = s;
    let failed = false;
    s.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          const m = JSON.parse(e.data);
          if (m.t === 'ready') { setState('live'); t.focus(); }
          else if (m.t === 'error') { failed = true; setMessage(m.message); setState('error'); }
          else if (m.t === 'exit') setState((x) => (x === 'error' ? x : 'closed'));
        } catch { /* ignore */ }
      } else t.write(new Uint8Array(e.data as ArrayBuffer));
    };
    s.onerror = () => { failed = true; setMessage('Cannot reach the server'); setState('error'); };
    s.onclose = () => { if (!failed) setState((x) => (x === 'error' ? x : 'closed')); };
    return () => { s.onmessage = s.onerror = s.onclose = null; s.close(); };
  }, [vmid, active, session]);

  const ended = state === 'closed' || state === 'error';
  const send = useCallback((d: string) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify({ t: 'i', d })), []);

  return (
    <div className="term-wrap">
      <div className="term-bar">
        <span className={`term-state ${state}`}>
          {state === 'connecting' && <><Spinner size={12} />Connecting…</>}
          {state === 'live' && <><i className="dot" />Connected</>}
          {state === 'closed' && 'Session ended'}
          {state === 'error' && 'Unavailable'}
        </span>
        <span className="term-keys">
          <button className="btn btn-ghost" disabled={state !== 'live'} onClick={() => send('\x03')} title="Send Ctrl+C">Ctrl+C</button>
          <button className="btn btn-ghost" disabled={state !== 'live'} onClick={() => send('\x04')} title="Send Ctrl+D">Ctrl+D</button>
          <button className="btn btn-ghost" disabled={state !== 'live'} onClick={() => send('\x09')} title="Send Tab">Tab</button>
          <button className="btn" disabled={state === 'connecting'} onClick={() => setSession((n) => n + 1)}><Icon name="refresh" size={15} />{ended ? 'Reconnect' : 'New session'}</button>
        </span>
      </div>
      <div className="term-screen">
        <div ref={host} className="term-host" />
        {state === 'error' && (
          <div className="term-over"><Icon name="alert" size={22} /><strong>Shell unavailable</strong><p>{message}</p></div>
        )}
      </div>
    </div>
  );
}
