# Acceptance Test Checklist

Automated coverage where possible (vitest, 39 tests); manual steps for UI/3D behaviors. Run the manual list against `Sonivex-Studio-Setup-1.0.0.exe`.

## A. Automated (npm test — all passing)

1. **Driver derivation chain** — Fs round-trips from Mms·Cms; Qts, Cms, Sd correct.
2. **Sealed box** — Fc > Fs, Qtc formula, excursion flat below Fc / 12 dB/oct above, impedance peak at Fc, SPL flattening in the piston band, linear voltage scaling.
3. **Ported box** — Helmholtz Fb matches the closed-form reference, impedance double-hump with dip at tuning (near Re), excursion minimum at Fb, port velocity scaling with voltage.
4. **Warnings** — over-Xmax and chuffing warnings fire at high drive; silent at sane drive.
5. **FFT** — forward/inverse round-trip < 1e-9 error, single-tone bin detection, Hann window properties.
6. **Analysis** — 40 Hz sine lands in sub/bass not upper-bass; **signed** (oscillating) physics excursion; silence → zero; 2× voltage → ~2× excursion; port velocity nonzero (ported) / zero (sealed); stable fps; plausible SPL coefficients.
7. **Project schema** — 15 default parts, part #3 = Cone (moving), group pre-assigned with mode D; round-trip serialization; schema rejection; numeric clamping; user assignment preservation.
8. **Auto-classification on the real Tripo geometry** (measured metrics embedded in the test) — enclosure static, part #3 forced to Cone with confidence 1.0, never everything moving.

## B. Manual (packaged application)

Run against the installed app (`Sonivex-Studio-Setup-1.0.0.exe`):

- [ ] **M1 — 15-part import.** Model → Import 3D Model → select `loudspeaker 3d model.glb`. Console reports *"All 15 parts detected and preserved. Part #3 pre-assigned as Cone."* Assembly Explorer lists 15 rows with role chips; viewport shows the model with studio materials.
- [ ] **M2 — Cone + cap move together.** Generate Test Signal → Kick Pattern; press Play. Cone (#3) and Dust Cap (#4) translate along the model's axis in sync; Surround (#6) flexes; Enclosure (#1), Motor (#2), vents, trim never move.
- [ ] **M3 — Static-part invariance.** With playback running, select the Enclosure — its transform readout stays identical to rest. Reset Motion (R) returns everything to the exact rest pose.
- [ ] **M4 — Disabled group stays at rest.** Motion tab → toggle group off → cone does not move; audio still plays. Re-enable → motion resumes.
- [ ] **M5 — Pause/seek/loop stability.** Pause → cone freezes at a position-based frame (no drift). Seek → animation and HUD jump coherently. Loop → continuous, no jumps.
- [ ] **M6 — Physics HUD sanity.** HUD shows excursion (mm) with Xmax gauge, velocity, acceleration, SPL, port velocity; excursion gauge turns red past Xmax; Results tab shows peak excursion + % over Xmax for the loaded track.
- [ ] **M7 — Customization.** Driver tab: change size preset to 15" → geometry (reference assembly) regenerates; physics curves change. Box tab: switch sealed ↔ ported → Physics panel shows Fc/Qtc or Fb/port velocity accordingly. Port diameter ↑ → port velocity ↓.
- [ ] **M8 — Persistence.** Save project → close app → reopen → open the .svx: model restored from the referenced file, all 15 roles/groups intact, audio reloads and analyzes automatically. Missing model/audio files produce warnings with graceful fallback.
- [ ] **M9 — Packaging.** Setup installs to `%LOCALAPPDATA%\Programs`, creates Start Menu + Desktop shortcuts, registers .svx, uninstalls cleanly. Portable exe runs from any folder. Both show the Sonivex cone icon; exe Properties → Details shows Sonivex Studio metadata.

## Known cosmetic/behavioral notes

- First SmartScreen launch requires "More info → Run anyway" (unsigned).
- On very weak iGPUs, disable bloom by keeping the viewport small — software WebGL fallback works but reduces frame rate.
- The uninstaller is generated during installation (wine-free build path) — it is fully functional but unsigned.
