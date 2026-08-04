// Pixel-art sprites. Each sprite is a list of equal-length rows; every
// character is one arcade pixel, looked up in the sprite's own palette.
// '.' is transparent. Sprites are baked into offscreen canvases once at load.

export const W = 224;
export const H = 288;

const PAL = {
  W: '#ffffff', // white
  R: '#e02020', // red
  Y: '#f4d03f', // yellow
  B: '#3060d0', // blue
  G: '#38b24a', // green
  P: '#c040c0', // purple
  C: '#40d0e0', // cyan
  K: '#000000',
};

function bake(rows, scale = 1) {
  const w = rows[0].length;
  const h = rows.length;
  const cv = document.createElement('canvas');
  cv.width = w * scale;
  cv.height = h * scale;
  const c = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      c.fillStyle = PAL[ch] || '#ff00ff';
      c.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cv;
}

// Re-colour a baked sprite (used for the captured fighter and flash effects).
function tint(src, colour) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const c = cv.getContext('2d');
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = colour;
  c.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

const FIGHTER = [
  '......W......',
  '......W......',
  '.....WWW.....',
  '.....WWW.....',
  '....WWWWW....',
  '.R..WWWWW..R.',
  'RR..WWWWW..RR',
  'RRR.WWWWW.RRR',
  'RRRRWWWWWRRRR',
  'RRRRWWWWWRRRR',
  'RRRRW.W.WRRRR',
  'RR.R.....R.RR',
  'R...W...W...R',
];

const BEE = [
  '.....BBB.....',
  '....BBBBB....',
  '.YY.BWBWB.YY.',
  'YYYYBBBBBYYYY',
  'YYYYYBBBYYYYY',
  'YYYY.BBB.YYYY',
  '.YY..BBB..YY.',
  '..Y..B.B..Y..',
  '.....B.B.....',
  '....Y...Y....',
  '...Y.....Y...',
];

const BUTTERFLY = [
  '.....RRR.....',
  '....RRRRR....',
  '.WW.RWBWR.WW.',
  'WWWWRRRRRWWWW',
  'WWWWWRRRWWWWW',
  'RRRR.RRR.RRRR',
  '.RRR.RRR.RRR.',
  '..RR.R.R.RR..',
  '.....R.R.....',
  '....R...R....',
  '...R.....R...',
];

const BOSS = [
  '...GGGGGGGGG...',
  '..GGGGGGGGGGG..',
  '.GG.GGGGGGG.GG.',
  'PP.GGWGGGWGG.PP',
  'PPP.GGGGGGG.PPP',
  'PPPPPBBBBBPPPPP',
  'PPPPPBBBBBPPPPP',
  '.PPP.BBBBB.PPP.',
  '..P..BB.BB..P..',
  '.....B...B.....',
  '....B.....B....',
];

// A boss survives its first hit; the green shell turns blue to show the damage.
const BOSS_HIT = BOSS.map((r) => r.replace(/G/g, 'B'));

export const SPR = {
  fighter: bake(FIGHTER),
  bee: bake(BEE),
  butterfly: bake(BUTTERFLY),
  boss: bake(BOSS),
  bossHit: bake(BOSS_HIT),
};

SPR.captive = tint(SPR.fighter, '#c040c0');

// ---------------------------------------------------------------------------
// Text: a compact 5x7 font, enough for the arcade UI.

const GLYPHS = {
  A: '01110|10001|10001|11111|10001|10001|10001',
  B: '11110|10001|11110|10001|10001|10001|11110',
  C: '01110|10001|10000|10000|10000|10001|01110',
  D: '11110|10001|10001|10001|10001|10001|11110',
  E: '11111|10000|11110|10000|10000|10000|11111',
  F: '11111|10000|11110|10000|10000|10000|10000',
  G: '01110|10001|10000|10111|10001|10001|01111',
  H: '10001|10001|10001|11111|10001|10001|10001',
  I: '11111|00100|00100|00100|00100|00100|11111',
  J: '00111|00010|00010|00010|00010|10010|01100',
  K: '10001|10010|10100|11000|10100|10010|10001',
  L: '10000|10000|10000|10000|10000|10000|11111',
  M: '10001|11011|10101|10101|10001|10001|10001',
  N: '10001|11001|10101|10011|10001|10001|10001',
  O: '01110|10001|10001|10001|10001|10001|01110',
  P: '11110|10001|10001|11110|10000|10000|10000',
  Q: '01110|10001|10001|10001|10101|10010|01101',
  R: '11110|10001|10001|11110|10100|10010|10001',
  S: '01111|10000|10000|01110|00001|00001|11110',
  T: '11111|00100|00100|00100|00100|00100|00100',
  U: '10001|10001|10001|10001|10001|10001|01110',
  V: '10001|10001|10001|10001|10001|01010|00100',
  W: '10001|10001|10001|10101|10101|11011|10001',
  X: '10001|10001|01010|00100|01010|10001|10001',
  Y: '10001|10001|01010|00100|00100|00100|00100',
  Z: '11111|00001|00010|00100|01000|10000|11111',
  0: '01110|10001|10011|10101|11001|10001|01110',
  1: '00100|01100|00100|00100|00100|00100|01110',
  2: '01110|10001|00001|00110|01000|10000|11111',
  3: '11111|00010|00100|00010|00001|10001|01110',
  4: '00010|00110|01010|10010|11111|00010|00010',
  5: '11111|10000|11110|00001|00001|10001|01110',
  6: '00110|01000|10000|11110|10001|10001|01110',
  7: '11111|00001|00010|00100|01000|01000|01000',
  8: '01110|10001|10001|01110|10001|10001|01110',
  9: '01110|10001|10001|01111|00001|00010|01100',
  '-': '00000|00000|00000|11111|00000|00000|00000',
  '!': '00100|00100|00100|00100|00100|00000|00100',
  '/': '00001|00010|00010|00100|01000|01000|10000',
  ':': '00000|00100|00000|00000|00000|00100|00000',
  '.': '00000|00000|00000|00000|00000|00000|00100',
  ' ': '00000|00000|00000|00000|00000|00000|00000',
};

const FONT_W = 5;
const FONT_H = 7;

/** Draw `text` with its top-left at (x, y). `align` may be 'left' or 'center'. */
export function drawText(ctx, text, x, y, colour = '#ffffff', align = 'left') {
  const s = String(text).toUpperCase();
  const width = s.length * (FONT_W + 1) - 1;
  let px = align === 'center' ? Math.round(x - width / 2) : Math.round(x);
  ctx.fillStyle = colour;
  for (const ch of s) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      const rows = glyph.split('|');
      for (let ry = 0; ry < FONT_H; ry++) {
        for (let rx = 0; rx < FONT_W; rx++) {
          if (rows[ry][rx] === '1') ctx.fillRect(px + rx, y + ry, 1, 1);
        }
      }
    }
    px += FONT_W + 1;
  }
  return width;
}

export function textWidth(text) {
  return String(text).length * (FONT_W + 1) - 1;
}
