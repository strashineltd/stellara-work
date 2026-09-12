import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'icon-source.png');

const MASTER = 1024;

// ---- macOS：白色圆角底板 + 柔和投影 + 居中 logo（透明外角）----
const TILE = Math.round(MASTER * 0.82);
const INSET = Math.round((MASTER - TILE) / 2);
const RADIUS = Math.round(TILE * 0.2237);
const LOGO_HEIGHT = Math.round(TILE * 0.62);

const macBackground = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER}" height="${MASTER}">` +
    `<defs>` +
    `<filter id="tile-shadow" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.24"/>` +
    `</filter>` +
    `</defs>` +
    `<rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="#FFFFFF" filter="url(#tile-shadow)"/>` +
    `</svg>`,
);

const macLogo = await sharp(src).trim().resize({ height: LOGO_HEIGHT }).png().toBuffer();
const macMaster = await sharp(macBackground)
  .composite([{ input: macLogo, gravity: 'center' }])
  .png()
  .toBuffer();

const sizes = [16, 32, 48, 64, 128, 256, 512];
for (const size of sizes) {
  const pngBuf = await sharp(macMaster).resize(size, size).png().toBuffer();
  writeFileSync(path.join(__dirname, `icon-${size}.png`), pngBuf);
  console.log(`  OK: icon-${size}.png`);
}

// Extra: 256x256 alias
writeFileSync(path.join(__dirname, 'icon-256.png'), await sharp(macMaster).resize(256, 256).png().toBuffer());
console.log('  OK: icon-256.png (alias)');

// ---- Windows：仅 logo，透明底，无圆角底板 ----
const winLogo = await sharp(src).trim().resize({ height: Math.round(MASTER * 0.88) }).png().toBuffer();
const winMaster = await sharp({
  create: { width: MASTER, height: MASTER, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: winLogo, gravity: 'center' }])
  .png()
  .toBuffer();
writeFileSync(path.join(__dirname, 'icon-win.png'), winMaster);
console.log('  OK: icon-win.png');

// Generate .ico (from sizes up to 256)
const winPngs = [];
for (const size of [16, 32, 48, 64, 128, 256]) {
  winPngs.push(await sharp(winMaster).resize(size, size).png().toBuffer());
}
const icoBuf = await pngToIco(winPngs);
writeFileSync(path.join(__dirname, 'icon.ico'), icoBuf);
console.log('  OK: icon.ico');

console.log('>> Done!');
