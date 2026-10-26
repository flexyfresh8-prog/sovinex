/**
 * Windows build runner with NSIS script dump for debugging.
 * Runs electron-builder programmatically so we can intercept executeMakensis.
 */
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
require('app-builder-lib'); // load index first to init circular deps in correct order
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
const { build, Platform, Arch } = require('app-builder-lib');
const yaml = require('js-yaml');

const dump = process.env.NSIS_DUMP === '1';
if (dump) {
  const orig = NsisTarget.prototype.executeMakensis;
  NsisTarget.prototype.executeMakensis = function (defines, commands, script) {
    fs.writeFileSync('/tmp/nsis-script.nsi', script);
    fs.writeFileSync('/tmp/nsis-defines.json', JSON.stringify(defines, null, 2));
    console.log('[dist-win] dumped NSIS script + defines');
    return orig.call(this, defines, commands, script);
  };
}

const yml = fs.readFileSync('electron-builder.yml', 'utf8');
const config = yaml.load(yml);

try {
  const result = await build({
    config,
    publish: null,
    projectDir: process.cwd(),
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
  });
  console.log('[dist-win] DONE:', result?.length ?? 0, 'artifacts');
  result?.forEach((a) => console.log('  -', a.file ?? a));
} catch (e) {
  console.error('[dist-win] FAILED:', e.message?.slice(-3500));
  process.exit(1);
}
