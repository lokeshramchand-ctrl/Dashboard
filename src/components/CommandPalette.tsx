import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui';
import type { IconName } from './ui';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase().includes(needle));
  }, [q, commands]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setCursor(0), [q]);

  function pick(c?: Command) {
    if (!c) return;
    onClose();
    c.run();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[cursor]); }
  }

  return (
    <div className="scrim cmdk-scrim" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="cmdk-input">
          <Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page, guest or action…" aria-label="Command" role="combobox" aria-expanded="true" aria-controls="cmdk-list" />
          <kbd>esc</kbd>
        </label>
        <ul className="cmdk-list" id="cmdk-list" role="listbox">
          {results.length === 0 && <li className="cmdk-empty muted">No matches for “{q}”</li>}
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === cursor}>
              {(i === 0 || results[i - 1].group !== c.group) && <p className="cmdk-group">{c.group}</p>}
              <button className={i === cursor ? 'on' : ''} onMouseMove={() => setCursor(i)} onClick={() => pick(c)}>
                <Icon name={c.icon} size={17} />
                <span className="grow">{c.label}</span>
                {c.hint && <small className="muted">{c.hint}</small>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
