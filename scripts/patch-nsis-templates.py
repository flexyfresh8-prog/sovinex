#!/usr/bin/env python3
"""
Patch app-builder-lib NSIS templates in node_modules so the installer:
  1. always compiles the uninstaller sections (uninstaller.nsh)
  2. writes the uninstaller at install time via WriteUninstaller
     (instead of embedding a wine-pre-built uninstaller — enables
      wine-free Windows builds on Linux hosts)
Also regenerates build/nsis-templates/installer.nsi (custom-script copy
that makes electron-builder skip the wine uninstaller pass entirely).
Run before electron-builder. Idempotent.
"""
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = os.path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis')


def patch(path, old, new, label):
    s = open(path).read()
    if new in s:
        print('already patched:', label)
        return
    assert old in s, f'pattern not found for {label}'
    open(path, 'w').write(s.replace(old, new))
    print('patched:', label)


# 1) installer.nsi — include uninstaller.nsh unconditionally + context define
p = os.path.join(base, 'installer.nsi')
patch(p,
      '!ifdef BUILD_UNINSTALLER\n  !include "uninstaller.nsh"\n!endif',
      '!define SONIVEX_UN_CONTEXT\n!include "uninstaller.nsh"\n!undef SONIVEX_UN_CONTEXT',
      'installer.nsi (uninstaller always compiled)')

# 2) include/installer.nsh — WriteUninstaller instead of File embed
p2 = os.path.join(base, 'include', 'installer.nsh')
patch(p2,
      'File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"',
      'WriteUninstaller "${UNINSTALL_FILENAME}"',
      'include/installer.nsh (install-time uninstaller)')

# 3) include/getProcessInfo.nsh — both variants; pick via SONIVEX_UN_CONTEXT
p3 = os.path.join(base, 'include', 'getProcessInfo.nsh')
patch(p3,
      '    !ifdef BUILD_UNINSTALLER\n        Call un._GetProcessInfo\n    !else\n        Call _GetProcessInfo\n    !endif',
      '    !ifdef SONIVEX_UN_CONTEXT\n        Call un._GetProcessInfo\n    !else\n        Call _GetProcessInfo\n    !endif',
      'include/getProcessInfo.nsh (call dispatch)')
patch(p3,
      '!ifndef BUILD_UNINSTALLER\nFunction _GetProcessInfo\n    !insertmacro FUNC_GETPROCESSINFO\nFunctionEnd\n!endif\n\n!ifdef BUILD_UNINSTALLER\nFunction un._GetProcessInfo\n    !insertmacro FUNC_GETPROCESSINFO\nFunctionEnd\n!endif',
      'Function _GetProcessInfo\n    !insertmacro FUNC_GETPROCESSINFO\nFunctionEnd\n\nFunction un._GetProcessInfo\n    !insertmacro FUNC_GETPROCESSINFO\nFunctionEnd',
      'include/getProcessInfo.nsh (both functions compiled)')

# 4) regenerate custom-script copy for electron-builder (nsis.script option)
custom_dir = os.path.join(ROOT, 'build', 'nsis-templates')
os.makedirs(custom_dir, exist_ok=True)
# flatten includes so our patched files win over the originals
for sub in ('', 'include'):
    src_dir = os.path.join(base, sub) if sub else base
    for f in os.listdir(src_dir):
        if f.endswith(('.nsh', '.nsi', '.nlf', '.yml')):
            shutil.copy2(os.path.join(src_dir, f), os.path.join(custom_dir, f))
custom = os.path.join(custom_dir, 'installer.nsi')
s = open(custom).read()
marker = '!addincludedir "${PROJECT_DIR}/build/nsis-templates"'
if not s.startswith('!addincludedir'):
    s = marker + '\n\n' + s
open(custom, 'w').write(s)
print('custom NSIS script ready:', custom)
