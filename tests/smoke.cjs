const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Playwright is required: npm install --no-save playwright');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

async function boot(page, map) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:8018/four-zero-two-v79.html${map === 'midtown' ? '?map=midtown' : ''}`, {
    waitUntil: 'load',
    timeout: 60_000
  });
  await page.waitForFunction(() => typeof FE !== 'undefined' && typeof Jet !== 'undefined', null, { timeout: 90_000 });
  const state = await page.evaluate(() => ({
    map: MAP,
    revision: THREE.REVISION,
    canvas: Boolean(document.querySelector('canvas')),
    models: Object.keys(ASSET.models || {}).length,
    build: document.querySelector('#fe .frame .fl.br').textContent
  }));
  assert.equal(state.map, map);
  assert.equal(state.revision, '128');
  assert.equal(state.canvas, true);
  assert.ok(state.models > 0);
  assert.match(state.build, /BUILD 79/);
  assert.deepEqual(errors, []);
  return errors;
}

(async () => {
  await new Promise(resolve => server.listen(8018, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = await boot(page, 'downtown');
    const gameplay = await page.evaluate(() => {
      FE.hide();
      startGame();
      freeLook = true;
      freePaused = false;
      for (let i = 0; i < 60; i++) update(1 / 60);

      const roof = ROOFS.find(item => Number.isFinite(item.y) && item.y > 3);
      const x = (roof.minX + roof.maxX) / 2;
      const z = (roof.minZ + roof.maxZ) / 2;
      const expectedY = roof.y + EYE;
      camera.position.set(x, expectedY, z);
      Jet.restore(47);
      const saved = snapshot();
      camera.position.set(SPAWN.x, EYE + groundY(SPAWN.x, SPAWN.z), SPAWN.z);
      Jet.reset();
      applySave(saved);
      const restored = { y: camera.position.y, fuel: Jet.fuel };

      camera.position.y += 5;
      onGround = false;
      keys.Space = true;
      for (let i = 0; i < 45; i++) update(1 / 60);
      keys.Space = false;
      const activeBeforePause = Jet.active;
      FE.pause();

      return {
        elapsed,
        position: camera.position.toArray(),
        expectedY,
        restored,
        activeBeforePause,
        activeAfterPause: Jet.active
      };
    });
    assert.ok(gameplay.elapsed > 0);
    assert.ok(gameplay.position.every(Number.isFinite));
    assert.ok(Math.abs(gameplay.restored.y - gameplay.expectedY) < 0.01);
    assert.equal(gameplay.restored.fuel, 47);
    assert.equal(gameplay.activeBeforePause, true);
    assert.equal(gameplay.activeAfterPause, false);
    assert.deepEqual(errors, []);

    const chosenSave = { marker: 'selected-slot', map: 'midtown', t: 1, x: 2, y: 3, z: 4 };
    await page.evaluate(save => transferSave(save), chosenSave);
    await boot(page, 'midtown');
    const transferred = await page.evaluate(() => takeTransferredSave());
    assert.deepEqual(transferred, chosenSave);

    const launcher = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const launcherErrors = [];
    launcher.on('pageerror', error => launcherErrors.push(error.message));
    await launcher.route('https://**/*', route => route.abort());
    await launcher.goto('http://127.0.0.1:8018/', { waitUntil: 'load', timeout: 60_000 });
    const gameFrame = launcher.frames().find(frame => frame.url().includes('four-zero-two-v79.html'));
    assert.ok(gameFrame, 'launcher should embed build 79');
    await gameFrame.waitForFunction(() => typeof FE !== 'undefined', null, { timeout: 90_000 });
    assert.deepEqual(launcherErrors, []);

    console.log('v79 smoke checks passed: downtown, Midtown, saves, jetpack shutdown, and launcher.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
