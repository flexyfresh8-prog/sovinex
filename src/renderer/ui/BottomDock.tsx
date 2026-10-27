/**
 * Bottom dock: Console / Waveform / Spectrum / Physics curves.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { controller } from '../app/AppController';
import { Btn, Chip } from './primitives';
import { CanvasPlot, RefLine, Series } from './CanvasPlot';
import { PhysicsCurves } from '../../shared/types';

// ================= Console =================
const ConsolePanel: React.FC = () => {
  const lines = useStore((s) => s.consoleLines);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);
  return (
    <div className="console" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={`console-line level-${l.level}`}>
          <span className="console-time">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>
          <span className="console-badge">{l.level.toUpperCase()}</span>
          <span className="console-msg">{l.msg}</span>
        </div>
      ))}
      {lines.length === 0 && <div className="console-line muted">Console ready.</div>}
    </div>
  );
};

// ================= Waveform =================
const WaveformPanel: React.FC = () => {
  const analysis = useStore((s) => s.analysis);
  const position = useStore((s) => s.positionSec);
  const duration = useStore((s) => s.durationSec);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;

      // center line
      ctx.strokeStyle = 'rgba(160,160,160,0.15)';
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

      if (!analysis) {
        ctx.fillStyle = 'rgba(160,160,160,0.4)';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Import audio to see the waveform', w / 2, mid - 10);
        return;
      }

      const { peaksMin, peaksMax, durationSec: dur } = analysis;
      const cols = peaksMin.length;
      // draw as bars per pixel
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(34,211,238,0.85)');
      grad.addColorStop(0.5, 'rgba(59,130,246,0.9)');
      grad.addColorStop(1, 'rgba(34,211,238,0.85)');
      ctx.fillStyle = grad;
      let maxAbs = 1e-6;
      for (let i = 0; i < cols; i++) maxAbs = Math.max(maxAbs, -peaksMin[i], peaksMax[i]);
      for (let px = 0; px < w; px++) {
        const i0 = Math.floor((px / w) * cols);
        const i1 = Math.max(i0 + 1, Math.floor(((px + 1) / w) * cols));
        let mn = 0, mx = 0;
        for (let i = i0; i < Math.min(i1, cols); i++) { mn = Math.min(mn, peaksMin[i]); mx = Math.max(mx, peaksMax[i]); }
        const y0 = mid - (mx / maxAbs) * (h / 2 - 8);
        const y1 = mid - (mn / maxAbs) * (h / 2 - 8);
        ctx.fillRect(px, y0, 1, Math.max(y1 - y0, 1));
      }

      // played region tint
      const posFrac = Math.min(position / Math.max(dur, 0.01), 1);
      ctx.fillStyle = 'rgba(34,211,238,0.08)';
      ctx.fillRect(0, 0, w * posFrac, h);
      // playhead
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#e8e8e8'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(w * posFrac, 4); ctx.lineTo(w * posFrac, h - 4); ctx.stroke();
      ctx.shadowBlur = 0;
    };
    draw();
  }, [analysis, position, duration]);

  const seek = (e: React.MouseEvent): void => {
    if (!analysis) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    controller.seek(frac * analysis.durationSec);
  };

  return (
    <div className="waveform-wrap" ref={wrapRef} onClick={seek}
      onMouseMove={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHoverX(e.clientX - rect.left);
      }}
      onMouseLeave={() => setHoverX(null)}
    >
      <canvas ref={canvasRef} />
      {hoverX !== null && analysis && (
        <div className="waveform-time" style={{ left: Math.min(hoverX + 10, (wrapRef.current?.clientWidth ?? 300) - 60) }}>
          {(hoverX / Math.max(wrapRef.current?.clientWidth ?? 1, 1) * analysis.durationSec).toFixed(1)}s
        </div>
      )}
    </div>
  );
};

// ================= Spectrum (live) =================
const SpectrumPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const transport = useStore((s) => s.transport);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    let running = true;
    const NBARS = 72;
    const values = new Float32Array(NBARS);

    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const analyser = controller.audio.getAnalyser();
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!analyser) {
        ctx.fillStyle = 'rgba(160,160,160,0.4)';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Live spectrum appears during playback', w / 2, h / 2);
        return;
      }
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const sr = controller.audio.liveSampleRate();
      // log-spaced bars 20Hz..16kHz
      for (let b = 0; b < NBARS; b++) {
        const f0 = 20 * Math.pow(800, b / NBARS);
        const f1 = 20 * Math.pow(800, (b + 1) / NBARS);
        const k0 = Math.max(1, Math.floor((f0 / (sr / 2)) * data.length));
        const k1 = Math.max(k0 + 1, Math.floor((f1 / (sr / 2)) * data.length));
        let peak = 0;
        for (let k = k0; k < Math.min(k1, data.length); k++) peak = Math.max(peak, data[k]);
        const target = peak / 255;
        values[b] += (target - values[b]) * (target > values[b] ? 0.5 : 0.12);
      }
      const barW = w / NBARS;
      for (let b = 0; b < NBARS; b++) {
        const v = values[b];
        const bh = Math.max(v * (h - 14), 1.5);
        const hue = 190 - (b / NBARS) * 40;
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, `hsla(${hue}, 90%, 45%, 0.9)`);
        grad.addColorStop(1, `hsla(${hue + 15}, 95%, 65%, 1)`);
        ctx.fillStyle = grad;
        const x = b * barW + 1;
        ctx.fillRect(x, h - bh - 12, Math.max(barW - 2, 1.5), bh);
        // reflections
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x, h - 12, Math.max(barW - 2, 1.5), Math.min(bh * 0.28, 20));
        ctx.globalAlpha = 1;
      }
      // band markers
      ctx.fillStyle = 'rgba(160,160,160,0.7)';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      const marks: [string, number][] = [['SUB', 20], ['BASS', 60], ['UP-BASS', 120], ['MID', 250]];
      for (const [label, f] of marks) {
        const x = (Math.log10(f / 20) / Math.log10(800)) * w;
        ctx.fillRect(x, h - 9, 1, 4);
        ctx.fillText(label, x + 3, h - 2);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [transport]);

  return (
    <div className="spectrum-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
};

// ================= Physics curves =================
const PhysicsPanel: React.FC = () => {
  const curves = useStore((s) => s.physicsCurves);
  const summary = useStore((s) => s.physicsSummary);
  const box = useStore((s) => s.project.box);
  const driver = useStore((s) => s.project.driver);
  const amp = useStore((s) => s.project.amp);
  const [chart, setChart] = useState<'spl' | 'excursion' | 'impedance' | 'port'>('spl');

  if (!curves || !summary) return <div className="empty-hint">Computing…</div>;

  const seriesMap: Record<typeof chart, { series: Series[]; refs: RefLine[]; yLabel: string }> = {
    spl: {
      series: [{ label: 'SPL @1m', color: '#e8e8e8', x: curves.freq, y: curves.splDB, fill: true }],
      refs: [{ y: summary.maxSplXmaxDB, color: '#e8e8e8', label: 'SPL @ Xmax' }],
      yLabel: 'dB SPL',
    },
    excursion: {
      series: [
        { label: 'Peak excursion', color: '#e8e8e8', x: curves.freq, y: curves.excursionMM, fill: true },
      ],
      refs: [{ y: driver.xmaxMM, color: '#ffffff', label: `Xmax ${driver.xmaxMM} mm` }],
      yLabel: 'mm',
    },
    impedance: {
      series: [{ label: '|Z|', color: '#b9b9b9', x: curves.freq, y: curves.impedanceOhm }],
      refs: [{ y: driver.reOhm, color: 'rgba(160,160,160,0.5)', label: `Re ${driver.reOhm} Ω` }],
      yLabel: 'Ω',
    },
    port: {
      series: box.type === 'ported'
        ? [{ label: 'Port air velocity', color: '#9a9a9a', x: curves.freq, y: curves.portVelMS, fill: true }]
        : [],
      refs: box.type === 'ported' ? [{ y: 17, color: '#ffffff', label: 'Chuffing 17 m/s' }] : [],
      yLabel: 'm/s',
    },
  };

  const chips: { id: typeof chart; label: string }[] = [
    { id: 'spl', label: 'SPL' },
    { id: 'excursion', label: 'Excursion' },
    { id: 'impedance', label: 'Impedance' },
    { id: 'port', label: 'Port Velocity' },
  ];

  return (
    <div className="physics-panel">
      <div className="physics-toolbar">
        <div className="tab-strip is-compact">
          {chips.map((c) => (
            <button key={c.id} className={`tab${chart === c.id ? ' is-active' : ''}`} onClick={() => setChart(c.id)}>{c.label}</button>
          ))}
        </div>
        <div className="row">
          <Chip color="cyan">{amp.voltageRMS} V</Chip>
          <Chip color="blue">{(amp.voltageRMS ** 2 / amp.nominalOhm).toFixed(0)} W</Chip>
          <Chip color={box.type === 'ported' ? 'amber' : 'gray'}>{box.type === 'ported' ? `Fb ${summary.qtcOrFbHz.toFixed(1)} Hz` : `Fc ${summary.qtcOrFbHz.toFixed(1)} Hz`}</Chip>
        </div>
      </div>
      <CanvasPlot
        series={seriesMap[chart].series}
        refLines={seriesMap[chart].refs}
        xLabel="Frequency (Hz)"
        yLabel={seriesMap[chart].yLabel}
        logX
        xMin={10}
        xMax={500}
        height={180}
      />
    </div>
  );
};

// ================= container =================
const dockTabs = [
  { id: 'console', label: 'CONSOLE' },
  { id: 'waveform', label: 'WAVEFORM' },
  { id: 'spectrum', label: 'SPECTRUM' },
  { id: 'physics', label: 'PHYSICS' },
] as const;

export const BottomDock: React.FC = () => {
  const tab = useStore((s) => s.bottomTab);
  const setTab = useStore((s) => s.setBottomTab);
  const analyzing = useStore((s) => s.analyzing);
  const pct = useStore((s) => s.analysisPct);
  const lines = useStore((s) => s.consoleLines);
  const clearLog = () => useStore.setState({ consoleLines: [] });

  return (
    <div className="bottom-dock">
      <div className="dock-head">
        <div className="tab-strip is-compact">
          {dockTabs.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="dock-right">
          {analyzing && (
            <div className="progress-wrap">
              <span>ANALYZING</span>
              <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
              <span className="mono">{pct}%</span>
            </div>
          )}
          {tab === 'console' && (
            <>
              <Chip>{lines.length}</Chip>
              <Btn variant="ghost" onClick={clearLog} title="Clear console">Clear</Btn>
            </>
          )}
        </div>
      </div>
      <div className="dock-body">
        {tab === 'console' && <ConsolePanel />}
        {tab === 'waveform' && <WaveformPanel />}
        {tab === 'spectrum' && <SpectrumPanel />}
        {tab === 'physics' && <PhysicsPanel />}
      </div>
    </div>
  );
};
