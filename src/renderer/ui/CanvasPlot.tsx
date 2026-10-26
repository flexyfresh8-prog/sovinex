/**
 * CanvasPlot — lightweight high-DPI scientific line plot.
 * Log/linear X, grid, axis labels, multi-series, reference lines, hover crosshair.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface Series {
  label: string;
  color: string;
  x: Float64Array | number[];
  y: Float64Array | number[];
  width?: number;
  dashed?: boolean;
  fill?: boolean;
}

export interface RefLine {
  y: number;
  color: string;
  label: string;
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  xMin?: number; xMax?: number;
  height?: number;
  refLines?: RefLine[];
  yZeroBaseline?: boolean;
}

export const CanvasPlot: React.FC<Props> = ({
  series, xLabel, yLabel, logX = true, xMin, xMax, height = 220, refLines = [], yZeroBaseline,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ px: number; py: number; x: number; y: number; seriesLabel: string; seriesColor: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 52, padR = 14, padT = 12, padB = 30;
      const iw = w - padL - padR, ih = h - padT - padB;
      if (iw < 10 || ih < 10) return;

      let xmin = xMin ?? Infinity, xmax = xMax ?? -Infinity;
      if (!isFinite(xmin) || !isFinite(xmax)) {
        for (const s of series) {
          if (s.x.length === 0) continue;
          xmin = Math.min(xmin, s.x[0] as number, s.x[s.x.length - 1] as number);
          xmax = Math.max(xmax, s.x[0] as number, s.x[s.x.length - 1] as number);
        }
      }
      if (!isFinite(xmin) || !isFinite(xmax) || xmax <= xmin) { xmin = 10; xmax = 500; }
      let ymin = Infinity, ymax = -Infinity;
      for (const s of series) for (let i = 0; i < s.y.length; i++) {
        const v = s.y[i] as number;
        if (Number.isFinite(v)) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
      }
      for (const r of refLines) { if (r.y < ymin) ymin = r.y; if (r.y > ymax) ymax = r.y; }
      if (yZeroBaseline) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
      if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) { ymin = 0; ymax = 1; }
      if (ymax - ymin < 1e-9) { ymax += 1; ymin -= 1; }
      const padY = (ymax - ymin) * 0.08;
      ymin -= padY; ymax += padY;

      const X = (x: number): number => {
        const t = logX
          ? (Math.log10(Math.max(x, 1e-6)) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin))
          : (x - xmin) / (xmax - xmin);
        return padL + t * iw;
      };
      const Y = (y: number): number => padT + (1 - (y - ymin) / (ymax - ymin)) * ih;

      // grid
      ctx.font = '10px "Segoe UI", sans-serif';
      const gridColor = 'rgba(148,163,184,0.10)';
      const labelColor = 'rgba(148,163,184,0.75)';
      // x ticks
      const xTicks: number[] = [];
      if (logX) {
        for (let e = Math.floor(Math.log10(xmin)); e <= Math.ceil(Math.log10(xmax)); e++) {
          for (const m of [1, 2, 5]) {
            const v = m * Math.pow(10, e);
            if (v >= xmin && v <= xmax) xTicks.push(v);
          }
        }
      } else {
        const step = (xmax - xmin) / 8;
        for (let v = Math.ceil(xmin / step) * step; v <= xmax; v += step) xTicks.push(v);
      }
      ctx.strokeStyle = gridColor; ctx.fillStyle = labelColor; ctx.lineWidth = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const t of xTicks) {
        const px = X(t);
        ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + ih); ctx.stroke();
        ctx.fillText(fmtTick(t), px, padT + ih + 6);
      }
      // y ticks
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const yStep = niceStep((ymax - ymin) / 6);
      for (let v = Math.ceil(ymin / yStep) * yStep; v <= ymax; v += yStep) {
        const py = Y(v);
        ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(padL + iw, py); ctx.stroke();
        ctx.fillText(fmtTick(v), padL - 6, py);
      }
      // axis labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(xLabel, padL + iw / 2, h - 2);
      ctx.save();
      ctx.translate(12, padT + ih / 2); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();

      // frame
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.strokeRect(padL, padT, iw, ih);

      // reference lines
      for (const r of refLines) {
        const py = Y(r.y);
        if (py < padT || py > padT + ih) continue;
        ctx.strokeStyle = r.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(padL + iw, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = r.color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(r.label, padL + 6, py - 2);
      }

      // series
      for (const s of series) {
        if (s.x.length < 2) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width ?? 1.8;
        if (s.dashed) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < s.x.length; i++) {
          const v = s.y[i] as number;
          if (!Number.isFinite(v)) { started = false; continue; }
          const px = X(s.x[i] as number), py = Y(v);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.fill) {
          ctx.globalAlpha = 0.12;
          ctx.lineTo(X(s.x[s.x.length - 1] as number), Y(Math.max(ymin, 0)));
          ctx.lineTo(X(s.x[0] as number), Y(Math.max(ymin, 0)));
          ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      return { X, Y, padL, padT, iw, ih, xmin, xmax, ymin, ymax };
    };

    const geom = draw();
    (canvas as unknown as { _geom?: unknown })._geom = geom;
  }, [series, xLabel, yLabel, logX, xMin, xMax, height, refLines, yZeroBaseline]);

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const geom = (canvas as unknown as { _geom?: { X: (x: number) => number; Y: (y: number) => number; padL: number; padT: number; iw: number; ih: number; xmin: number; xmax: number; ymin: number; ymax: number } })._geom;
    if (!geom) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < geom.padL || px > geom.padL + geom.iw || py < geom.padT || py > geom.padT + geom.ih) { setHover(null); return; }
    // inverse x
    const tx = logX
      ? Math.pow(10, Math.log10(geom.xmin) + ((px - geom.padL) / geom.iw) * (Math.log10(geom.xmax) - Math.log10(geom.xmin)))
      : geom.xmin + ((px - geom.padL) / geom.iw) * (geom.xmax - geom.xmin);
    // find nearest series value at tx
    let best: { label: string; color: string; y: number; dist: number } | null = null;
    for (const s of series) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < s.x.length; i++) {
        const d = Math.abs((s.x[i] as number) - tx);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0 && Number.isFinite(s.y[bi] as number)) {
        const yv = s.y[bi] as number;
        const pyv = geom.Y(yv);
        const dist = Math.abs(pyv - py);
        if (!best || dist < best.dist) best = { label: s.label, color: s.color, y: yv, dist };
      }
    }
    const ty = geom.ymin + (1 - (py - geom.padT) / geom.ih) * (geom.ymax - geom.ymin);
    setHover({ px, py, x: tx, y: best ? best.y : ty, seriesLabel: best?.label ?? '', seriesColor: best?.color ?? '#94a3b8' });
  };

  return (
    <div className="plot-wrap" ref={wrapRef} style={{ height }}>
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="plot-tooltip" style={{ left: Math.min(hover.px + 12, (wrapRef.current?.clientWidth ?? 300) - 130), top: hover.py + 8 }}>
          <div style={{ color: hover.seriesColor }}>{hover.seriesLabel}</div>
          <div>{fmtTick(hover.x)} {xLabel.split(' ')[0]}</div>
          <div className="plot-tooltip-val">{fmtTick(hover.y)}</div>
        </div>
      )}
    </div>
  );
};

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const norm = raw / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}
