import { chromium } from 'playwright';
const files = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
for (const f of files) {
  const v = await p.evaluate(async (src) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const mean = (x, y, w, h) => {
      const d = g.getImageData(x, y, w, h).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return +(s / (d.length / 4)).toFixed(1);
    };
    return {
      size: [img.width, img.height],
      tac: mean(270, 590, 110, 150),      // left MFD
      sys: mean(515, 590, 105, 120),      // right MFD
      panel: mean(200, 700, 500, 120),    // bare panel
      coaming: mean(200, 556, 500, 10),   // coaming trim
    };
  }, 'data:image/png;base64,' + (await import('node:fs')).readFileSync(f).toString('base64'));
  console.log(f.split('/').pop().padEnd(24), JSON.stringify(v));
}
await b.close();
