#!/usr/bin/env python3
"""
Sonivex Studio — pure black & white theme conversion.
Maps every chromatic color literal to a neutral grayscale equivalent.
Normal-map canvas colors (blue-purple encodings) are intentionally untouched.
Run from repo root:  python3 scripts/bw-theme.py [--apply]
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = sorted(
    [p for p in (ROOT / "src").rglob("*") if p.suffix in (".ts", ".tsx", ".css")]
    + [ROOT / "docs/index.html", ROOT / "docs/demo.js"]
)

# exact, case-insensitive literal replacements (order: longer/more specific first)
HEX_MAP = {
    # cyan accent family → white/gray
    "#22d3ee": "#ffffff", "#67e8f9": "#f0f0f0", "#0e7490": "#8a8a8a",
    "#164e5a": "#3a3a3a", "#155e75": "#4a4a4a", "#0aa4bb": "#d4d4d4",
    "#0891b2": "#8f8f8f", "#164e63": "#3a3a3a",
    # blues → grays
    "#3b82f6": "#a8a8a8", "#93c5fd": "#c9c9c9", "#8fb6ff": "#cccccc",
    "#a78bfa": "#d4d4d4",
    # status (warn/error/success) → luminance steps
    "#ef4444": "#ffffff", "#fca5a5": "#ededed", "#f87171": "#ffffff",
    "#f59e0b": "#e2e2e2", "#fcd34d": "#d4d4d4", "#34d399": "#9e9e9e",
    "#6ee7b7": "#b0b0b0",
    # blue-tinted backgrounds / lines / text → neutral grays
    "#07090c": "#060606", "#0a0d11": "#0a0a0a", "#0b0f14": "#0d0d0d",
    "#0f1319": "#101010", "#141922": "#151515", "#1a2029": "#1c1c1c",
    "#1c2530": "#1f1f1f", "#232b38": "#242424", "#2a3442": "#2c2c2c",
    "#0a0c10": "#0a0a0a", "#0e1116": "#0f0f0f", "#15181d": "#1a1a1a",
    "#151a20": "#161616", "#1b2027": "#1b1b1b", "#3a434f": "#3d3d3d",
    "#707884": "#767676", "#3b4048": "#3d3d3d", "#2a2e35": "#2c2c2c",
    "#181c23": "#1a1a1a", "#17191e": "#181818", "#2a3038": "#2b2b2b",
    "#1a1e25": "#1c1c1c", "#101318": "#111111", "#2a2f37": "#2c2c2c",
    "#0e7f8f": "#d6d6d6",
    # cool-tinted text → neutral
    "#e8edf4": "#ededed", "#9aa7b8": "#a3a3a3", "#5c6b7e": "#6a6a6a",
    "#eef2f7": "#f2f2f2", "#b7c0cc": "#b9b9b9", "#7e8998": "#8a8a8a",
    "#55606f": "#5c5c5c", "#e2e8f0": "#e8e8e8", "#eaf2ff": "#ffffff",
    "#46586c": "#4a4a4a", "#05070a": "#050505", "#bfd6e4": "#c9c9c9",
    "#07080a": "#080808", "#20242c": "#2a2a2a", "#1d4f5a": "#303030",
    # second pass — residuals found after first sweep
    "#041014": "#0a0a0a", "#06222b": "#262626", "#071318": "#0e0e0e",
    "#0a141a": "#101010", "#0c2a33": "#262626", "#0e2a33": "#262626",
    "#10151d": "#111111", "#141a22": "#151515", "#161c24": "#171717",
    "#17b6d4": "#c9c9c9", "#1c2836": "#1e1e1e", "#1d232e": "#1e1e1e",
    "#1d2530": "#1f1f1f", "#273041": "#282828", "#2b3542": "#2d2d2d",
    "#2e3947": "#303030", "#2e3949": "#303030", "#3a4a5c": "#3d3d3d",
    "#3ee2f5": "#ececec", "#4a5361": "#4e4e4e", "#5a626e": "#606060",
    "#7a828e": "#7e7e7e", "#7deefd": "#f0f0f0", "#94a3b8": "#9e9e9e",
    "#a5f3fc": "#f0f0f0", "#d8c9a3": "#d4d4d4", "#efe3c0": "#d9d9d9",
    "#f0b95c": "#e2e2e2", "#d8dde3": "#d6d6d6",
}

RGBA_MAP = {
    # chromatic rgb() triples → neutral gray triples (alpha preserved by regex)
    (34, 211, 238): (255, 255, 255),   # cyan → white
    (59, 130, 246): (168, 168, 168),   # blue
    (167, 139, 250): (212, 212, 212),  # violet
    (245, 158, 11): (226, 226, 226),   # amber
    (239, 68, 68): (255, 255, 255),    # red
    (52, 211, 153): (158, 158, 158),   # green
    (148, 163, 184): (160, 160, 160),
    (14, 18, 24): (12, 12, 12),
    (7, 9, 12): (6, 6, 6),
    (60, 76, 95): (90, 90, 90),
    (30, 36, 44): (28, 28, 28),        # ground texture
    (16, 19, 24): (15, 15, 15),
    (10, 12, 16): (10, 10, 10),
    (14, 60, 74): (74, 74, 74),        # second pass residuals
    (14, 116, 144): (138, 138, 138),
    (250, 179, 52): (212, 212, 212),
    (34, 100, 130): (90, 90, 90),
}

def build_regexes():
    hex_re = re.compile(r"#[0-9a-fA-F]{6}\b", re.I)
    pairs_hex = {k.upper(): v.upper() for k, v in HEX_MAP.items()}
    # rgb/rgba: optional spaces after commas, css compressed alpha (.28)
    rgb_re = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,?\s*([^)]*)\)")
    return hex_re, rgb_re, pairs_hex

def map_hex(m, pairs):
    return pairs.get(m.group(0).upper(), m.group(0))

def map_rgb(m):
    r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
    t = RGBA_MAP.get((r, g, b))
    if not t:
        return m.group(0)
    alpha = (m.group(4) or "").strip()
    prefix = m.group(0)[:m.group(0).index("(") + 1]
    name = "rgba" if alpha else "rgb"
    if alpha:
        return f"rgba({t[0]},{t[1]},{t[2]},{alpha})"
    return f"rgb({t[0]},{t[1]},{t[2]})"

def main():
    apply = "--apply" in sys.argv
    hex_re, rgb_re, pairs = build_regexes()
    total = 0
    for rel in FILES:
        p = ROOT / rel
        if not p.exists():
            print(f"!! missing: {rel}"); continue
        src = p.read_text(encoding="utf-8")
        out, n_hex = hex_re.subn(lambda m: map_hex(m, pairs), src)
        def rgb_sub(m):
            r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
            t = RGBA_MAP.get((r, g, b))
            if not t:
                return m.group(0)
            alpha = (m.group(4) or "").strip()
            if alpha:
                return f"rgba({t[0]},{t[1]},{t[2]},{alpha})"
            return f"rgb({t[0]},{t[1]},{t[2]})"
        out, n_rgb = rgb_re.subn(rgb_sub, out)
        n = n_hex + n_rgb
        total += n
        if n:
            print(f"{str(p.relative_to(ROOT)):52s} {n_hex:3d} hex + {n_rgb:3d} rgb")
            if apply:
                p.write_text(out, encoding="utf-8")
    print(f"{'APPLIED' if apply else 'DRY RUN'} — total {total} replacements")
    if not apply:
        print("re-run with --apply to write changes")

if __name__ == "__main__":
    main()
