import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import config from '../../src-tauri/tauri.conf.json';
import pkg from '../../package.json';

describe('release version', () => {
  it('keeps renderer, package and native versions aligned', () => {
    expect(pkg.version).toBe(config.version);
    const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
    expect(cargo.match(/^version = "([^"]+)"/m)?.[1]).toBe(config.version);
    const statusbar = fs.readFileSync('src/components/layout/Statusbar.tsx', 'utf8');
    expect(statusbar).toContain('src-tauri/tauri.conf.json');
    expect(statusbar).toContain('`v${desktopVersion}`');
    expect(statusbar).not.toMatch(/label="v\d/);
  });
});
