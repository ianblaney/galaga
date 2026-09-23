import { createServer } from 'vite';
const { chromium } = await import('playwright');
const server = await createServer({ root: '/Users/ianblaney/projects/galaga', server: { port: 0, open: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(url);
await page.waitForFunction(() => window.game && window.game.keys);
await page.keyboard.press('Space');
await page.waitForTimeout(4000);

const probe = () => page.evaluate(() => {
  const v = window.view3d;
  return {
    chase: v.chase,
    panelLight: { visible: v.panelLight.visible, intensity: v.panelLight.intensity,
                  pos: v.panelLight.position.toArray(),
                  worldPos: v.panelLight.getWorldPosition(new window.THREE_V3()).toArray() },
    shipKey: { visible: v.shipKey.visible },
    eyeRig: v.eyeRig.position.toArray(),
    fov: v.camera.fov,
    toneExposure: v.renderer.toneMappingExposure,
  };
});
// Expose a Vector3 ctor for the probe.
await page.evaluate(() => { window.THREE_V3 = window.view3d.eye.constructor; });

console.log('before V:', JSON.stringify(await probe()));
await page.keyboard.press('KeyV');
await page.waitForTimeout(500);
console.log('in chase:', JSON.stringify(await probe()));
await page.keyboard.press('KeyV');
await page.waitForTimeout(500);
console.log('after  V:', JSON.stringify(await probe()));

await browser.close();
await server.close();
