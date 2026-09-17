import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 16×16 网格上的日历轮廓（矩形 + 装订线 + 两个挂环）。
 * 纯 SVG 绘制，无外部素材、无网络，保证可重复生成。
 */
function calendarGlyph(size, { stroke, strokeWidth = 1.4, background = null }) {
  const bg = background
    ? `<rect x="0.6" y="0.6" width="14.8" height="14.8" rx="3.4" fill="${background}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">` +
    bg +
    `<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="2.4" y="3.6" width="11.2" height="10.4" rx="2.4"/>` +
    `<path d="M2.4 6.9h11.2"/>` +
    `<path d="M5.4 1.9v2.6M10.6 1.9v2.6"/>` +
    `</g>` +
    `</svg>`
  );
}

/** macOS 模板图（16pt/@2x）：纯黑 + alpha，由系统按菜单栏深浅色自动反色 */
const TEMPLATE = { stroke: '#000000', strokeWidth: 1.4 };
/** Windows/Linux：彩色图标，保证在深/浅任务栏上均可见 */
const COLORED = { background: '#2F6FED', stroke: '#FFFFFF', strokeWidth: 1.4 };

const OUTPUTS = [
  { file: 'trayTemplate.png', size: 16, options: TEMPLATE },
  { file: 'trayTemplate@2x.png', size: 32, options: TEMPLATE },
  { file: 'tray.png', size: 32, options: COLORED },
];

for (const { file, size, options } of OUTPUTS) {
  const png = await sharp(Buffer.from(calendarGlyph(size, options)))
    .png()
    .toBuffer();
  writeFileSync(path.join(__dirname, file), png);
  console.log(`  OK: ${file} (${size}x${size}, ${png.length} bytes)`);
}

console.log('>> Done!');
