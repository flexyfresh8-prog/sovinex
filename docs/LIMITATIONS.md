# Limitations & Honesty Statement

Sonivex Studio computes **engineering estimates from models** — it does not measure a physical loudspeaker. Understanding these limits is part of using the tool correctly.

## 1. What the animation is — and is not

| Mode | What it shows | Status |
|------|---------------|--------|
| A – Waveform | Band-limited audio waveform, scaled to Xmax | **Audio visualization** |
| B – Envelope | Bass energy level, push-out only | **Audio visualization** |
| C – Band | Selected band level | **Audio visualization** |
| D – Physics | Excursion through the driver+box transfer model | **Physics-based estimate** |

Only mode D maps the audio through your actual Thiele/Small parameters and enclosure. Modes A–C are clearly labeled visualizations.

## 2. Calibration assumption (mode D)

The application cannot know the true electrical level of a compressed MP3. The estimate assumes the track's **95th-percentile bass moment corresponds to your set amplifier voltage**. Consequences:

- Quiet masters will read high, loud/modern masters will read lower relative to their peaks.
- Peak excursion and "time over Xmax" are **relative-risk indicators**, not absolute predictions.
- For validated displacement you must measure: test tones + oscilloscope/laser displacement or a distortion analyzer. No software can substitute for this.

## 3. Model assumptions

- **Small-signal linearity:** Bl(x), Le(x), Kms(x) asymmetry and suspension stiffening are not modeled. At/over Xmax the real driver produces more distortion and less excursion than predicted.
- **Piston radiation, no directivity, no room:** SPL estimates are anechoic, on-axis, far-field 1 m values. Your room adds ±6 dB or more of modal structure.
- **Constant Le:** voice-coil inductance varies with frequency and position; the classic semi-inductance behavior (SPL droop above a few hundred Hz) is not modeled.
- **Port model:** constant Qp = 25, no turbulence/compression, no port nonlinearity. The 17 m/s chuffing threshold is a rule of thumb, not a guarantee.
- **Thermal effects:** voice-coil heating (power compression) is not modeled. Long-term high-power behavior will differ.
- **No mechanical limits beyond Xmax:** bottoming out (coil former hitting backplate), cone break-up modes and surround deformation limits are not simulated.

## 4. Import & classification

- Part classification is heuristic (symmetry, size, ring-ness). It **always** requires human confirmation — the Parts panel and Assembly Explorer exist exactly for that. A wrong classification never breaks the scene; it only changes what moves.
- Tripo/AI-generated meshes have arbitrary topology. The vertex-bend "flex" approximation for deformable parts is a visual approximation and depends on the part's radial structure; if it looks wrong, set the part back to Static or Moving.
- Materials: models with real textures keep them. Blank Tripo materials get studio PBR substitutes — decorative, not physically measured colors.

## 5. Analysis fidelity

- 8 kHz analysis rate captures 15–400 Hz content — everything relevant for a subwoofer. Ultrasonic content is intentionally ignored.
- 62.5 fps frame grid: sub-frame motion is interpolated; very fast transients (<16 ms) are smoothed by design.
- The LUFS figure shown is an approximation (K-weighting is not fully implemented) and is labeled as such.

## 6. Distribution

Binaries are **not code-signed**. SmartScreen will warn. The uninstaller is generated at install time by NSIS (a consequence of the wine-free Linux build path) and is not separately signed. For public distribution, sign with an EV/OV certificate (`electron-builder` supports it via the standard config).
