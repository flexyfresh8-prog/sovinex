/**
 * Sonivex Studio - shared type definitions
 * Used by main process, renderer and unit tests.
 */
import { DriverStudioConfig } from './driver/studioConfig';

export type { DriverStudioConfig };

/** Studio view mode — Complete System / Driver Only / Exploded / Component Focus */
export type ViewMode = 'system' | 'driver' | 'exploded' | 'focus';

/** Viewport lighting presets */
export type LightingPreset = 'studio' | 'inspection' | 'presentation';

/** Component role classification */
export type PartRole = 'static' | 'moving' | 'deformable' | 'unknown';

/** Animation source mode
 *  A: Waveform drive  (signed low-frequency waveform, generic bass shaping)
 *  B: Bass envelope   (audio visualization, asymmetric push)
 *  C: Band-selectable (user-selected frequency band RMS)
 *  D: Physics-informed(excursion computed through the driver+box transfer model)
 */
export type MotionMode = 'A' | 'B' | 'C' | 'D';

export interface PartInfo {
  id: string;              // stable internal id, e.g. "p0"
  name: string;            // display name (editable)
  sourceName: string;      // original mesh/node name from file
  meshIndex: number;       // index in source scene traversal order
  role: PartRole;
  visible: boolean;
  locked: boolean;
  enabledForMotion: boolean; // only parts in an enabled motion group actually move
  groupId: string | null;    // motion group membership
  metrics: PartMetrics;
}

export interface PartMetrics {
  vertexCount: number;
  triangleCount: number;
  sizeM: [number, number, number];   // local bbox size
  centerM: [number, number, number]; // world bbox center
  radiusMaxM: number;
  symmetryAxis: 'x' | 'y' | 'z';
  symmetryCV: number;   // coefficient of variation of radius (0 = perfect cylinder)
  rMinOverRMax: number; // ring-ness hint (1 = thin ring, ~0 = solid reaching axis)
}

export interface MotionGroupConfig {
  id: string;
  name: string;
  partIds: string[];
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  /** pivot in world space (meters, scene units) */
  pivot: [number, number, number];
  /** hard clamp in mm (0 = use xmax from driver params) */
  maxDisplacementMM: number;
  /** visualization gain multiplier */
  gain: number;
  /** temporal smoothing in ms */
  smoothingMs: number;
  mode: MotionMode;
  /** band range for mode C (Hz) */
  bandLowHz: number;
  bandHighHz: number;
  invert: boolean;
}

export interface DriverParams {
  /** nominal effective cone diameter in inches (drives Sd when linked) */
  nominalSizeIn: number;
  /** effective piston diameter, cm (includes 1/3 surround) */
  effectiveDiameterCM: number;
  fsHz: number;
  qes: number;
  qms: number;
  vasL: number;
  reOhm: number;
  leMH: number;
  xmaxMM: number;
  peW: number;
  /** rated sensitivity 1W/1m (informational) */
  sensitivityDB: number;
  // geometry (visual customization)
  coneDepthMM: number;
  surroundWidthMM: number;
  dustCapRatio: number;   // fraction of cone radius
  dustCapHeight: number;  // mm
  magnetDiameterCM: number;
  magnetHeightCM: number;
  vcDiameterCM: number;
  coneColor: string;
  basketColor: string;
  coneMaterial: 'paper' | 'composite' | 'aluminum' | 'kevlar';
}

export interface BoxParams {
  type: 'sealed' | 'ported';
  wCM: number; hCM: number; dCM: number; // external
  wallCM: number;
  portDiameterCM: number;
  portLengthCM: number;
  portCount: number;
  fillAmount: number; // 0..1 damping fill
}

export interface AmpParams {
  /** amplifier RMS output voltage */
  voltageRMS: number;
  /** nominal load impedance used for power readout */
  nominalOhm: number;
}

export interface AnalysisSettings {
  smoothingMs: number;
  sensitivity: number; // 0.25..3 gain on extracted signal
}

export interface ProjectData {
  schema: 'sonivex-project';
  version: 1;
  name: string;
  createdAt: string;
  modifiedAt: string;
  units: 'metric' | 'imperial';
  model: {
    /** absolute path of the imported model file (reference only, never modified) */
    filePath: string | null;
    fileName: string | null;
    format: 'glb' | 'gltf' | 'obj' | 'fbx' | 'procedural';
  };
  parts: PartInfo[];
  groups: MotionGroupConfig[];
  driver: DriverParams;
  box: BoxParams;
  amp: AmpParams;
  analysis: AnalysisSettings;
  view: {
    projection: 'perspective' | 'orthographic';
    shading: 'shaded' | 'wireframe' | 'ghost';
    explode: number;
    showGrid: boolean;
    autoRotate: boolean;
    /** Complete System / Driver Only / Exploded / Component Focus */
    viewMode: ViewMode;
    /** exploded-view separation distance in mm */
    explodeDistance: number;
    lighting: LightingPreset;
    /** half-model cutaway clip plane */
    cutaway: boolean;
    /** measurement guides for the selected component */
    showDimensions: boolean;
  };
  /** modular driver geometry (single source of truth for the 3D model) */
  studio: DriverStudioConfig;
  audio: {
    filePath: string | null;
    fileName: string | null;
  };
}

/** Frame-analysis result produced once per audio file (renderer) */
export interface TrackAnalysis {
  sampleRate: number;
  durationSec: number;
  hop: number;            // samples between frames
  fps: number;            // analysis frames per second
  frameCount: number;
  /** signed peak excursion waveform per frame, meters, physics-scaled (mode D basis) */
  excursionM: Float32Array;
  /** signed low-band waveform per frame (mode A basis), meters-equivalent normalized */
  waveform: Float32Array;
  /** asymmetric bass envelope 0..1+ (mode B basis) */
  envelope: Float32Array;
  /** per-frame band RMS (linear) */
  subRMS: Float32Array;   // 20-60
  bassRMS: Float32Array;  // 60-120
  upperRMS: Float32Array; // 120-250
  fullRMS: Float32Array;
  /** per-frame band-selectable history for mode C: 6 bands */
  bandRMS: Float32Array;  // frameCount * 6
  bandEdges: [number, number, number, number, number, number, number];
  /** band center frequencies (Hz) + SPL coefficient (Pa per volt RMS) for realtime SPL */
  bandCenterHz: number[];
  bandSPLCoef: number[];
  /** derived velocity / acceleration (m/s, m/s^2), physics mode */
  velocity: Float32Array;
  acceleration: Float32Array;
  /** port air velocity (m/s) via port transfer, physics mode */
  portVelocity: Float32Array;
  /** waveform display peaks: [min,max] per column */
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  stats: {
    bassP95: number;
    fullPeak: number;
    integratedLUFSapprox: number;
    crestBass: number;
  };
  /** volts RMS per unit of raw band RMS — physics calibration for this driver/amp */
  calibrationVoltsPerUnit: number;
}

export interface PhysicsCurves {
  freq: Float64Array;
  splDB: Float64Array;        // SPL @1m at amp voltage
  excursionMM: Float64Array;  // peak excursion at amp voltage
  impedanceOhm: Float64Array;
  portVelMS: Float64Array;    // port air velocity at amp voltage (0 if sealed)
  phaseDeg: Float64Array;     // electrical impedance phase
  splXmaxDB: Float64Array;    // SPL when excursion = Xmax (displacement limit)
}

export interface PhysicsSummary {
  fsHz: number; qtcOrFbHz: number; qtc: number;
  sdCM2: number; mmsG: number; cmsMMN: number; blTM: number; rmsKgS: number;
  f3Hz: number;
  volumeNetL: number;
  portVelocityAtPeMS: number;
  excursionAtPeMM: number;
  splAtPeDB: number;
  maxSplXmaxDB: number;
  airVolumeDisplacedL: number;
  warnings: string[];
}
