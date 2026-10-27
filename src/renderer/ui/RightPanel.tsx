/**
 * Right panel: Parts / Driver / Box / Motion / Results tabs.
 * This is where the user customizes the subwoofer (sizes, materials, T-S params,
 * enclosure, porting) and configures audio-driven motion.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { controller } from '../app/AppController';
import { Btn, Chip, NumberField, Row, Section, SelectField, Slider, Toggle } from './primitives';
import { CanvasPlot, RefLine, Series } from './CanvasPlot';
import { MotionMode } from '../../shared/types';
import { StudioPanel } from './StudioPanel';

// ================= Parts tab =================
const PartsPanel: React.FC = () => {
  const parts = useStore((s) => s.project.parts);
  const selection = useStore((s) => s.selection);
  const groups = useStore((s) => s.project.groups);
  const updatePart = useStore((s) => s.updatePart);
  const sel = parts.filter((p) => selection.includes(p.id));
  const part = sel.length === 1 ? sel[0] : null;

  if (sel.length === 0) {
    return (
      <div className="empty-hint">
        <div className="empty-icon">◎</div>
        Select a part in the viewport or Assembly Explorer to inspect and edit it.
      </div>
    );
  }

  if (sel.length > 1) {
    const totalTris = sel.reduce((n, p) => n + p.metrics.triangleCount, 0);
    return (
      <div className="panel-scroll">
        <Section title={`Multi-Selection (${sel.length} parts)`}>
          <div className="stat-grid">
            <div className="stat"><span>Parts</span><b>{sel.length}</b></div>
            <div className="stat"><span>Triangles</span><b>{totalTris.toLocaleString()}</b></div>
          </div>
          <Row>
            <Btn variant="ghost" onClick={() => sel.forEach((p) => updatePart(p.id, { visible: false }))}>Hide</Btn>
            <Btn variant="ghost" onClick={() => sel.forEach((p) => updatePart(p.id, { visible: true }))}>Show</Btn>
            <Btn variant="ghost" onClick={() => sel.forEach((p) => updatePart(p.id, { locked: true }))}>Lock</Btn>
          </Row>
          <div className="hint-block">
            Assign roles from the Assembly Explorer footer to animate these parts as a group.
          </div>
        </Section>
      </div>
    );
  }

  const p = part!;
  const m = p.metrics;
  const grp = groups.find((g) => g.id === p.groupId);
  return (
    <div className="panel-scroll">
      <Section title="Identity">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="field-input" value={p.name} onChange={(e) => updatePart(p.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Source mesh</span>
          <input className="field-input is-mono" value={p.sourceName} readOnly />
        </label>
        <Row>
          <Chip color="blue">#{p.meshIndex + 1}</Chip>
          <Chip>{p.id}</Chip>
          {grp && <Chip color="cyan">{grp.name}</Chip>}
        </Row>
      </Section>
      <Section title="Role & Motion">
        <SelectField
          label="Classification" value={p.role}
          onChange={(v) => {
            updatePart(p.id, { role: v as typeof p.role, enabledForMotion: v === 'moving' });
            controller.rebuildMotion();
          }}
          options={[
            { value: 'static', label: 'Static (never animated)' },
            { value: 'moving', label: 'Moving (rigid with audio)' },
            { value: 'deformable', label: 'Deformable (flex approximation)' },
            { value: 'unknown', label: 'Unknown' },
          ]}
        />
        <Toggle
          label="Member of motion group" value={!!grp}
          onChange={(v) => {
            if (v && groups.length) {
              useStore.getState().updateGroup(groups[0].id, { partIds: [...new Set([...groups[0].partIds, p.id])] });
              updatePart(p.id, { groupId: groups[0].id, enabledForMotion: true });
            } else if (groups.length) {
              useStore.getState().updateGroup(groups[0].id, { partIds: groups[0].partIds.filter((id) => id !== p.id) });
              updatePart(p.id, { groupId: null, enabledForMotion: false });
            }
            controller.rebuildMotion();
          }}
          hint="Only group members are animated by audio"
        />
        <Toggle label="Visible" value={p.visible} onChange={(v) => { updatePart(p.id, { visible: v }); controller.setPartVisible(p.id, v); }} />
        <Toggle label="Locked" value={p.locked} onChange={(v) => updatePart(p.id, { locked: v })} />
      </Section>
      <Section title="Geometry Inspection">
        <div className="stat-grid">
          <div className="stat"><span>Vertices</span><b>{m.vertexCount.toLocaleString()}</b></div>
          <div className="stat"><span>Triangles</span><b>{m.triangleCount.toLocaleString()}</b></div>
        </div>
        <div className="stat-grid">
          <div className="stat"><span>Size W×H×D</span><b>{(m.sizeM[0] * 100).toFixed(1)}×{(m.sizeM[1] * 100).toFixed(1)}×{(m.sizeM[2] * 100).toFixed(1)} cm</b></div>
        </div>
        <div className="stat-grid">
          <div className="stat"><span>Symmetry axis</span><b className="mono">{m.symmetryAxis.toUpperCase()} (CV {m.symmetryCV.toFixed(3)})</b></div>
        </div>
        <div className="stat-grid">
          <div className="stat"><span>Center</span><b className="mono">[{m.centerM.map((c) => c.toFixed(2)).join(', ')}] m</b></div>
        </div>
        <div className="hint-block">
          {m.symmetryCV < 0.12
            ? 'Axisymmetric part — good candidate for cone / cap / surround roles.'
            : m.symmetryCV > 0.3
              ? 'Low symmetry — likely composite or box-like geometry (static candidate).'
              : 'Moderate symmetry.'}
          {' '}Motion axis hint: {m.symmetryAxis.toUpperCase()}.
        </div>
      </Section>
    </div>
  );
};

// ================= Driver tab =================
const DriverPanel: React.FC = () => {
  const driver = useStore((s) => s.project.driver);
  const amp = useStore((s) => s.project.amp);
  const modelFormat = useStore((s) => s.modelFormat);
  const patch = useStore((s) => s.patchDriver);
  const patchAmp = useStore((s) => s.patchAmp);
  const [geomTimer, setGeomTimer] = useState<number | undefined>(undefined);

  // live geometry rebuild for the procedural reference assembly
  const scheduleRebuild = (): void => {
    window.clearTimeout(geomTimer);
    const t = window.setTimeout(() => {
      if (useStore.getState().modelFormat === 'procedural') {
        void controller.loadDefaultAssembly();
      }
    }, 350);
    setGeomTimer(t);
  };

  const qts = (driver.qes * driver.qms) / (driver.qes + driver.qms);
  const powerW = (amp.voltageRMS ** 2) / amp.nominalOhm;

  return (
    <div className="panel-scroll">
      <Section title="Presets">
        <Row>
          {[8, 10, 12, 15, 18].map((inch) => (
            <Btn
              key={inch} variant="ghost" active={Math.abs(driver.nominalSizeIn - inch) < 0.01}
              onClick={() => {
                const eff = { 8: 16.5, 10: 21.5, 12: 26.5, 15: 33, 18: 39.5 }[inch] ?? driver.effectiveDiameterCM;
                patch({ nominalSizeIn: inch, effectiveDiameterCM: eff });
                scheduleRebuild();
              }}
            >{inch}"</Btn>
          ))}
        </Row>
      </Section>
      <Section title="Thiele/Small Parameters">
        <NumberField label="Effective piston diameter (Sd basis)" unit="cm" value={driver.effectiveDiameterCM} min={3} max={80} step={0.1} decimals={1}
          onChange={(v) => { patch({ effectiveDiameterCM: v }); scheduleRebuild(); }} />
        <NumberField label="Resonance Fs" unit="Hz" value={driver.fsHz} min={8} max={150} step={0.5} decimals={1} onChange={(v) => patch({ fsHz: v })} />
        <NumberField label="Qes (electrical)" value={driver.qes} min={0.15} max={2} step={0.01} decimals={3} onChange={(v) => patch({ qes: v })} />
        <NumberField label="Qms (mechanical)" value={driver.qms} min={0.8} max={25} step={0.1} decimals={2} onChange={(v) => patch({ qms: v })} />
        <NumberField label="Vas (equivalent volume)" unit="L" value={driver.vasL} min={1} max={1500} step={1} decimals={0} onChange={(v) => patch({ vasL: v })} />
        <NumberField label="Re (DC resistance)" unit="Ω" value={driver.reOhm} min={0.8} max={32} step={0.1} decimals={2} onChange={(v) => patch({ reOhm: v })} />
        <NumberField label="Le (voice coil inductance)" unit="mH" value={driver.leMH} min={0.05} max={12} step={0.05} decimals={2} onChange={(v) => patch({ leMH: v })} />
        <NumberField label="Xmax (linear one-way)" unit="mm" value={driver.xmaxMM} min={0.5} max={60} step={0.5} decimals={1} onChange={(v) => patch({ xmaxMM: v })} />
        <NumberField label="Rated power Pe" unit="W" value={driver.peW} min={10} max={5000} step={10} decimals={0} onChange={(v) => patch({ peW: v })} />
        <div className="hint-block mono">
          Derived: Mms = {useMemo(() => {
            const rhoC2 = 1.204 * 343 * 343;
            const sd = Math.PI * Math.pow(driver.effectiveDiameterCM / 200, 2);
            const cms = (driver.vasL / 1000) / (sd * sd * rhoC2);
            const mms = 1 / (Math.pow(2 * Math.PI * driver.fsHz, 2) * cms);
            return (mms * 1000).toFixed(1);
          }, [driver])} g · Bl = {useMemo(() => {
            const rhoC2 = 1.204 * 343 * 343;
            const sd = Math.PI * Math.pow(driver.effectiveDiameterCM / 200, 2);
            const cms = (driver.vasL / 1000) / (sd * sd * rhoC2);
            const mms = 1 / (Math.pow(2 * Math.PI * driver.fsHz, 2) * cms);
            return Math.sqrt(2 * Math.PI * driver.fsHz * mms * driver.reOhm / driver.qes).toFixed(2);
          }, [driver])} T·m · Qts = {qts.toFixed(3)}
        </div>
      </Section>
      <Section title="Geometry & Materials" right={modelFormat !== 'procedural' ? <Chip color="amber">imported model</Chip> : undefined}>
        <NumberField label="Cone depth" unit="mm" value={driver.coneDepthMM} min={10} max={160} step={1} decimals={0}
          onChange={(v) => { patch({ coneDepthMM: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <NumberField label="Surround width" unit="mm" value={driver.surroundWidthMM} min={4} max={45} step={1} decimals={0}
          onChange={(v) => { patch({ surroundWidthMM: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <Slider label="Dust cap radius" value={driver.dustCapRatio} min={0.12} max={0.7} step={0.01} decimals={2}
          onChange={(v) => { patch({ dustCapRatio: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <NumberField label="Dust cap height" unit="mm" value={driver.dustCapHeight} min={4} max={60} step={1} decimals={0}
          onChange={(v) => { patch({ dustCapHeight: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <NumberField label="Magnet diameter" unit="cm" value={driver.magnetDiameterCM} min={4} max={40} step={0.2} decimals={1}
          onChange={(v) => { patch({ magnetDiameterCM: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <NumberField label="Magnet height" unit="cm" value={driver.magnetHeightCM} min={1} max={12} step={0.1} decimals={1}
          onChange={(v) => { patch({ magnetHeightCM: v }); scheduleRebuild(); }} disabled={modelFormat !== 'procedural'} />
        <SelectField label="Cone material" value={driver.coneMaterial}
          onChange={(v) => { patch({ coneMaterial: v as typeof driver.coneMaterial }); scheduleRebuild(); }}
          options={[
            { value: 'paper', label: 'Paper pulp' },
            { value: 'composite', label: 'Composite weave' },
            { value: 'aluminum', label: 'Aluminum' },
            { value: 'kevlar', label: 'Kevlar' },
          ]} />
      </Section>
      <Section title="Amplifier">
        <NumberField label="Drive voltage (RMS)" unit="V" value={amp.voltageRMS} min={0.5} max={120} step={0.5} decimals={1} onChange={(v) => patchAmp({ voltageRMS: v })} />
        <SelectField label="Load impedance" value={String(amp.nominalOhm)}
          onChange={(v) => patchAmp({ nominalOhm: parseFloat(v) })}
          options={[{ value: '2', label: '2 Ω' }, { value: '4', label: '4 Ω' }, { value: '8', label: '8 Ω' }]} />
        <div className="hint-block">
          Output power: <b className="mono">{powerW.toFixed(0)} W</b> into {amp.nominalOhm} Ω — used for excursion & SPL calculations and the physics-mode track calibration.
        </div>
      </Section>
    </div>
  );
};

// ================= Box tab =================
const BoxPanel: React.FC = () => {
  const box = useStore((s) => s.project.box);
  const summary = useStore((s) => s.physicsSummary);
  const patch = useStore((s) => s.patchBox);
  const [geomTimer, setGeomTimer] = useState<number | undefined>(undefined);
  const scheduleRebuild = (): void => {
    window.clearTimeout(geomTimer);
    const t = window.setTimeout(() => {
      if (useStore.getState().modelFormat === 'procedural') void controller.loadDefaultAssembly();
    }, 350);
    setGeomTimer(t);
  };
  return (
    <div className="panel-scroll">
      <Section title="Enclosure Type">
        <Row>
          <Btn variant={box.type === 'sealed' ? 'accent' : 'ghost'} onClick={() => patch({ type: 'sealed' })}>Sealed</Btn>
          <Btn variant={box.type === 'ported' ? 'accent' : 'ghost'} onClick={() => patch({ type: 'ported' })}>Ported</Btn>
        </Row>
      </Section>
      <Section title="Dimensions">
        <NumberField label="Width" unit="cm" value={box.wCM} min={12} max={250} step={0.5} decimals={1} onChange={(v) => { patch({ wCM: v }); scheduleRebuild(); }} />
        <NumberField label="Height" unit="cm" value={box.hCM} min={12} max={250} step={0.5} decimals={1} onChange={(v) => { patch({ hCM: v }); scheduleRebuild(); }} />
        <NumberField label="Depth" unit="cm" value={box.dCM} min={12} max={250} step={0.5} decimals={1} onChange={(v) => { patch({ dCM: v }); scheduleRebuild(); }} />
        <NumberField label="Wall thickness" unit="cm" value={box.wallCM} min={0.9} max={6} step={0.1} decimals={1} onChange={(v) => patch({ wallCM: v })} />
        <Slider label="Damping fill" value={box.fillAmount} min={0} max={1} step={0.05} decimals={2} onChange={(v) => patch({ fillAmount: v })} />
        <div className="hint-block">
          Net internal volume: <b className="mono">{summary ? summary.volumeNetL.toFixed(1) : '—'} L</b> (minus driver & port displacement)
        </div>
      </Section>
      {box.type === 'ported' && (
        <Section title="Port">
          <NumberField label="Port diameter" unit="cm" value={box.portDiameterCM} min={2} max={30} step={0.1} decimals={1} onChange={(v) => patch({ portDiameterCM: v })} />
          <NumberField label="Port length" unit="cm" value={box.portLengthCM} min={2} max={120} step={0.5} decimals={1} onChange={(v) => patch({ portLengthCM: v })} />
          <NumberField label="Port count" value={box.portCount} min={1} max={6} step={1} decimals={0} onChange={(v) => patch({ portCount: Math.round(v) })} />
          <div className="hint-block mono">
            Fb = 0.0231 · √(Sp / (Vb · Leff)) → tuning shown in Results. Keep port velocity under 17 m/s to avoid chuffing.
          </div>
        </Section>
      )}
      {box.type === 'sealed' && (
        <Section title="Sealed Notes">
          <div className="hint-block">
            Qtc and Fc appear in Results. Qtc ≈ 0.707 = maximally flat; higher = punchy but boomy; lower = gentle rolloff.
          </div>
        </Section>
      )}
    </div>
  );
};

// ================= Motion tab =================
const modeDescriptions: Record<MotionMode, string> = {
  A: 'Waveform — signed low-band reconstruction, oscillates in & out. Audio visualization.',
  B: 'Bass envelope — level-driven push out only. Audio visualization.',
  C: 'Band level — selected band RMS push. Audio visualization.',
  D: 'Physics — excursion through the driver+box transfer model (realistic).',
};

const MotionPanel: React.FC = () => {
  const groups = useStore((s) => s.project.groups);
  const driver = useStore((s) => s.project.driver);
  const updateGroup = useStore((s) => s.updateGroup);
  const setGroups = useStore((s) => s.setGroups);

  if (groups.length === 0) {
    return (
      <div className="panel-scroll">
        <div className="empty-hint">No motion groups. Assign Moving roles in the Assembly Explorer, then a group will appear here.</div>
      </div>
    );
  }

  return (
    <div className="panel-scroll">
      {groups.map((g) => (
        <Section
          key={g.id}
          title={g.name}
          right={<Toggle label="" value={g.enabled} onChange={(v) => { updateGroup(g.id, { enabled: v }); controller.rebuildMotion(); }} />}
        >
          <div className="stat-grid">
            <div className="stat"><span>Parts</span><b>{g.partIds.length}</b></div>
            <div className="stat"><span>Xmax limit</span><b>{g.maxDisplacementMM > 0 ? g.maxDisplacementMM : driver.xmaxMM} mm</b></div>
          </div>

          <div className="mode-cards">
            {(['A', 'B', 'C', 'D'] as MotionMode[]).map((m) => (
              <button
                key={m}
                className={`mode-card${g.mode === m ? ' is-active' : ''}`}
                onClick={() => updateGroup(g.id, { mode: m })}
                title={modeDescriptions[m]}
              >
                <span className="mode-letter">{m}</span>
                <span className="mode-name">{m === 'A' ? 'Waveform' : m === 'B' ? 'Envelope' : m === 'C' ? 'Band' : 'Physics'}</span>
              </button>
            ))}
          </div>
          <div className="hint-block">{modeDescriptions[g.mode]}</div>

          <Row>
            {(['x', 'y', 'z'] as const).map((ax) => (
              <Btn key={ax} variant="ghost" active={g.axis === ax} onClick={() => { updateGroup(g.id, { axis: ax }); controller.motion.setAxis(g.id, ax); }}>
                Axis {ax.toUpperCase()}
              </Btn>
            ))}
          </Row>

          <div className="triple">
            <NumberField label="Pivot X" unit="m" value={g.pivot[0]} min={-5} max={5} step={0.01} decimals={3} onChange={(v) => updateGroup(g.id, { pivot: [v, g.pivot[1], g.pivot[2]] })} />
            <NumberField label="Pivot Y" unit="m" value={g.pivot[1]} min={-5} max={5} step={0.01} decimals={3} onChange={(v) => updateGroup(g.id, { pivot: [g.pivot[0], v, g.pivot[2]] })} />
            <NumberField label="Pivot Z" unit="m" value={g.pivot[2]} min={-5} max={5} step={0.01} decimals={3} onChange={(v) => updateGroup(g.id, { pivot: [g.pivot[0], g.pivot[1], v] })} />
          </div>

          <Slider label="Gain" value={g.gain} min={0} max={3} step={0.05} decimals={2} onChange={(v) => updateGroup(g.id, { gain: v })} />
          <Slider label="Smoothing" unit="ms" value={g.smoothingMs} min={10} max={400} step={5} decimals={0} onChange={(v) => updateGroup(g.id, { smoothingMs: v })} />
          <NumberField label="Max displacement (0 = use Xmax)" unit="mm" value={g.maxDisplacementMM} min={0} max={80} step={0.5} decimals={1} onChange={(v) => updateGroup(g.id, { maxDisplacementMM: v })} />
          {g.mode === 'C' && (
            <div className="triple">
              <NumberField label="Band low" unit="Hz" value={g.bandLowHz} min={15} max={250} step={1} decimals={0} onChange={(v) => updateGroup(g.id, { bandLowHz: v })} />
              <NumberField label="Band high" unit="Hz" value={g.bandHighHz} min={20} max={400} step={1} decimals={0} onChange={(v) => updateGroup(g.id, { bandHighHz: v })} />
            </div>
          )}
          <Toggle label="Invert direction" value={g.invert} onChange={(v) => updateGroup(g.id, { invert: v })} />
        </Section>
      ))}
      <Row>
        <Btn variant="danger" onClick={() => controller.resetMotion()}>Reset To Rest Pose</Btn>
        <Btn variant="ghost" onClick={() => { setGroups([]); controller.rebuildMotion(); }}>Clear Groups</Btn>
      </Row>
      <div className="hint-block">
        Only parts inside <b>enabled</b> groups move. Everything else stays exactly at rest — enclosures, magnets and baskets never animate.
      </div>
    </div>
  );
};

// ================= Results tab =================
const ResultsPanel: React.FC = () => {
  const summary = useStore((s) => s.physicsSummary);
  const curves = useStore((s) => s.physicsCurves);
  const driver = useStore((s) => s.project.driver);
  const box = useStore((s) => s.project.box);
  const amp = useStore((s) => s.project.amp);
  const peak = useStore((s) => s.peakExcursionMM);
  const over = useStore((s) => s.overXmaxPct);
  const audioName = useStore((s) => s.audioName);

  if (!summary || !curves) return <div className="empty-hint">Computing physics…</div>;

  return (
    <div className="panel-scroll">
      <Section title="Alignment Summary">
        <div className="stat-grid">
          <div className="stat"><span>{box.type === 'ported' ? 'Tuning Fb' : 'Fc'}</span><b>{summary.qtcOrFbHz.toFixed(1)} Hz</b></div>
          <div className="stat"><span>-3 dB F3</span><b>{summary.f3Hz.toFixed(1)} Hz</b></div>
          <div className="stat"><span>Qtc</span><b>{summary.qtc.toFixed(2)}</b></div>
          <div className="stat"><span>Net Vb</span><b>{summary.volumeNetL.toFixed(1)} L</b></div>
        </div>
      </Section>
      <Section title={`Drive @ ${amp.voltageRMS} V (${(amp.voltageRMS ** 2 / amp.nominalOhm).toFixed(0)} W)`}>
        <div className="stat-grid">
          <div className="stat"><span>Peak SPL</span><b className={summary.splAtPeDB > summary.maxSplXmaxDB + 3 ? 'warn-text' : ''}>{summary.splAtPeDB.toFixed(1)} dB</b></div>
          <div className="stat"><span>SPL @ Xmax</span><b>{summary.maxSplXmaxDB.toFixed(1)} dB</b></div>
          <div className="stat"><span>Excursion peak</span><b className={summary.excursionAtPeMM > driver.xmaxMM ? 'warn-text' : ''}>{summary.excursionAtPeMM.toFixed(1)} mm</b></div>
          <div className="stat"><span>Port velocity</span><b className={summary.portVelocityAtPeMS > 17 ? 'warn-text' : ''}>{box.type === 'ported' ? summary.portVelocityAtPeMS.toFixed(1) + ' m/s' : '—'}</b></div>
        </div>
      </Section>
      <Section title="Track Physics">
        <div className="stat-grid">
          <div className="stat"><span>Track peak excursion</span><b className={peak > driver.xmaxMM ? 'warn-text' : ''}>{audioName ? peak.toFixed(1) + ' mm' : '—'}</b></div>
          <div className="stat"><span>Time over Xmax</span><b className={over > 2 ? 'warn-text' : ''}>{audioName ? over.toFixed(1) + ' %' : '—'}</b></div>
        </div>
        <div className="hint-block">
          Physics-mode analysis maps the track's bass spectrum through your driver + box transfer function at the set drive voltage.
        </div>
      </Section>
      {summary.warnings.length > 0 && (
        <Section title={`Warnings (${summary.warnings.length})`}>
          <ul className="warn-list">
            {summary.warnings.map((w, i) => <li key={i} className="warn-text">{w}</li>)}
          </ul>
        </Section>
      )}
      <Section title="Export">
        <Row>
          <Btn variant="accent" onClick={() => controller.exportCurvesCSV()}>Curves CSV</Btn>
          <Btn variant="accent" onClick={() => void controller.exportReportPDF()}>Report PDF</Btn>
        </Row>
      </Section>
    </div>
  );
};

// ================= container =================
const tabs = [
  { id: 'parts', label: 'PARTS' },
  { id: 'studio', label: 'STUDIO' },
  { id: 'driver', label: 'DRIVER' },
  { id: 'box', label: 'BOX' },
  { id: 'motion', label: 'MOTION' },
  { id: 'results', label: 'RESULTS' },
] as const;

export const RightPanel: React.FC = () => {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setRightTab);
  return (
    <div className="right-panel">
      <div className="tab-strip">
        {tabs.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="right-panel-body">
        {tab === 'parts' && <PartsPanel />}
        {tab === 'studio' && <StudioPanel />}
        {tab === 'driver' && <DriverPanel />}
        {tab === 'box' && <BoxPanel />}
        {tab === 'motion' && <MotionPanel />}
        {tab === 'results' && <ResultsPanel />}
      </div>
    </div>
  );
};

export type { Series, RefLine };
