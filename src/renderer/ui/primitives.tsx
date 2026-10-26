/**
 * UI primitives — buttons, fields, sliders, toggles, sections.
 * All styled via app.css classes (no CSS-in-JS overhead).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export const Btn: React.FC<{
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'default' | 'accent' | 'ghost' | 'danger';
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ onClick, variant = 'default', active, disabled, title, children, style }) => (
  <button
    className={`btn btn-${variant}${active ? ' is-active' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={style}
  >
    {children}
  </button>
);

export const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  hint?: string;
}> = ({ label, value, onChange, min = -1e9, max = 1e9, step = 1, unit, decimals = 1, disabled, hint }) => {
  const [local, setLocal] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(fmt(value, decimals)); }, [value, decimals]);
  const commit = () => {
    const v = parseFloat(local);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    else setLocal(fmt(value, decimals));
  };
  return (
    <label className={`field${disabled ? ' is-disabled' : ''}`} title={hint}>
      <span className="field-label">{label}{unit ? <em> {unit}</em> : null}</span>
      <input
        className="field-input"
        type="number"
        value={local}
        min={min} max={max} step={step}
        disabled={disabled}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onBlur={() => { focused.current = false; commit(); }}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
      />
    </label>
  );
};

const fmt = (v: number, d: number): string => (Number.isFinite(v) ? String(parseFloat(v.toFixed(d))) : '');

export const Slider: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number; max: number; step?: number;
  unit?: string;
  decimals?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}> = ({ label, value, onChange, min, max, step = 0.01, unit, decimals = 2, format, disabled }) => (
  <div className="field">
    <div className="field-label row-between">
      <span>{label}{unit ? <em> {unit}</em> : null}</span>
      <span className="field-value">{format ? format(value) : value.toFixed(decimals)}</span>
    </div>
    <input
      className="slider"
      type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);

export const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}> = ({ label, value, onChange, options, disabled }) => (
  <label className={`field${disabled ? ' is-disabled' : ''}`}>
    <span className="field-label">{label}</span>
    <select className="field-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

export const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}> = ({ label, value, onChange, hint }) => (
  <button
    className={`toggle${value ? ' is-on' : ''}`}
    onClick={() => onChange(!value)}
    title={hint}
    type="button"
  >
    <span className="toggle-track"><span className="toggle-thumb" /></span>
    <span className="toggle-label">{label}</span>
  </button>
);

export const Section: React.FC<{
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, right, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${open ? ' is-open' : ''}`}>
      <div className="section-head" onClick={() => setOpen(!open)}>
        <span className="section-chevron">▸</span>
        <span className="section-title">{title}</span>
        <span className="section-right" onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
};

export const Chip: React.FC<{ color?: 'cyan' | 'blue' | 'amber' | 'red' | 'gray' | 'green'; children: React.ReactNode; title?: string }> = ({ color = 'gray', children, title }) => (
  <span className={`chip chip-${color}`} title={title}>{children}</span>
);

export const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div className="row" style={style}>{children}</div>
);

/** Animated number readout with smooth tweening. */
export const Ticker: React.FC<{ value: string; className?: string }> = ({ value, className }) => {
  const [display, setDisplay] = useState(value);
  const raf = useRef(0);
  const stable = useCallback(() => {}, []);
  useEffect(() => {
    setDisplay(value);
    stable();
  }, [value, stable]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return <span className={`ticker ${className ?? ''}`}>{display}</span>;
};
