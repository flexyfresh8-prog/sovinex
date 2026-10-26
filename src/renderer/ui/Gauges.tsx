/**
 * HUD gauges — live physics readouts, canvas-rendered, driven by hudBus at 12 Hz.
 */
import React, { useEffect, useRef } from 'react';
import { hudBus, HudData } from '../store';

class GaugeRenderer {
  private ctx: CanvasRenderingContext2D;
  private display = 0; // eased value
  private peak = 0;
  private peakDecay = 0;
  constructor(private canvas: HTMLCanvasElement, private kind: 'bar' | 'radial') {
    this.ctx = canvas.getContext('2d')!;
  }
  draw(value: number, max: number, label: string, unit: string, danger = 1.0, decimals = 1): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.display += (value - this.display) * 0.35;
    this.peakDecay += 0.008;
    if (value >= this.peak || this.peakDecay > 1) { this.peak = value; this.peakDecay = 0; }
    const v = Math.max(0, this.display);
    const frac = Math.min(v / Math.max(max, 1e-9), 1.15);

    if (this.kind === 'bar') {
      const barH = 7, y = h - 14;
      const barW = w;
      // track
      ctx.fillStyle = 'rgba(148,163,184,0.12)';
      roundRect(ctx, 0, y, barW, barH, 3.5); ctx.fill();
      // danger zone
      const dzX = barW * Math.min(danger, 1.15);
      if (danger <= 1.15) {
        ctx.fillStyle = 'rgba(239,68,68,0.18)';
        roundRect(ctx, dzX, y, Math.max(barW - dzX, 0), barH, 3.5); ctx.fill();
      }
      // fill gradient
      const over = frac > danger;
      const grad = ctx.createLinearGradient(0, y, barW, y);
      if (over) { grad.addColorStop(0, '#22d3ee'); grad.addColorStop(1, '#ef4444'); }
      else { grad.addColorStop(0, '#0891b2'); grad.addColorStop(1, '#22d3ee'); }
      ctx.fillStyle = grad;
      if (frac > 0.005) { roundRect(ctx, 0, y, Math.min(barW * frac, barW), barH, 3.5); ctx.fill(); }
      // peak tick
      const peakX = Math.min((this.peak / Math.max(max, 1e-9)) * barW, barW);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(peakX - 1, y - 2, 2, barH + 4);
      // label + value
      ctx.font = '600 10px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(148,163,184,0.85)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(label, 0, 0);
      ctx.font = '700 11px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = over ? '#f87171' : '#e2e8f0';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(decimals) + ' ' + unit, w, 0);
    } else {
      // radial
      const cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) / 2 - 10;
      const start = Math.PI * 0.75, end = Math.PI * 2.25;
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(148,163,184,0.14)';
      ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke();
      const dangerA = start + (end - start) * Math.min(danger / 1.15, 1);
      ctx.strokeStyle = 'rgba(239,68,68,0.35)';
      ctx.beginPath(); ctx.arc(cx, cy, r, dangerA, end); ctx.stroke();
      const over = frac > danger;
      ctx.strokeStyle = over ? '#ef4444' : '#22d3ee';
      if (over) { ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 8; }
      else { ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = frac > 0.02 ? 6 : 0; }
      ctx.beginPath(); ctx.arc(cx, cy, r, start, start + (end - start) * frac); ctx.stroke();
      ctx.shadowBlur = 0;
      // center text
      ctx.font = '700 15px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = over ? '#f87171' : '#e2e8f0';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v.toFixed(decimals), cx, cy - 4);
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(148,163,184,0.8)';
      ctx.fillText(unit, cx, cy + 10);
      ctx.font = '600 9px "Segoe UI", sans-serif';
      ctx.fillText(label.toUpperCase(), cx, 6);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const Gauge: React.FC<{
  kind: 'bar' | 'radial';
  label: string; unit: string;
  getMax: (h: HudData) => number;
  getValue: (h: HudData) => number;
  danger?: number;
  decimals?: number;
  className?: string;
}> = ({ kind, label, unit, getMax, getValue, danger = 1.0, decimals = 1, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GaugeRenderer | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    renderer.current = new GaugeRenderer(ref.current, kind);
    const un = hudBus.subscribe((h) => {
      renderer.current?.draw(getValue(h), getMax(h), label, unit, danger, decimals);
    });
    return un;
  }, [kind, label, unit, getMax, getValue, danger, decimals]);
  return <canvas ref={ref} className={`gauge gauge-${kind} ${className ?? ''}`} />;
};

export const HudCluster: React.FC = () => (
  <div className="hud-cluster">
    <Gauge kind="radial" label="Excursion" unit="mm" getValue={(h) => h.excursionMM} getMax={(h) => Math.max(h.xmaxMM * 1.15, 1)} danger={1.0} decimals={1} />
    <div className="hud-bars">
      <Gauge kind="bar" label="Cone velocity" unit="m/s" getValue={(h) => h.velocityMS} getMax={() => 12} danger={1.1} decimals={2} />
      <Gauge kind="bar" label="Cone accel" unit="g" getValue={(h) => h.accelG} getMax={() => 120} danger={1.1} decimals={1} />
      <Gauge kind="bar" label="SPL est @1m" unit="dB" getValue={(h) => h.splDB} getMax={() => 125} danger={1.1} decimals={1} />
      <Gauge kind="bar" label="Port velocity" unit="m/s" getValue={(h) => h.portVelMS} getMax={() => 30} danger={0.57} decimals={1} />
    </div>
  </div>
);

export const ExcursionTickerBar: React.FC = () => (
  <Gauge kind="bar" label="Xmax usage" unit="%" getValue={(h) => h.usagePct} getMax={() => 100} danger={1.0} decimals={0} className="ticker-bar" />
);
