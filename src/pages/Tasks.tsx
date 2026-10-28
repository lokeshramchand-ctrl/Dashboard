import { useState } from 'react';
import { api } from '../api';
import { Chips, PageHeader } from '../components/ui';
import { TaskTable, taskName } from '../components/Pve';
import { useQuery, useSearch } from '../hooks';

type Filter = 'all' | 'errors' | 'running';

export default function Tasks() {
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery(() => api.tasks({ errors: filter === 'errors', limit: 200 }), [filter], 5000);
  const { q: s } = useSearch();
  const needle = s.trim().toLowerCase();
  const view = {
    ...q,
    data: q.data?.filter((t) => (filter !== 'running' || t.status === 'running') && (!needle || `${taskName(t)} ${t.type} ${t.user} ${t.message}`.toLowerCase().includes(needle))),
  };
  return (
    <>
      <PageHeader eyebrow="Datacenter" title="Task log" sub="Every Proxmox task on this node, newest first. Select a task to read its log." />
      <div className="toolbar">
        <Chips value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'All tasks' }, { id: 'running', label: 'Running', count: q.data?.filter((t) => t.status === 'running').length },
          { id: 'errors', label: 'Errors only' },
        ]} />
      </div>
      <TaskTable q={view} />
    </>
  );
}
