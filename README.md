# Sonivex Studio

**Design. Simulate. Validate.**

Professional desktop software for subwoofer design, audio-driven visualization and virtual testing. Import your Tripo AI model, assign parts, play your music and watch the physics — excursion, SPL, port velocity, Xmax usage — computed in real time from real electro-acoustic models.

[![Build Windows](https://github.com/flexyfresh8-prog/sovinex/actions/workflows/build-windows.yml/badge.svg)](https://github.com/flexyfresh8-prog/sovinex/actions/workflows/build-windows.yml)
![tests](https://img.shields.io/badge/unit_tests-39%2F39-brightgreen)
![platform](https://img.shields.io/badge/platform-Windows_x64-blue)

**Web:** [flexyfresh8-prog.github.io/sovinex](https://flexyfresh8-prog.github.io/sovinex/) — mobile-friendly site with a live 3D preview of the 15-part model.

---

## Downloads (GitHub Releases)

Grab the latest build from **[Releases](https://github.com/flexyfresh8-prog/sovinex/releases/latest)** — every release is produced and tested by this repository's CI pipeline ([workflow runs](https://github.com/flexyfresh8-prog/sovinex/actions)):

| File | Purpose |
|------|---------|
| `Sonivex-Studio-Setup-1.0.2.exe` | Standard installer (Start Menu + Desktop shortcuts, uninstaller, `.svx` file association) |
| `Sonivex-Studio-Portable-1.0.2.exe` | Portable single-file build — run from anywhere, no installation |
| `checksums-sha256.txt` | SHA-256 checksums for both executables |

Every push to `main` also produces downloadable build artifacts on the [Actions page](https://github.com/flexyfresh8-prog/sovinex/actions?query=branch%3Amain).

> **SmartScreen note:** the binaries are **unsigned** (no code-signing certificate). Windows SmartScreen may show *"Windows protected your PC"*. Click **More info → Run anyway**. This is expected for unsigned freeware; verify checksums before running.

## System requirements

- Windows 10/11 x64 (integrated GPUs are fully supported — rendering uses hardware WebGL with automatic software fallback)
- ~400 MB disk space, 4 GB RAM recommended
- Audio output device (for playback-driven simulation)

---

## Feature overview

### 1. Model import (GLB / GLTF / OBJ / FBX)
- Every mesh in the file is preserved as its own part — **nothing is merged, deleted or replaced**; the source file is never modified.
- Scene hierarchy, mesh names and original transforms are read; each part gets a stable internal ID (`p0…pN`) and a geometry inspection record (vertices, triangles, bounding box, symmetry axis, ring-ness metrics).
- **Tripo 15-part subwoofer support:** when a 15-part model is imported, part **#3 is pre-assigned as the Cone** (per specification), with the rest auto-classified from geometry — all assignments are user-editable and persisted.
- If the source model has blank materials (typical for Tripo exports), Sonivex applies **studio PBR materials** automatically (composite-weave cone, rubber surround, brushed-aluminum motor, piano-black cabinet). Original materials are respected whenever they contain real data ("Model → Apply Studio Materials" re-applies enhancement on demand).
- Geometry smoothing: vertices are welded (10 µm tolerance) and normals recomputed for a clean shaded look.

### 2. Reference assembly
A beautiful 15-part procedural subwoofer (same part numbering — part #3 = cone) is built in at first launch, so the workspace is immediately alive: PBR materials, environment lighting, soft shadows, bloom, hover/selection outlines, explode view, six standard camera views, orthographic/perspective toggle, wireframe and X-ray shading.

### 3. Part customization (change sizes and stuff)
**Driver tab:** effective piston diameter, Fs, Qes, Qms, Vas, Re, Le, Xmax, rated power, cone depth, surround width, dust-cap radius/height, magnet diameter/height, cone material (paper / composite / aluminum / kevlar), amplifier voltage and load impedance. Geometry edits regenerate the 3D assembly live (for the reference model) and immediately recompute all physics.

**Box tab:** sealed or ported, external W×H×D, wall thickness, damping fill, port diameter/length/count. Net volume (minus driver and port displacement) is derived automatically.

### 4. Audio import & playback
MP3 / WAV / FLAC / OGG (file dialog or drag-and-drop onto the window), full transport (play / pause / stop / seek / loop / volume), waveform display with playhead and click-to-seek, live log-spaced spectrum with SUB / BASS / UP-BASS / MID markers, and four built-in synthesized test signals (sine sweep, kick pattern, 40 Hz tone, bass demo loop) — no external assets needed.

### 5. Real physics — not just volume wiggling
- On import the track is resampled to 8 kHz and analyzed with a custom radix-2 FFT (128 ms windows, 62.5 fps): per-frame sub-bass (20–60), bass (60–120), upper-bass (120–250) and six selectable band levels.
- **Excursion transfer function:** your Thiele/Small parameters + enclosure are solved as a lumped electro-mechanical model (complex algebra, displacement form). The track's spectrum is filtered through |Hx(f)|·e^{jφ(f)} and inverse-transformed → a **signed** displacement waveform (cone moves in AND out around rest).
- Calibration is honest and documented: the track's 95th-percentile bass level is mapped to your set amplifier voltage. This makes it an *estimate*, clearly labeled as such — never a fabricated measurement.
- **Live physics HUD:** instantaneous excursion (mm, with Xmax limit gauge), cone velocity (m/s), cone acceleration (g), estimated SPL @1 m (dB), port air velocity (m/s, with 17 m/s chuffing threshold) — all position-based, so pause/seek/loop are sample-accurate with zero drift.
- **Track statistics:** physics-mode peak excursion and **% of track time above Xmax** ("bottoming-out risk") — the killer answer to *"will this sub handle this song at this power?"*

### 6. Four motion modes
| Mode | Name | Behavior |
|------|------|----------|
| A | Waveform | Signed low-band reconstruction — oscillates in/out. Audio visualization. |
| B | Envelope | Asymmetric bass envelope, push-out only. Audio visualization. |
| C | Band | User-selected frequency band level. Audio visualization. |
| D | **Physics** | Excursion through the full driver+box transfer model. **Default.** |

Motion is applied **only** to parts in enabled motion groups. Everything else — enclosure, magnets, basket, trim — stays exactly at rest. Group config: axis (X/Y/Z), pivot, gain, smoothing, hard displacement limit (soft tanh limiter at Xmax), invert, per-part membership. Deformable parts (surround/spider) get a radial-falloff vertex bend approximation, separate from rigid motion. One click restores the exact rest pose.

### 7. Engineering results
Frequency-response plots (SPL, excursion vs Xmax, impedance with ported double-hump, port velocity vs chuffing line), alignment summary (Fb/Fc, Qtc, F3, net Vb), derived parameters (Mms, Bl, Cms), warning list (over-Xmax, port chuffing, Fb≈Fs, Qtc extremes), CSV export of all curves, and a formatted **PDF report**.

### 8. Projects
`.svx` files (versioned JSON + defensive schema validation) store the model reference, all 15 part IDs, roles, groups, axes/pivots, driver/box/amp parameters, audio reference and view settings. Autosave every 20 s with crash-restore prompt. Reopening a project re-resolves model and audio files; missing files degrade gracefully with clear warnings.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `S` | Stop · `R` reset motion · `F` fit view |
| `←` / `→` | Seek −/+ 5 s |
| `1`–`6` | Front / Back / Left / Right / Top / ISO |
| `Ctrl+N/O/S` | New / Open / Save project |
| `Ctrl+Shift+S` | Save project as |
| `Ctrl+M` / `Ctrl+I` | Import model / audio |
| `Esc` | Clear selection |

## Building from source

```bash
npm install
npm test          # 39 unit tests (physics, FFT/analysis, schema)
npm run dist      # → release/Sonivex-Studio-Setup-1.0.2.exe + Portable
```

Requirements: Node.js 20+, Python (only for the NSIS template patcher). Windows builds work **on Linux/macOS hosts without wine** — see `scripts/patch-nsis-templates.py` (installs the uninstaller at install time via `WriteUninstaller`) and `scripts/patch-win-exe.mjs` (pure-JS icon/version embedding via `resedit`). CI runs the same pipeline natively on `windows-latest` (`.github/workflows/build-windows.yml`) on every push and attaches installers to GitHub Releases on version tags.

## Architecture

```
src/
  main/          Electron main process (secure IPC, dialogs, PDF, autosave)
  shared/        Physics engine · FFT/audio analysis · project schema (testable, no UI deps)
  renderer/      React UI · Three.js viewport · motion system · audio engine
tests/           vitest suites
docs/            GitHub Pages site (mobile-first + live 3D preview) · PHYSICS.md · LIMITATIONS.md · ACCEPTANCE.md
```

Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload bridge, every IPC payload validated (extensions, size limits, path checks).

## Documentation

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — every formula used, with assumptions
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what the estimates can and cannot tell you
- [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) — acceptance test checklist
