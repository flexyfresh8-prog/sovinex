/**
 * App root: layout, keyboard shortcuts, drag & drop, selection sync, overlays.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { controller } from './app/AppController';
import { TopBar } from './ui/TopBar';
import { AssemblyExplorer } from './ui/AssemblyExplorer';
import { RightPanel } from './ui/RightPanel';
import { BottomDock } from './ui/BottomDock';
import { HudCluster } from './ui/Gauges';
import { Toggle } from './ui/primitives';

interface Toast { id: number; level: 'warn' | 'error' | 'ok'; msg: string }

export const App: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [booted, setBooted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hudVisible, setHudVisible] = useState(true);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const project = useStore((s) => s.project);
  const importStage = useStore((s) => s.importStage);

  // boot
  useEffect(() => {
    if (!viewportRef.current) return;
    void controller.init(viewportRef.current).then(() => setBooted(true));
    return () => { /* singleton app; no dispose on HMR */ };
  }, []);

  // selection → viewport sync
  useEffect(() => { controller.refreshSelection(); }, [selection, project.parts, project.view.shading]);
  // view props sync
  useEffect(() => { controller.viewport.setExplode(project.view.explode); }, [project.view.explode]);
  useEffect(() => { controller.viewport.setProjection(project.view.projection === 'orthographic'); }, [project.view.projection]);
  useEffect(() => { controller.viewport.setAutoRotate(project.view.autoRotate); }, [project.view.autoRotate]);
  useEffect(() => { controller.viewport.setGridVisible(project.view.showGrid); }, [project.view.showGrid]);

  // toasts from console warn/error
  const lineCount = useStore((s) => s.consoleLines.length);
  const lastLineId = useRef(0);
  useEffect(() => {
    const lines = useStore.getState().consoleLines;
    for (let i = lastLineId.current; i < lines.length; i++) {
      const l = lines[i];
      if (l.level === 'warn' || l.level === 'error' || l.level === 'ok') {
        const id = Date.now() + i;
        setToasts((t) => [...t.slice(-3), { id, level: l.level as Toast['level'], msg: l.msg }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), l.level === 'error' ? 6000 : 3800);
      }
    }
    lastLineId.current = lines.length;
  }, [lineCount]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's' && e.shiftKey) { e.preventDefault(); void controller.saveProjectAs(); return; }
        if (e.key === 's') { e.preventDefault(); void controller.saveProject(); return; }
        if (e.key === 'o') { e.preventDefault(); void controller.openProject(); return; }
        if (e.key === 'n') { e.preventDefault(); void controller.newProject(); return; }
        if (e.key === 'm') { e.preventDefault(); void controller.importModel(); return; }
        if (e.key === 'i') { e.preventDefault(); void controller.importAudio(); return; }
        return;
      }
      switch (e.key) {
        case ' ': e.preventDefault(); controller.toggleTransport(); break;
        case 's': case 'S': controller.stop(); break;
        case 'r': case 'R': controller.resetMotion(); break;
        case 'f': case 'F': controller.resetCamera(); break;
        case 'ArrowRight': controller.seek(Math.min(useStore.getState().positionSec + 5, useStore.getState().durationSec)); break;
        case 'ArrowLeft': controller.seek(Math.max(useStore.getState().positionSec - 5, 0)); break;
        case '1': controller.standardView('front'); break;
        case '2': controller.standardView('back'); break;
        case '3': controller.standardView('left'); break;
        case '4': controller.standardView('right'); break;
        case '5': controller.standardView('top'); break;
        case '6': controller.standardView('iso'); break;
        case 'Escape': useStore.getState().setSelection([]); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drag & drop: audio + models
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => { e.preventDefault(); };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      void file.arrayBuffer().then((ab) => {
        const data = new Uint8Array(ab);
        if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) {
          void controller.loadAudioFromData(file.name, null, data, 'file');
        } else if (['glb', 'gltf', 'obj', 'fbx'].includes(ext)) {
          useStore.getState().setImportStage({ active: true, pct: 2, stage: 'Reading dropped file' });
          import('./app/importModel').then(async (mod) => {
            try {
              const result = await mod.parseModel(file.name, data, { smooth: true, studioMaterials: true }, (pct, stage) => {
                useStore.getState().setImportStage({ active: true, pct, stage });
              });
              await controller.applyImportedResult(file.name, result.root, result.parts, result.format);
            } finally {
              useStore.getState().setImportStage({ active: false, pct: 0, stage: '' });
            }
          });
        }
      });
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); };
  }, []);

  const hoverPart = hover ? project.parts.find((p) => p.id === hover) : null;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        <div className="left-rail"><AssemblyExplorer /></div>
        <div className="viewport-area">
          <div ref={viewportRef} className="viewport-host" />
          <div className="viewport-overlay">
            {/* hover tooltip */}
            {hoverPart && (
              <div className="hover-card" style={{ pointerEvents: 'none' }}>
                <b>{hoverPart.name}</b>
                <span className="muted">{hoverPart.sourceName} · {hoverPart.role}</span>
                <span className="muted mono">{hoverPart.metrics.triangleCount.toLocaleString()} tris</span>
              </div>
            )}
            {/* view cube strip */}
            <div className="view-strip">
              {([['front', 'F'], ['back', 'B'], ['left', 'L'], ['right', 'R'], ['top', 'T'], ['iso', 'ISO']] as const).map(([v, label]) => (
                <button key={v} onClick={() => controller.standardView(v)}>{label}</button>
              ))}
              <span className="view-strip-sep" />
              <button
                className={project.view.projection === 'orthographic' ? 'is-active' : ''}
                onClick={() => useStore.getState().patchView({ projection: project.view.projection === 'perspective' ? 'orthographic' : 'perspective' })}
                title="Perspective / Orthographic"
              >{project.view.projection === 'orthographic' ? 'ORTHO' : 'PERSP'}</button>
              <button
                className={project.view.shading === 'wireframe' ? 'is-active' : ''}
                onClick={() => useStore.getState().patchView({ shading: project.view.shading === 'wireframe' ? 'shaded' : 'wireframe' })}
                title="Shaded / Wireframe"
              >WIRE</button>
              <button
                className={project.view.shading === 'ghost' ? 'is-active' : ''}
                onClick={() => useStore.getState().patchView({ shading: project.view.shading === 'ghost' ? 'shaded' : 'ghost' })}
                title="X-ray ghost view"
              >XRAY</button>
            </div>
            {/* explode slider */}
            <div className="explode-ctl">
              <span className="muted">EXPLODE</span>
              <input
                type="range" min={0} max={1} step={0.01}
                value={project.view.explode}
                onChange={(e) => useStore.getState().patchView({ explode: parseFloat(e.target.value) })}
              />
            </div>
            {/* HUD gauges */}
            <div className="hud-anchor">
              <div className="hud-toggle"><Toggle label="HUD" value={hudVisible} onChange={setHudVisible} /></div>
              {hudVisible && <HudCluster />}
            </div>
            {/* status legend */}
            <div className="viewport-legend">
              <span className="mono">{project.parts.length} PARTS</span>
              <span className="mono">AXIS {project.groups[0]?.axis.toUpperCase() ?? '—'}</span>
              <span className="mono">{project.groups.filter((g) => g.enabled).reduce((n, g) => n + g.partIds.length, 0)} ANIMATED</span>
            </div>
          </div>
          {importStage.active && (
            <div className="import-overlay">
              <div className="import-card">
                <div className="import-ring" />
                <div className="import-label">{importStage.stage}</div>
                <div className="progress"><div className="progress-fill" style={{ width: `${importStage.pct}%` }} /></div>
              </div>
            </div>
          )}
        </div>
        <div className="right-rail"><RightPanel /></div>
      </div>
      <div className="app-bottom"><BottomDock /></div>
      <div className="statusbar">
        <span className="mono">SONIVEX STUDIO 1.0.0</span>
        <span className="muted">Design. Simulate. Validate.</span>
        <span className="statusbar-spacer" />
        <span className="mono">{selection.length ? `${selection.length} selected` : 'no selection'}</span>
        <span className="muted">Space play · S stop · R reset · F fit · 1–6 views · Ctrl+M model · Ctrl+I audio</span>
      </div>
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`}>
            <span className="toast-badge">{t.level.toUpperCase()}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {!booted && (
        <div className="boot-splash">
          <div className="boot-logo">
            <svg viewBox="0 0 64 64" width="72" height="72">
              <circle cx="32" cy="32" r="27" fill="none" stroke="#3A3A3A" strokeWidth="3" />
              <circle cx="32" cy="32" r="19" fill="none" stroke="#8A8A8A" strokeWidth="2.5" opacity="0.8">
                <animate attributeName="r" values="19;22;19" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx="32" cy="32" r="11" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
              <circle cx="32" cy="32" r="4.5" fill="#F0F0F0" />
            </svg>
          </div>
          <div className="boot-title">SONIVEX STUDIO</div>
          <div className="boot-sub">initializing engineering workspace…</div>
        </div>
      )}
    </div>
  );
};
