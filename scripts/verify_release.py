#!/usr/bin/env python3
"""Check layout parity, relocate the final ZIP, and smoke-test its bundled bridge.
Does not start the desktop or touch the default bridge port / global settings.
"""
import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
import tarfile
from pathlib import Path


def check_archives(source, full):
    with zipfile.ZipFile(source) as a, zipfile.ZipFile(full) as b:
        assert a.testzip() is None and b.testzip() is None
        an, bn = set(a.namelist()), set(b.namelist())
        assert {'GenericAgent/agentmain.py', 'GenericAgent/frontends/GenericAgent.exe',
                'GenericAgent/frontends/desktop_bridge.py'} <= an
        assert an <= bn
        assert all(n.startswith('GenericAgent/python/') for n in bn - an)
        assert 'GenericAgent/python/python.exe' in bn - an
        assert not any('/runtime/' in n or '/.git/' in n for n in bn)
        for name in an:
            assert a.read(name) == b.read(name), name
        print(f'LAYOUT_OK: {len(an)} common files, only python/ added', flush=True)


def smoke(root, log):
    python = root / ('python/python.exe' if os.name == 'nt' else 'python/bin/python3')
    env = dict(os.environ)
    for key in ['PYTHONHOME', 'PYTHONPATH', 'GA_ROOT', 'GA_PROJECT_DIR', 'LD_LIBRARY_PATH']:
        env.pop(key, None)
    env.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', GA_ROOT=str(root))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env['BRIDGE_PORT'] = str(port)
    env['BRIDGE_HOST'] = '127.0.0.1'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(path):
        with opener.open(f'http://127.0.0.1:{port}{path}', timeout=2) as r:
            return json.load(r)

    with log.open('wb') as stream:
        process = subprocess.Popen([str(python), '-B', str(root / 'frontends/desktop_bridge.py')],
                                   cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Bridge exited {process.returncode}; see {log}')
                try:
                    identity = get('/services/identity')
                    if get('/status').get('ready'):
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(.25)
            else:
                raise RuntimeError(f'Bridge did not become ready; see {log}')
            assert Path(identity['ga_root']).resolve() == root.resolve(), identity
            assert Path(identity['app_dir']).resolve() == (root / 'frontends').resolve(), identity
            assert identity['pid'] == process.pid, identity
            assert get('/sessions')['sessions'] == []
            request = urllib.request.Request(f'http://127.0.0.1:{port}/services/bridge/exit',
                                             data=b'', method='POST')
            with opener.open(request, timeout=3) as response:
                assert response.status == 200
            process.wait(timeout=10)
            assert process.returncode == 0
            print('RELOCATED_BRIDGE_OK', identity, flush=True)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


def check_linux(source, full):
    with tarfile.open(source) as a, tarfile.open(full) as b:
        am = {m.name: m for m in a.getmembers() if not m.isdir()}
        bm = {m.name: m for m in b.getmembers() if not m.isdir()}
        assert am.keys() <= bm.keys()
        assert all(n.startswith('GenericAgent/python/') for n in bm.keys() - am.keys())
        for name, member in am.items():
            assert member.mode == bm[name].mode
            assert a.extractfile(member).read() == b.extractfile(bm[name]).read(), name
        assert bm['GenericAgent/frontends/GenericAgent.AppImage'].mode & 0o111
        assert bm['GenericAgent/Start GenericAgent.sh'].mode & 0o111
        assert 'GenericAgent/python/bin/python3' in bm
        assert not any('/runtime/' in n or '/.git/' in n for n in bm)
        print(f'LAYOUT_OK: {len(am)} common files, only python/ added', flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--platform', choices=['windows','linux'], default='windows')
    p.add_argument('output', type=Path)
    args = p.parse_args()
    label = args.platform.capitalize()
    ext = 'zip' if args.platform == 'windows' else 'tar.gz'
    source = args.output / f'GenericAgent-{label}-Source.{ext}'
    full = args.output / f'GenericAgent-{label}-WithPython.{ext}'
    (check_archives if args.platform == 'windows' else check_linux)(source, full)
    with tempfile.TemporaryDirectory(prefix='ga-release-verify-') as tmp:
        base = Path(tmp)
        if args.platform == 'windows':
            with zipfile.ZipFile(full) as z:
                z.extractall(base)
        else:
            with tarfile.open(full) as t:
                t.extractall(base, filter='data')
        moved = base / 'relocated GA with spaces'
        (base / 'GenericAgent').rename(moved)
        smoke(moved, args.output / 'bridge-smoke.log')
    (args.output / 'verification.json').write_text(json.dumps({
        'layout_parity': True, 'relocated_bridge': True,
        'desktop_ui_tested': False}, indent=2))


if __name__ == '__main__':
    main()
