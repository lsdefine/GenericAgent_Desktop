#!/usr/bin/env python3
"""Assemble source-shaped Windows/Linux releases from a committed GA tree.

The two ZIPs have byte-identical common files. Only python/ is added to the
self-contained variant. Never copy a developer working directory into a release.
"""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import tarfile
import zipfile
from pathlib import Path


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def assemble(repo, ref, exe, destination, python_dir=None, platform="windows"):
    if destination.exists():
        raise ValueError(f'Refusing to overwrite {destination}')
    commit = git(repo, 'rev-parse', '--verify', ref + '^{commit}').decode().strip()
    archive = git(repo, 'archive', '--format=zip', commit)
    destination.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        for item in z.infolist():
            parts = Path(item.filename).parts
            if '..' in parts or Path(item.filename).is_absolute():
                raise ValueError(f'Unsafe archive path: {item.filename}')
            # A nested Desktop checkout and workflow metadata are not runtime inputs.
            if parts[:2] == ('frontends', 'desktop') or parts[:1] == ('.github',):
                continue
            z.extract(item, destination)
    for name in ['agentmain.py', 'frontends/desktop_bridge.py']:
        if not (destination / name).is_file():
            raise ValueError(f'Missing GA source: {name}')
    if (destination / 'runtime').exists() or (destination / 'python').exists():
        raise ValueError('GA source must not contain a preassembled runtime')
    binary = 'GenericAgent.exe' if platform == 'windows' else 'GenericAgent.AppImage'
    shutil.copy2(exe, destination / 'frontends' / binary)
    if platform == 'windows':
        (destination / 'Start GenericAgent.cmd').write_bytes(
            b'@echo off\r\nstart "" "%~dp0frontends\\GenericAgent.exe"\r\n')
    else:
        (destination / 'frontends' / binary).chmod(0o755)
        launcher = destination / 'Start GenericAgent.sh'
        launcher.write_text('#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\n'
                            'exec ./frontends/GenericAgent.AppImage "$@"\n')
        launcher.chmod(0o755)
    (destination / 'DESKTOP-RELEASE.txt').write_text(
        'GenericAgent ' + platform + ' x64 — source layout\n\n'
        'Extract the WHOLE folder, then run the Start GenericAgent launcher.\n'
        'Keep frontends/ and python/ with this GA source root.\n'
        'Explicit Desktop settings take priority over automatic discovery.\n'
        'With Python: python/ contains the interpreter and installed dependencies.\n'
        'Without Python: configure an existing Python with GA dependencies.\n'
        'Move the entire folder; never overwrite user data when upgrading.\n'
        + ('Requires Windows 10/11 x64 and Edge WebView2.\n' if platform == 'windows' else
           'Requires Linux x86_64, glibc >= 2.36 and a graphical desktop.\n'
           'If FUSE is unavailable: APPIMAGE_EXTRACT_AND_RUN=1 ./frontends/GenericAgent.AppImage\n'),
        encoding='utf-8')
    if python_dir is not None:
        copy_python(python_dir, destination, platform)
    return commit


def zip_tree(root, target):
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(root.rglob('*')):
            if path.is_file():
                z.write(path, 'GenericAgent/' + path.relative_to(root).as_posix())
    with zipfile.ZipFile(target) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP CRC verification failed')


def copy_python(source, root, platform):
    executable = 'python.exe' if platform == 'windows' else 'bin/python3'
    if not (source / executable).is_file():
        raise ValueError(f'Missing standalone Python: {executable}')
    shutil.copytree(source, root / 'python', symlinks=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo', '*.pdb'))


def archive_tree(root, target, platform):
    if platform == 'windows':
        zip_tree(root, target)
    else:
        with tarfile.open(target, 'w:gz') as archive:
            archive.add(root, arcname='GenericAgent')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--platform', choices=['windows', 'linux'], default='windows')
    p.add_argument('--ga-root', type=Path, required=True)
    p.add_argument('--ga-ref', default='HEAD')
    p.add_argument('--exe', type=Path, required=True)
    p.add_argument('--python-dir', type=Path)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    label = args.platform.capitalize()
    ext = 'zip' if args.platform == 'windows' else 'tar.gz'
    names = [f'GenericAgent-{label}-Source.{ext}']
    if args.python_dir:
        names.append(f'GenericAgent-{label}-WithPython.{ext}')
    for name in [*names, f'{args.platform}-release.json', f'SHA256SUMS-{args.platform}.txt']:
        if (args.output / name).exists():
            raise ValueError(f'Output already exists: {name}')
    with tempfile.TemporaryDirectory(prefix='ga-source-package-') as tmp:
        root = Path(tmp) / 'GenericAgent'
        commit = assemble(args.ga_root, args.ga_ref, args.exe, root, platform=args.platform)
        archive_tree(root, args.output / names[0], args.platform)
        if args.python_dir:
            copy_python(args.python_dir, root, args.platform)
            archive_tree(root, args.output / names[1], args.platform)
    desktop = Path(__file__).resolve().parent.parent
    manifest = {'layout': 'ga-source-v1', 'ga_commit': commit,
                'desktop_commit': git(desktop, 'rev-parse', 'HEAD').decode().strip(),
                'desktop_dirty': bool(git(desktop, 'status', '--porcelain')),
                'exe_sha256': digest(args.exe),
                'files': {name: digest(args.output / name) for name in names}}
    (args.output / f'{args.platform}-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / f'SHA256SUMS-{args.platform}.txt').write_text(''.join(
        f'{sha}  {name}\n' for name, sha in manifest['files'].items()))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
