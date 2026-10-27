# Sonivex Studio

**Design. Simulate. Validate.**

Professional desktop software for subwoofer design, audio-driven visualization and virtual testing. The driver is **generated entirely in code** — a fully procedural, ultra-detailed modular assembly — play your music and watch the physics: excursion, SPL, port velocity, Xmax usage, computed in real time from real electro-acoustic models. Strict black & white engineering workspace.

[![Build Windows](https://github.com/flexyfresh8-prog/sovinex/actions/workflows/build-windows.yml/badge.svg)](https://github.com/flexyfresh8-prog/sovinex/actions/workflows/build-windows.yml)
![tests](https://img.shields.io/badge/unit_tests-64%2F64-brightgreen)
![platform](https://img.shields.io/badge/platform-Windows_x64-blue)

**Web:** [flexyfresh8-prog.github.io/sovinex](https://flexyfresh8-prog.github.io/sovinex/) — **Live Subwoofer** experience (v1.3): the driver alone on a dark stage — nothing else. Import your own **MP3 / WAV / OGG / FLAC** (or hit the built-in demo loop), shape it with the **8-band graphic EQ** (presets: Flat / Bass Boost / Deep / Loud / Vocal / Treble), hit play, and **watch the cone move** with the bass — signed excursion with the surround and spider flexing in real time, auto-calibrated to any track. Orbit / pinch to inspect, `MOTION` slider scales the excursion. The geometry is still 100% procedural — no model download. The classic product page remains at [studio.html](https://flexyfresh8-prog.github.io/sovinex/studio.html).

---

## Downloads (GitHub Releases)

Grab the latest build from **[Releases](https://github.com/flexyfresh8-prog/sovinex/releases/latest)** — every release is produced and tested by this repository's CI pipeline ([workflow runs](https://github.com/flexyfresh8-prog/sovinex/actions)):

| File | Purpose |
|------|---------|
| `Sonivex-Studio-Setup-1.2.0.exe` | Standard installer (Start Menu + Desktop shortcuts, uninstaller, `.svx` file association) |
| `Sonivex-Studio-Portable-1.2.0.exe` | Portable single-file build — run from anywhere, no installation |
| `checksums-sha256.txt` | SHA-256 checksums for both executables |

Every push to `main` also produces downloadable build artifacts on the [Actions page](https://github.com/flexyfresh8-prog/sovinex/actions?query=branch%3Amain).

> **SmartScreen note:** the binaries are **unsigned** (no code-signing certificate). Windows SmartScreen may show *"Windows protected your PC"*. Click **More info → Run anyway**. This is expected for unsigned freeware; verify checksums before running.

## System requirements

- Windows 10/11 x64 (integrated GPUs are fully supported — rendering uses hardware WebGL with automatic software fallback)
- ~400 MB disk space, 4 GB RAM recommended
- Audio output device (for playback-driven simulation)

---

## Feature overview

### 1. Procedural Driver Studio (v1.2.0)
The driver is **generated in code** — no downloaded mesh. 14 independently modeled components are assembled with real mechanical relationships from one centralized configuration: cone (curved lathe shell + stiffening ribs + neck collar), dust cap (dome / shallow / flat / inverted), half-roll surround (rubber / foam), voice coil + former (visible winding layers, collar, lead-outs), corrugated fabric spider, ferrite or neodymium magnet stack, steel top & bottom plates, vented center pole, cast/stamped basket with real window openings and spokes, mounting gasket, terminal block or cup, tinsel leads, and hex mounting hardware.

**Roles are assigned at construction time**: cone + dust cap + voice coil + leads are the moving group; the surround and spider are flex-only deformables (vertex-shader bend — inner edge glued to the cone, outer edge bolted to the frame); everything else never moves. The same engine drives the GitHub Pages demo (bundled as `docs/driver-model.js`).

### 2. View modes & inspection
- **Complete System** — the driver seated in its enclosure (ported or sealed box with baffle, cutout, ports, terminal cup, feet)
- **Driver Only** — the enclosure is removed from the scene entirely (never just ghosted); the driver is framed on its display stand
- **Driver Exploded** — animated separation along the drive axis with adjustable distance (40–300 mm); parts stay selectable while exploded
- **Component Focus** — isolate one component and frame it
- Plus: front/back/side/top/bottom/ISO camera presets, fit-to-object, wireframe, X-ray, **cutaway clipping plane**, measurement guides with dimension labels, three lighting presets (studio / inspection / presentation), orbit/zoom/pan, one-click **Assemble Driver**

### 3. Component customization (STUDIO tab)
Every dimension of every component is live-editable through the shared studio config (single source of truth): frame diameter; cone diameter/depth/profile/thickness/neck; dust-cap size & shape; surround inner/outer Ø, roll height/width/thickness & profile; voice-coil Ø, winding height/thickness/layers, former height; magnet Ø / layer height / layer count; plate thicknesses; pole diameter & extension; basket depth/spokes/spoke width/flange/mounting holes; spider Ø / corrugation count & depth / rest position; gasket; terminal style; screws and finish colors (grayscale swatches).

Sliders for quick adjustment, numeric inputs for precise measurements, **mm ↔ inch** toggle, per-component visibility/isolation in the Assembly Explorer, and **live validation** — coil-vs-neck interference, pole gap, surround seal, spider clearance, Xmax over-hang — with warnings as you drag. Updates are dependency-aware: changing one dimension rebuilds exactly the parts it affects and every neighbor stays seated.

**Driver tab (physics):** effective piston diameter, Fs, Qes, Qms, Vas, Re, Le, Xmax, rated power, amplifier voltage and load impedance — the Thiele/Small layer stays fully editable alongside the geometry layer. **Box tab:** sealed or ported, external W×H×D, wall thickness, damping fill, port diameter/length/count; net volume is derived automatically.

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
npm test          # 64 unit tests (physics, FFT/analysis, schema, motion contract, driver studio)
npm run dist      # → release/Sonivex-Studio-Setup-1.2.0.exe + Portable
```

Requirements: Node.js 20+, Python (only for the NSIS template patcher). Windows builds work **on Linux/macOS hosts without wine** — see `scripts/patch-nsis-templates.py` (installs the uninstaller at install time via `WriteUninstaller`) and `scripts/patch-win-exe.mjs` (pure-JS icon/version embedding via `resedit`). CI runs the same pipeline natively on `windows-latest` (`.github/workflows/build-windows.yml`) on every push and attaches installers to GitHub Releases on version tags.

## Architecture

```
src/
  main/          Electron main process (secure IPC, dialogs, PDF, autosave)
  shared/        Physics engine · FFT/audio analysis · project schema (testable, no UI deps)
  renderer/      React UI · Three.js viewport · motion system · audio engine
tests/           vitest suites
docs/            GitHub Pages **live subwoofer experience** (sub-only stage · MP3 import ·
                 8-band EQ · real cone excursion) + classic site (studio.html) ·
                 PHYSICS.md · LIMITATIONS.md · ACCEPTANCE.md
```

Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload bridge, every IPC payload validated (extensions, size limits, path checks).

## Documentation

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — every formula used, with assumptions
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what the estimates can and cannot tell you
- [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) — acceptance test checklist
