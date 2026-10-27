/**
 * Docs engine entry — bundles the Driver Studio modeling engine for the
 * GitHub Pages demo (esbuild --external:three, ESM). The Pages demo loads
 * the exact same geometry code as the desktop app: one source of truth.
 */
export { DriverStudio } from './buildDriver';
export { MotionSystem } from '../MotionSystem';
export { defaultStudioConfig, clampConfig, validateConfig, monochrome } from '../../../shared/driver/studioConfig';
