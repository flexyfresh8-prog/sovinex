/**
 * STUDIO tab — the Driver Customization panel.
 *
 * Every visible control drives real 3D geometry through the shared studio
 * config (single source of truth). Sliders give quick adjustment, numeric
 * inputs give precise measurements (metric mm / imperial inch), dropdowns
 * switch material presets, swatches set grayscale finish colors.
 *
 * Selecting a component in the viewport / explorer auto-expands and scrolls
 * to this component's section.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { controller } from '../app/AppController';
import { Btn, Chip, Row, SelectField, Toggle } from './primitives';
import {
  FIELDS, SECTION_META, FieldDef, ComponentGroup,
  defaultStudioConfig, clampConfig, validateConfig, monochrome, MM_PER_IN,
  DriverType, DriverStudioConfig,
} from '../../shared/driver/studioConfig';

const SWATCHES = ['#0a0a0a', '#1f1f1f', '#3a3a3a', '#5c5c5c', '#9a9a9a', '#c9c9c9', '#f2f2f2'];

/** component id → studio section (selection highlight routing) */
const COMPONENT_SECTION: Record<string, ComponentGroup> = {
  cone: 'cone', dustcap: 'dustcap', surround: 'surround', voicecoil: 'voicecoil',
  spider: 'spider', magnet: 'magnet', topPlate: 'motor', bottomPlate: 'motor', pole: 'motor',
  basket: 'basket', gasket: 'hardware', terminals: 'terminal', leads: 'cone', hardware: 'hardware',
};

/** Precision number + quick slider in one row, unit-aware. */
const StudioNumber: React.FC<{
  def: FieldDef; cfg: DriverStudioConfig; units: 'metric' | 'imperial';
  onChange: (patch: Partial<DriverStudioConfig>) => void;
}> = ({ def, cfg, units, onChange }) => {
  const isLen = def.unit === 'mm';
  const scale = isLen && units === 'imperial' ? 1 / MM_PER_IN : 1;
  const value = (cfg[def.key] as number) * scale;
  const unitLabel = isLen ? (units === 'metric' ? 'mm' : 'in') : def.unit === 'count' ? '' : def.unit;
  const decimals = isLen && units === 'imperial' ? 3 : def.decimals ?? 1;
  const step = (def.step ?? 1) * scale;
  const [local, setLocal] = useState<string | null>(null);

  const commit = (v: number) => onChange({ [def.key]: v / scale } as Partial<DriverStudioConfig>);

  return (
    <div className="studio-num">
      <div className="studio-num-head">
        <span className="studio-num-label">{def.label}</span>
        <input
          className="field-input studio-num-input"
          type="number"
          value={local ?? parseFloat(value.toFixed(decimals + 1))}
          min={(def.min ?? 0) * scale} max={(def.max ?? 1e9) * scale} step={step}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { if (local !== null) { const v = parseFloat(local); if (Number.isFinite(v)) commit(v); } setLocal(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <span className="studio-num-unit">{unitLabel}</span>
      </div>
      {def.min !== undefined && def.max !== undefined && (
        <input
          className="slider"
          type="range"
          min={def.min * scale} max={def.max * scale} step={step}
          value={value}
          onChange={(e) => commit(parseFloat(e.target.value))}
        />
      )}
      {def.hint && <div className="studio-hint">{def.hint}</div>}
    </div>
  );
};

export const StudioPanel: React.FC = () => {
  const cfg = useStore((s) => s.project.studio);
  const units = useStore((s) => s.project.units);
  const selection = useStore((s) => s.selection);
  const explodeDistance = useStore((s) => s.project.view.explodeDistance);
  const viewMode = useStore((s) => s.project.view.viewMode);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ general: true });
  const scrollRoot = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => validateConfig(clampConfig(cfg)), [cfg]);
  const cfgSafe = useMemo(() => clampConfig(cfg), [cfg]);

  // selecting a component reveals its customization section
  useEffect(() => {
    if (selection.length !== 1) return;
    const sec = COMPONENT_SECTION[selection[0]];
    if (!sec) return;
    setOpenSections((s) => ({ ...s, [sec]: true }));
    // scroll after the section expands
    window.setTimeout(() => {
      scrollRoot.current?.querySelector(`[data-section="${sec}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }, [selection]);

  const patch = (p: Partial<DriverStudioConfig>): void => {
    if ('linkSurroundToCone' in p && p.linkSurroundToCone) {
      p = { ...p, surroundInnerDiameterMM: cfgSafe.coneOuterDiameterMM };
    }
    controller.applyStudioConfig(p);
  };

  const applyClass = (type: DriverType): void => {
    controller.applyStudioPreset(defaultStudioConfig(type));
    useStore.getState().log('ok', `Driver class preset applied: ${type}.`);
  };

  // group fields by section once
  const bySection = useMemo(() => {
    const map = new Map<ComponentGroup, FieldDef[]>();
    for (const f of FIELDS) {
      if (!map.has(f.section)) map.set(f.section, []);
      map.get(f.section)!.push(f);
    }
    return map;
  }, []);

  const renderField = (f: FieldDef): React.ReactNode => {
    if (f.kind === 'number') {
      return <StudioNumber key={String(f.key)} def={f} cfg={cfgSafe} units={units} onChange={patch} />;
    }
    if (f.kind === 'select') {
      return (
        <SelectField
          key={String(f.key)}
          label={f.label}
          value={String(cfgSafe[f.key])}
          options={f.options ?? []}
          onChange={(v) => patch({ [f.key]: v } as Partial<DriverStudioConfig>)}
        />
      );
    }
    if (f.kind === 'toggle') {
      return (
        <Toggle
          key={String(f.key)}
          label={f.label}
          value={Boolean(cfgSafe[f.key])}
          onChange={(v) => patch({ [f.key]: v } as Partial<DriverStudioConfig>)}
        />
      );
    }
    if (f.kind === 'color') {
      const val = monochrome(String(cfgSafe[f.key]));
      return (
        <div key={String(f.key)} className="field">
          <span className="field-label">{f.label}</span>
          <div className="studio-swatches">
            {SWATCHES.map((s) => (
              <button
                key={s}
                className={`studio-swatch${val === s ? ' is-active' : ''}`}
                style={{ background: s }}
                onClick={() => patch({ [f.key]: s } as Partial<DriverStudioConfig>)}
                title={s}
              />
            ))}
            <input
              type="color"
              className="studio-colorpicker"
              value={val}
              onChange={(e) => patch({ [f.key]: monochrome(e.target.value) } as Partial<DriverStudioConfig>)}
              title="Custom grayscale"
            />
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="panel-scroll studio-panel" ref={scrollRoot}>
      <section className="studio-section" data-section="assembly">
        <div className="studio-section-head" onClick={() => setOpenSections((s) => ({ ...s, assembly: !s.assembly }))}>
          <span className="section-chevron">{openSections.assembly !== false ? '▾' : '▸'}</span>
          <span className="section-title">Driver Class & Assembly</span>
        </div>
        {(openSections.assembly !== false) && (
          <div className="studio-section-body">
            <Row>
              {(['subwoofer', 'woofer', 'midrange', 'tweeter'] as DriverType[]).map((t) => (
                <Btn key={t} variant="ghost" active={cfgSafe.driverType === t} onClick={() => applyClass(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </Btn>
              ))}
            </Row>
            <Row>
              <Btn variant="accent" onClick={() => controller.assembleDriver()}>Assemble Driver</Btn>
              <Btn variant="ghost" active={viewMode === 'exploded'} onClick={() => controller.applyViewMode('exploded')}>Explode</Btn>
              <Btn variant="ghost" onClick={() => useStore.getState().patchProject({ units: units === 'metric' ? 'imperial' : 'metric' })}>
                {units === 'metric' ? 'mm' : 'inch'}
              </Btn>
              <Btn variant="ghost" onClick={() => applyClass(cfgSafe.driverType)} title="Reset every dimension to the class default">Reset</Btn>
            </Row>
            <div className="studio-num">
              <div className="studio-num-head">
                <span className="studio-num-label">Exploded separation</span>
                <span className="studio-num-unit mono">{explodeDistance} mm</span>
              </div>
              <input
                className="slider" type="range" min={40} max={300} step={5}
                value={explodeDistance}
                onChange={(e) => {
                  useStore.getState().patchView({ explodeDistance: parseInt(e.target.value, 10) });
                  controller.refreshExplodeOffsets();
                }}
              />
            </div>
          </div>
        )}
      </section>

      {issues.length > 0 && (
        <div className="studio-warnings">
          {issues.map((w, i) => (
            <div key={i} className={`studio-warning studio-warning-${w.level}`}>
              <span>{w.level === 'error' ? '×' : '!'}</span>
              <span>{w.msg}</span>
            </div>
          ))}
        </div>
      )}

      {SECTION_META.map((meta) => {
        const fields = bySection.get(meta.id) ?? [];
        const open = !!openSections[meta.id];
        return (
          <section key={meta.id} className="studio-section" data-section={meta.id}>
            <div className="studio-section-head" onClick={() => setOpenSections((s) => ({ ...s, [meta.id]: !s[meta.id] }))}>
              <span className="section-chevron">{open ? '▾' : '▸'}</span>
              <span className="section-title">{meta.label}</span>
            </div>
            {open && (
              <div className="studio-section-body">
                <div className="studio-section-hint">{meta.hint} · {meta.assembly}</div>
                {fields.map((f) => renderField(f))}
              </div>
            )}
          </section>
        );
      })}

      <div className="hint-block">
        Geometry is fully procedural and dependency-aware: changing one dimension
        rebuilds exactly the parts it affects, and every component stays seated on
        its neighbors. Select any part to jump to its controls.
      </div>
      <Row>
        <Chip color="gray">{cfgSafe.driverType}</Chip>
        <Chip color="gray">frame Ø {Math.round(cfgSafe.nominalDiameterMM)} mm</Chip>
        <Chip color="gray">{units === 'metric' ? 'mm' : 'inch'}</Chip>
      </Row>
    </div>
  );
};
