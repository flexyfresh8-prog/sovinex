# Physics Engine Reference

All computations run in SI units; results are converted for display. Sources: standard electro-acoustics (Thiele/Small small-signal modeling, Beranek, Benson).

## 1. Derived driver parameters

From the user inputs (Fs, Qes, Qms, Vas, Re, Le, Xmax, Sd):

```
Sd  = π·(Deff/2)²                       effective piston area [m²]
Cms = Vas / (Sd²·ρ₀·c²)                 suspension compliance [m/N]
ωs  = 2π·Fs
Mms = 1 / (ωs²·Cms)                     moving mass [kg]
Bl  = √(ωs·Mms·Re / Qes)                force factor [T·m]
Rms = ωs·Mms / Qms                      mechanical resistance [kg/s]
Qts = Qes·Qms / (Qes + Qms)
```
with ρ₀ = 1.204 kg/m³, c = 343 m/s.

## 2. Enclosure

**Net volume** from external dimensions and wall thickness, minus a driver/port displacement allowance.

**Sealed (single-DOF):** box compliance reflected to the mechanical side
`Cb = Vb / (ρ₀·c²·Sd²)`; total compliance `Cmt = Cms·Cb/(Cms+Cb)`;
`Fc = 1/(2π·√(Mms·Cmt))`, `Qtc = Qts·√(1 + Vas/Vb)`.

**Ported (two-DOF):** port air mass `Mp = ρ₀·Leff·Sp` with `Leff = L + 0.732·Dv` (both flanges);
Helmholtz tuning `Fb = (1/2π)·√(c²·Sp / (Vb·Leff))`;
port damping modeled as constant Qp = 25 (flared port).

## 3. Frequency-domain solve

Coupled equations are solved per frequency in **displacement form** (X in meters, RMS phasors, 1 V RMS drive):

```
Cone:   [Ksusp + Kb·Sd² − ω²Mms + jω(Rms + Bl²/Re)]·X₁ + [Kb·Sd·Sp]·X₂ = (Bl/Re)·Ve
Port:   [Kb·Sd·Sp]·X₁ + [Kb·Sp² − ω²Mp + jω·Rm2]·X₂                = 0
Kb = ρ₀c²/Vb (pressure per volume displacement)
```

- Sealed: the port row drops out; the box compliance joins Cms in series.
- Electrical impedance: `Z(f) = Re + jωLe + Bl²/Zm(f)` with `Zm = A/(jω)` from the cone row → reproduces the ported double-hump impedance with a dip at Fb.
- Volume velocities: `U_cone = Sd·jωX₁`, `U_port = Sp·jωX₂`.

## 4. Radiated sound

Far-field on-axis pressure at 1 m (piston, ka small, monopole sum):
```
p_rms = ρ₀·f·|U_total| / 2        U_total = U_cone + U_port (complex sum)
SPL   = 20·log10(p_rms / 20 µPa)
```
Displacement-limited SPL (cone radiation only, conservative below tuning):
`p = ρ₀·f²·Sd·Xpeak/(2·√2)`.

## 5. Audio → motion

1. Decode → mono mixdown → resample to 8 kHz (OfflineAudioContext, band-limited).
2. Frames: 1024-sample Hann windows, hop 128 (62.5 fps), FFT 1024 (7.8 Hz bins).
3. Per frame: band RMS levels (20–60, 60–120, 120–250 + 6 bands).
4. **Calibration:** `cal = Ve / p95(sub+bass RMS)` — the track's 95th-percentile bass moment corresponds to the set amplifier voltage. Documented estimate; see LIMITATIONS.
5. **Mode D:** bins 15–300 Hz are weighted by the complex transfer `Hx(f) = X(f)/Ve` (magnitude + phase from the solver), inverse-FFT → signed peak displacement per frame → velocity/acceleration by finite differences (smoothed).
6. **Port velocity** uses the port volume-velocity transfer `Up(f)/Ve`, peak / Sp.
7. **SPL estimate** per frame: `10·log10(Σ (coef_i · v_i)² / p_ref²)` with band-center transfer coefficients.
8. **Mode A:** signed peak of the band-limited (15–300 Hz) waveform reconstruction.
9. **Mode B/C:** positive-only envelope/band level, attack/release smoothed.

## 6. Motion application

Per frame: `x_target = signal·gain`, soft-limited `x = Xlim·tanh(x/Xlim)`, one-pole smoothed (τ = smoothing setting), applied to group members along the group axis around the group pivot. Deformable parts receive a radial-falloff bend (vertex shader, falloff² from inner to outer edge) of opposite sign, approximating surround/spider flex.

## 7. Deliberate simplifications

- Single piston radiator, no directivity, no room reflections, no Le(x) nonlinearity, no Bl(x) symmetry loss, no suspension stiffness nonlinearity (Kms(x)), no thermal compression, no port turbulence model beyond the 17 m/s rule of thumb, inductance modeled as a constant ideal (no semi-inductance).
- These are the standard small-signal assumptions; see LIMITATIONS.md for their impact.
