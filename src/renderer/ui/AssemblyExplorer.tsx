/**
 * Assembly Explorer — every part listed with role, visibility, lock, selection,
 * rename, group membership; role quick-assign for multi-selection.
 */
import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { controller } from '../app/AppController';
import { PartRole } from '../../shared/types';
import { Btn, Chip } from './primitives';

const roleColor: Record<PartRole, 'cyan' | 'blue' | 'amber' | 'gray'> = {
  moving: 'cyan', deformable: 'amber', static: 'gray', unknown: 'blue',
};

export const AssemblyExplorer: React.FC = () => {
  const parts = useStore((s) => s.project.parts);
  const groups = useStore((s) => s.project.groups);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const modelFormat = useStore((s) => s.modelFormat);
  const setSelection = useStore((s) => s.setSelection);
  const updatePart = useStore((s) => s.updatePart);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const filtered = useMemo(
    () => parts.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()) || p.sourceName.toLowerCase().includes(filter.toLowerCase())),
    [parts, filter],
  );

  const clickPart = (id: string, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    } else {
      setSelection([id]);
    }
  };

  const assignRole = (role: PartRole): void => {
    const sel = new Set(selection);
    const updated = parts.map((p) => sel.has(p.id) ? { ...p, role, enabledForMotion: role === 'moving' } : p);
    useStore.getState().setParts(updated);
    // keep groups consistent: remove from groups if no longer moving/deformable
    const movingIds = updated.filter((p) => p.role === 'moving').map((p) => p.id);
    if (groups.length > 0) {
      const keep = groups[0].partIds.filter((id) => movingIds.includes(id));
      useStore.getState().updateGroup(groups[0].id, { partIds: keep });
    }
    controller.rebuildMotion();
    useStore.getState().log('info', `Role ${role.toUpperCase()} assigned to ${sel.size} part(s).`);
  };

  const toggleGroupMembership = (partId: string): void => {
    if (groups.length === 0) return;
    const g = groups[0];
    const has = g.partIds.includes(partId);
    const next = has ? g.partIds.filter((id) => id !== partId) : [...g.partIds, partId];
    useStore.getState().updateGroup(g.id, { partIds: next });
    useStore.getState().updatePart(partId, { groupId: has ? null : g.id, enabledForMotion: !has });
    controller.rebuildMotion();
  };

  const selSummary = selection.length > 0
    ? `${selection.length} selected`
    : `${parts.length} parts`;

  return (
    <div className="explorer">
      <div className="panel-head">
        <span className="panel-title">ASSEMBLY EXPLORER</span>
        <Chip color={modelFormat === 'procedural' ? 'blue' : 'cyan'}>{modelFormat.toUpperCase()}</Chip>
      </div>
      <div className="explorer-search">
        <input placeholder="Filter parts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="explorer-list">
        {filtered.map((p) => {
          const idx = parts.indexOf(p) + 1;
          const isSel = selection.includes(p.id);
          const inGroup = groups.some((g) => g.partIds.includes(p.id) && g.enabled);
          return (
            <div
              key={p.id}
              className={`explorer-row${isSel ? ' is-selected' : ''}${hover === p.id ? ' is-hover' : ''}${!p.visible ? ' is-hidden' : ''}`}
              onClick={(e) => clickPart(p.id, e)}
              onDoubleClick={() => { setRenaming(p.id); setRenameVal(p.name); }}
            >
              <span className="part-index">{String(idx).padStart(2, '0')}</span>
              {renaming === p.id ? (
                <input
                  className="rename-input" autoFocus value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => { updatePart(p.id, { name: renameVal || p.name }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { updatePart(p.id, { name: renameVal || p.name }); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="part-name" title={`${p.name} (${p.sourceName})`}>{p.name}</span>
              )}
              {inGroup && p.role === 'moving' && <span className="motion-ind" title="Enabled motion group — animated with audio">◉</span>}
              {p.role === 'deformable' && <span className="motion-ind deform" title="Deformable (flex approximation)">≈</span>}
              <Chip color={roleColor[p.role]}>{p.role === 'deformable' ? 'FLEX' : p.role.slice(0, 3).toUpperCase()}</Chip>
              <button
                className={`icon-btn${p.visible ? '' : ' is-off'}`}
                title={p.visible ? 'Hide' : 'Show'}
                onClick={(e) => { e.stopPropagation(); updatePart(p.id, { visible: !p.visible }); controller.setPartVisible(p.id, !p.visible); }}
              >
                {p.visible ? '◉' : '○'}
              </button>
              <button
                className={`icon-btn${p.locked ? ' is-locked' : ''}`}
                title={p.locked ? 'Unlock' : 'Lock (protect from edits)'}
                onClick={(e) => { e.stopPropagation(); updatePart(p.id, { locked: !p.locked }); }}
              >
                {p.locked ? '▣' : '▢'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="explorer-footer">
        <div className="row-between">
          <span className="muted">{selSummary}</span>
          <span className="muted">{groups.reduce((n, g) => n + (g.enabled ? g.partIds.length : 0), 0)} animated</span>
        </div>
        <div className="role-assign">
          <span className="muted">Assign:</span>
          <Btn variant="ghost" onClick={() => assignRole('static')} disabled={!selection.length}>Static</Btn>
          <Btn variant="accent" onClick={() => assignRole('moving')} disabled={!selection.length}>Moving</Btn>
          <Btn variant="ghost" onClick={() => assignRole('deformable')} disabled={!selection.length}>Flex</Btn>
          <Btn
            variant="ghost" onClick={() => selection.forEach((id) => toggleGroupMembership(id))}
            disabled={!selection.length}
            title="Toggle membership in Cone Assembly group"
          >±Group</Btn>
        </div>
      </div>
    </div>
  );
};
