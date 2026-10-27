#!/usr/bin/env node
/**
 * Monochrome pass — remaps every colored accent in app.css and the canvas
 * UI components to grayscale. Run once; kept for reproducibility.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'src/renderer/styles/app.css',
  'src/renderer/ui/Gauges.tsx',
  'src/renderer/ui/BottomDock.tsx',
  'src/renderer/ui/TopBar.tsx',
];

const MAP = [
  // css variables
  ['--accent: #22d3ee;', '--accent: #f2f2f2;'],
  ['--accent-dim: #0e7490;', '--accent-dim: #8a8a8a;'],
  ['--accent-deep: #164e5a;', '--accent-deep: #2e2e2e;'],
  ['--blue: #3b82f6;', '--blue: #b9b9b9;'],
  ['--violet: #a78bfa;', '--violet: #a8a8a8;'],
  ['--amber: #f59e0b;', '--amber: #e8e8e8;'],
  ['--red: #ef4444;', '--red: #ffffff;'],
  ['--green: #34d399;', '--green: #c9c9c9;'],
  ['--glow-cyan-lg: 0 0 24px rgba(34, 211, 238, 0.28), 0 0 64px rgba(34, 211, 238, 0.10);',
   '--glow-white-lg: 0 0 24px rgba(255, 255, 255, 0.20), 0 0 64px rgba(255, 255, 255, 0.06);'],
  ['--glow-cyan: 0 0 12px rgba(34, 211, 238, 0.35);',
   '--glow-white: 0 0 12px rgba(255, 255, 255, 0.25);'],
  // generic rgba tints
  [/rgba\(34, 211, 238,\s*([\d.]+)\)/g, 'rgba(255, 255, 255, $1)'],
  [/rgba\(59, 130, 246,\s*([\d.]+)\)/g, 'rgba(255, 255, 255, $1)'],
  // stray hexes in css
  ['#1c2836', '#242428'],
  ['#a5f3fc', '#ffffff'],
  ['#2e3949', '#3a3a3f'],
  ['#232b38', '#28282c'],
  ['#0aa4bb', '#d8d8d8'],
  ['#1d4f5a', '#242428'],
  ['#0e7490', '#8a8a8a'],
  ['#164e5a', '#2e2e2e'],
  ['#22d3ee', '#e8e8e8'],
  ['#3b82f6', '#b9b9b9'],
  ['#ef4444', '#ffffff'],
  ['#f59e0b', '#e8e8e8'],
  ['#a78bfa', '#9a9a9a'],
  ['#0891b2', '#6a6a6a'],
  ['#67e8f9', '#ffffff'],
  // var renames
  [/var\(--glow-cyan-lg\)/g, 'var(--glow-white-lg)'],
  [/var\(--glow-cyan\)/g, 'var(--glow-white)'],
  // header comment
  ['Deep graphite engineering workstation · cyan/electric-blue accents',
   'Pure black & white engineering workstation — strictly monochrome'],
];

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  for (const [from, to] of MAP) {
    src = typeof from === 'string' ? src.split(from).join(to) : src.replace(from, to);
  }
  writeFileSync(f, src);
  console.log('mono →', f);
}
