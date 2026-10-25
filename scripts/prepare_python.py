#!/usr/bin/env python3
"""Prepare a relocatable Windows/Linux Python outside the GA source tree."""
import argparse
import hashlib
import os
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

URL = ('https://github.com/astral-sh/python-build-standalone/releases/download/'
       '20260814/cpython-3.12.14%2B20260814-x86_64-pc-windows-msvc-install_only.tar.gz')
SHA256 = '7330282b47cd43a66b702d39078d2e5a88e580cee351d82f95045f21f5ee042a'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--platform', choices=['windows','linux'], default='windows')
    p.add_argument('destination', type=Path)
    args = p.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise ValueError(f'Refusing to reuse runtime directory: {destination}')
    destination.mkdir(parents=True)
    archive = destination / 'python.tar.gz'
    url, sha = URL, SHA256
    if args.platform == 'linux':
        url = URL.replace('x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu')
        sha = '3297691ae34f75fed81ac424e040145fccb0bafe8e581cd5cadbddfa1c0766c0'
    urllib.request.urlretrieve(url, archive)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != sha:
            raise ValueError('Python archive SHA256 mismatch')
    with tarfile.open(archive) as t:
        t.extractall(destination, filter='data')
    python = destination / ('python/python.exe' if args.platform == 'windows' else 'python/bin/python3')
    if args.platform == 'windows':
        sdk = Path(os.environ['ProgramFiles(x86)']) / 'Windows Kits/10/Redist'
        versions = sorted(sdk.glob('*/ucrt/DLLs/x64'),
                          key=lambda p: tuple(int(n) for n in p.parts[-4].split('.')))
        if not versions:
            raise ValueError('Windows SDK UCRT redistributable not found')
        for dll in versions[-1].glob('*.dll'):
            shutil.copy2(dll, python.parent / dll.name)
        if not (python.parent / 'api-ms-win-crt-runtime-l1-1-0.dll').exists():
            raise ValueError('UCRT deployment incomplete')
    env = dict(os.environ)
    for key in ['PYTHONHOME', 'PYTHONPATH']:
        env.pop(key, None)
    env.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1')
    lock = Path(__file__).resolve().parent.parent / 'packaging/python-runtime-requirements.txt'
    subprocess.run([str(python), '-m', 'pip', 'install', '--only-binary=:all:',
                    '--no-compile', '-r', str(lock)], env=env, check=True)
    subprocess.run([str(python), '-m', 'pip', 'check'], env=env, check=True)
    subprocess.run([str(python), '-B', '-c',
                    'import aiohttp,requests,psutil,websockets,fastapi; '
                    'import sys; assert sys.version_info[:3] == (3,12,14)'],
                   env=env, check=True)
    print(python.parent)


if __name__ == '__main__':
    main()
