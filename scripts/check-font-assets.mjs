import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

for (const dir of ['public', 'static']) {
  test(`${dir}: brand uses bundled Lexend without local font dependencies`, () => {
    const css = read(`${dir}/assets/fonts/fonts.css`);
    assert.match(css, /font-family: "GA Lexend"/);
    assert.match(css, /url\("\.\/lexend-latin\.woff2"\)/);
    assert.match(css, /font-weight: 100 900/);
    assert.doesNotMatch(css, /Azonix|local\(/i);
    assert.match(read(`${dir}/styles.css`), /--font-brand:"GA Lexend"/);
    assert.equal(existsSync(path.join(root, dir, 'assets/fonts/azonix-wordmark.woff2')), false);
  });

  test(`${dir}: each bundled font has its upstream OFL notice`, () => {
    for (const name of ['Lexend', 'NotoSans', 'JetBrainsMono']) {
      const license = read(`${dir}/assets/fonts/OFL-${name}.txt`);
      assert.match(license, /Copyright/);
      assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    }
  });
}

test('public and legacy font assets stay identical', () => {
  const publicDir = path.join(root, 'public/assets/fonts');
  const staticDir = path.join(root, 'static/assets/fonts');
  assert.deepEqual(readdirSync(publicDir).sort(), readdirSync(staticDir).sort());
  for (const name of readdirSync(publicDir)) {
    assert.deepEqual(readFileSync(path.join(publicDir, name)), readFileSync(path.join(staticDir, name)), name);
  }
});
