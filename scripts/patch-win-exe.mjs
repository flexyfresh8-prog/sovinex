/**
 * electron-builder afterPack hook: patches the Windows executable with the
 * Sonivex Studio icon + version metadata using pure-JS PE editing (resedit).
 * This replaces the wine-dependent rcedit step on Linux build hosts.
 */
import fs from 'fs';
import path from 'path';
import * as ResEdit from 'resedit';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const productExe = context.packager.appInfo.productFilename + '.exe';
  const exePath = path.join(context.appOutDir, productExe);
  if (!fs.existsSync(exePath)) {
    console.warn('[patch-win-exe] exe not found:', exePath);
    return;
  }
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  // 1) icon
  if (fs.existsSync(iconPath)) {
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    for (const g of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries, g.id, g.lang,
        iconFile.icons.map((item) => item.data),
      );
    }
    console.log(`[patch-win-exe] icon embedded into ${groups.length} group(s)`);
  }

  // 2) version info
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0];
  if (vi) {
    vi.setFileVersion(1, 0, 0, 0, 1033);
    vi.setProductVersion(1, 0, 0, 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: 'Sonivex Studio — Design. Simulate. Validate.',
      ProductName: 'Sonivex Studio',
      CompanyName: 'Sonivex Engineering',
      LegalCopyright: 'Copyright © 2026 Sonivex Engineering',
      OriginalFilename: productExe,
      InternalName: 'sonivex-studio',
    });
    vi.outputToResourceEntries(res.entries);
    console.log('[patch-win-exe] version info updated');
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[patch-win-exe] patched', exePath);
}
