/**
 * Top bar: logo, full menu system, transport controls, simulation status.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { controller } from '../app/AppController';
import { Btn } from './primitives';

type MenuDef = { label: string; items: (MenuItem | 'sep')[] };
type MenuItem =
  | { label: string; action: () => void; shortcut?: string; disabled?: boolean }
  | { label: string; submenu: (MenuItem | 'sep')[] };

const fmtTime = (s: number): string => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const TopBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const transport = useStore((s) => s.transport);
  const position = useStore((s) => s.positionSec);
  const duration = useStore((s) => s.durationSec);
  const volume = useStore((s) => s.volume);
  const loop = useStore((s) => s.loop);
  const audioName = useStore((s) => s.audioName);
  const analyzing = useStore((s) => s.analyzing);
  const dirty = useStore((s) => s.dirty);
  const projectName = useStore((s) => s.project.name);
  const setPositionSec = useStore((s) => s.setPosition);
  const setLoop = useStore((s) => s.setLoop);
  const setVolume = useStore((s) => s.setVolume);

  useEffect(() => {
    // keep displayed duration in sync
    const iv = window.setInterval(() => {
      const d = controller.audio.duration;
      if (d !== useStore.getState().durationSec) {
        useStore.setState({ durationSec: d });
      }
      if (useStore.getState().transport === 'playing') {
        // position updated by loop; but ensure position state refresh even when paused-seek
      }
    }, 500);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const menus: MenuDef[] = [
    {
      label: 'File', items: [
        { label: 'New Project', action: () => void controller.newProject(), shortcut: 'Ctrl+N' },
        { label: 'Open Project…', action: () => void controller.openProject(), shortcut: 'Ctrl+O' },
        { label: 'Save Project', action: () => void controller.saveProject(), shortcut: 'Ctrl+S' },
        { label: 'Save Project As…', action: () => void controller.saveProjectAs(), shortcut: 'Ctrl+Shift+S' },
        'sep',
        { label: 'Export Curves (CSV)', action: () => controller.exportCurvesCSV() },
        { label: 'Export Report (PDF)', action: () => void controller.exportReportPDF() },
      ],
    },
    {
      label: 'Model', items: [
        { label: 'Import 3D Model…', action: () => void controller.importModel(), shortcut: 'Ctrl+M' },
        { label: 'Apply Studio Materials', action: () => void controller.reapplyStudioMaterials() },
        'sep',
        { label: 'Reload Reference Assembly', action: () => void controller.loadDefaultAssembly() },
      ],
    },
    {
      label: 'Audio', items: [
        { label: 'Import Audio…', action: () => void controller.importAudio(), shortcut: 'Ctrl+I' },
        {
          label: 'Generate Test Signal', submenu: [
            { label: 'Sine Sweep 20–80 Hz', action: () => void controller.generateTestSignal('sweep') },
            { label: 'Kick Pattern 50 BPM', action: () => void controller.generateTestSignal('kick') },
            { label: '40 Hz Tone', action: () => void controller.generateTestSignal('tone40') },
            { label: 'Bass Demo Loop', action: () => void controller.generateTestSignal('musicish') },
          ],
        },
        'sep',
        { label: transport === 'playing' ? 'Pause' : 'Play', action: () => controller.toggleTransport(), shortcut: 'Space' },
        { label: 'Stop', action: () => controller.stop(), shortcut: 'S' },
      ],
    },
    {
      label: 'Simulation', items: [
        { label: 'Recompute Physics', action: () => { controller.recomputePhysics(); useStore.getState().log('ok', 'Physics recomputed.'); } },
        { label: 'Reset Motion (rest pose)', action: () => controller.resetMotion(), shortcut: 'R' },
        'sep',
        { label: 'Analyze Current Audio', action: () => void controller.analyzeCurrentAudio(false) },
      ],
    },
    {
      label: 'View', items: [
        { label: 'Front', action: () => controller.standardView('front'), shortcut: '1' },
        { label: 'Back', action: () => controller.standardView('back'), shortcut: '2' },
        { label: 'Left', action: () => controller.standardView('left'), shortcut: '3' },
        { label: 'Right', action: () => controller.standardView('right'), shortcut: '4' },
        { label: 'Top', action: () => controller.standardView('top'), shortcut: '5' },
        { label: 'Isometric', action: () => controller.standardView('iso'), shortcut: '6' },
        'sep',
        { label: 'Fit To View', action: () => controller.resetCamera(), shortcut: 'F' },
        { label: 'Toggle Auto-Rotate', action: () => {
          const cur = useStore.getState().project.view.autoRotate;
          useStore.getState().patchView({ autoRotate: !cur });
          controller.viewport.setAutoRotate(!cur);
        } },
        { label: 'Toggle Grid', action: () => {
          const cur = useStore.getState().project.view.showGrid;
          useStore.getState().patchView({ showGrid: !cur });
          controller.viewport.setGridVisible(!cur);
        } },
      ],
    },
    {
      label: 'Help', items: [
        { label: 'About Sonivex Studio', action: () => useStore.getState().log('info', 'Sonivex Studio 1.0.0 — Design. Simulate. Validate. Professional subwoofer design, audio visualization and virtual test bench.') },
        { label: 'Open Data Folder', action: () => void bridgeShowData() },
      ],
    },
  ];

  const renderItems = (items: (MenuItem | 'sep')[], depth = 0): React.ReactNode =>
    items.map((it, i) => {
      if (it === 'sep') return <div key={i} className="menu-sep" />;
      if ('submenu' in it) {
        return (
          <div key={i} className="menu-item has-sub">
            <span>{it.label}</span>
            <span className="menu-sub-arrow">▸</span>
            <div className="menu-dropdown menu-sub" style={{ left: '100%', top: depth === 0 ? undefined : -4 }}>
              {renderItems(it.submenu, depth + 1)}
            </div>
          </div>
        );
      }
      return (
        <button
          key={i}
          className="menu-item"
          disabled={it.disabled}
          onClick={() => { setOpenMenu(null); it.action(); }}
        >
          <span>{it.label}</span>
          {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
        </button>
      );
    });

  return (
    <div className="topbar" ref={barRef}>
      <div className="brand">
        <div className="brand-logo">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <defs>
              <radialGradient id="lg" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#8A8A8A" />
              </radialGradient>
            </defs>
            <circle cx="16" cy="16" r="13.5" fill="none" stroke="url(#lg)" strokeWidth="2" />
            <circle cx="16" cy="16" r="9" fill="none" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.7" />
            <circle cx="16" cy="16" r="5" fill="none" stroke="#F0F0F0" strokeWidth="1.4" />
            <circle cx="16" cy="16" r="1.8" fill="#F0F0F0" />
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">SONIVEX <b>STUDIO</b></span>
          <span className="brand-tag">Design. Simulate. Validate.</span>
        </div>
      </div>

      <nav className="menubar">
        {menus.map((m) => (
          <div key={m.label} className="menu-root">
            <button
              className={`menu-root-btn${openMenu === m.label ? ' is-open' : ''}`}
              onClick={() => setOpenMenu(openMenu === m.label ? null : m.label)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(m.label); }}
            >
              {m.label}
            </button>
            {openMenu === m.label && (
              <div className="menu-dropdown">{renderItems(m.items)}</div>
            )}
          </div>
        ))}
      </nav>

      <div className="topbar-center">
        <div className="transport">
          <Btn variant="ghost" onClick={() => controller.stop()} title="Stop (S)">■</Btn>
          <Btn variant="accent" onClick={() => controller.toggleTransport()} title="Play/Pause (Space)">
            {transport === 'playing' ? '❚❚' : '▶'}
          </Btn>
          <Btn variant="ghost" active={loop} onClick={() => setLoop(!loop)} title="Loop">↻</Btn>
          <span className="time-readout">
            <b>{fmtTime(position)}</b> / {fmtTime(duration)}
          </span>
          <input
            className="seekbar" type="range" min={0} max={Math.max(duration, 0.1)} step={0.05}
            value={Math.min(position, duration || 0.1)}
            onChange={(e) => { const v = parseFloat(e.target.value); controller.seek(v); setPositionSec(v); }}
            disabled={!audioName}
          />
          <span className="vol-icon">🔊</span>
          <input
            className="volbar" type="range" min={0} max={1} step={0.01} value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            title="Volume"
          />
        </div>
      </div>

      <div className="topbar-right">
        <span className={`sim-chip${analyzing ? ' is-busy' : transport === 'playing' ? ' is-live' : ''}`}>
          <span className="sim-dot" />
          {analyzing ? 'ANALYZING' : transport === 'playing' ? 'SIM LIVE' : 'IDLE'}
        </span>
        <span className="project-chip" title="Project">
          {dirty && <span className="dirty-dot" />}
          {projectName}
        </span>
      </div>
    </div>
  );
};

async function bridgeShowData(): Promise<void> {
  const info = await window.sonivex.appInfo();
  useStore.getState().log('info', `User data: ${info.userData}`);
}
