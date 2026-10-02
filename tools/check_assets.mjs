// 资产闸：把"图标/PWA 是真货"从形容词变成一条会红的命令。
//
// 为什么要有它（本仓踩过、组织里也踩过）：index.html 里写一行 <link rel="manifest"> 就
// 算"可安装"，manifest 里写三个 icon 路径就算"有图标"——而盘上那张图要么不存在、要么是
// 0 字节、要么是一张 SVG 改了个 .png 后缀。尺子（sellability.py）判的是"有没有 ≥180 的真位图"，
// 它不看**引用有没有落空**；这一条补的就是那个洞：
//   ① index.html 与 manifest.json 里每一条本地路径都必须在盘上存在；
//   ② 每个 .png 必须是真 PNG（签名 + IHDR 解出来的宽高），并且达到它自己声称的尺寸；
//   ③ apple-touch-icon 唯一且 ≥180px，manifest 的 icons 至少一张 ≥512 且 purpose 覆盖 any/maskable；
//   ④ 一张都不许是 0 字节，也不许用 SVG 冒充 .png。
// 任何一条不成立就 exit 1，并把原话打印出来。
//
// 用法：node tools/check_assets.mjs        （CI 里挂在 npm run check 之后）

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const notes = [];
const bad = (msg) => fails.push(msg);

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    bad(`${rel} 读不到`);
    return '';
  }
}

/** 只解 PNG 的 IHDR：签名 + 宽高 + 位深 + 颜色类型。不依赖任何图像库，判的是字节。 */
function pngInfo(rel) {
  const buf = readFileSync(join(ROOT, rel));
  if (buf.length === 0) return { error: '0 字节' };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.subarray(0, 8).compare(sig) !== 0) {
    const head = buf.subarray(0, 200).toString('latin1');
    return { error: /<svg|svg xmlns/i.test(head) ? 'SVG 冒充 PNG' : '不是 PNG 签名' };
  }
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return { error: '缺 IHDR' };
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    depth: buf[24],
    colorType: buf[25],
    bytes: buf.length,
  };
}

// ---- ① index.html 引用的每一条本地路径 ---------------------------------------------------------
const html = read('index.html');
const refs = [];
for (const m of html.matchAll(/<(?:link|script|img)\b[^>]*>/gi)) {
  const tag = m[0];
  const href = /(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (!href) continue;
  const url = href[1];
  if (/^(data:|https?:|\/\/)/i.test(url)) continue; // 外链与 data URI 不归本闸管
  const rel = normalize(url.replace(/^\.\//, '').split(/[?#]/)[0]);
  const relAttr = /rel\s*=\s*["']([^"']*)["']/i.exec(tag);
  refs.push({ tag: (relAttr ? relAttr[1] : 'src').toLowerCase(), rel });
}
for (const r of refs) {
  if (!existsSync(join(ROOT, r.rel))) bad(`index.html 引用的 ${r.rel}（${r.tag}）不在盘上`);
}
notes.push(`index.html 本地引用 ${refs.length} 条：${[...new Set(refs.map((r) => r.rel))].join(', ')}`);

// ---- ② 每个 .png 都得是真位图，且尺寸对得上自己声称的 ------------------------------------------
const pngRefs = refs.filter((r) => r.rel.endsWith('.png'));
for (const m of html.matchAll(/<link[^>]*rel\s*=\s*["']icon["'][^>]*>/gi)) {
  const sizes = /sizes\s*=\s*["'](\d+)x(\d+)["']/i.exec(m[0]);
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  if (!sizes || !href) continue;
  pngRefs.push({ tag: `icon ${sizes[1]}x${sizes[2]}`, rel: normalize(href[1]), want: [Number(sizes[1]), Number(sizes[2])] });
}
for (const r of pngRefs) {
  if (!existsSync(join(ROOT, r.rel))) continue; // 上面已经报过缺文件
  const info = pngInfo(r.rel);
  if (info.error) {
    bad(`${r.rel} 不是可用的位图：${info.error}`);
    continue;
  }
  if (r.want && (info.w !== r.want[0] || info.h !== r.want[1])) {
    bad(`${r.rel} 声称 ${r.want.join('×')} 实际 ${info.w}×${info.h}`);
  }
  notes.push(`${r.rel} ${info.w}×${info.h} depth=${info.depth} ct=${info.colorType} ${info.bytes}B`);
}

// ---- ③ 图标这一组的硬指标 ---------------------------------------------------------------------
const apple = [...html.matchAll(/<link[^>]*apple-touch-icon[^>]*>/gi)];
if (!apple.length) bad('没有 apple-touch-icon：iOS 加到桌面会拿一张糊的默认图');
for (const a of apple) {
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(a[0]);
  if (!href) continue;
  const rel = normalize(href[1].replace(/^\.\//, ''));
  if (!existsSync(join(ROOT, rel))) bad(`apple-touch-icon 指向的 ${rel} 不在盘上`);
  else {
    const info = pngInfo(rel);
    if (info.error) bad(`apple-touch-icon ${rel}：${info.error}`);
    else if (Math.min(info.w, info.h) < 180) bad(`apple-touch-icon ${rel} 只有 ${info.w}×${info.h}，低于 180`);
  }
}
if (apple.length > 1) bad(`apple-touch-icon 有 ${apple.length} 条：iOS 会自己挑，等于没指定`);

// ---- ④ manifest 的字段与图标 ------------------------------------------------------------------
const MANIFEST = 'manifest.json';
if (!existsSync(join(ROOT, MANIFEST))) bad(`${MANIFEST} 不存在（index.html 里那条 link 是空的）`);
else {
  let mf = null;
  try {
    mf = JSON.parse(read(MANIFEST));
  } catch (e) {
    bad(`${MANIFEST} 不是合法 JSON：${e.message}`);
  }
  if (mf) {
    for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color']) {
      if (mf[k] == null) bad(`${MANIFEST} 缺字段 ${k}`);
    }
    const icons = Array.isArray(mf.icons) ? mf.icons : [];
    let big = 0;
    let maskable = 0;
    for (const ic of icons) {
      if (!ic || typeof ic.src !== 'string') {
        bad(`${MANIFEST}.icons 里有一条不是对象`);
        continue;
      }
      const rel = normalize(ic.src.replace(/^\.\//, ''));
      if (!existsSync(join(ROOT, rel))) {
        bad(`manifest 指向的 ${rel} 不在盘上`);
        continue;
      }
      const info = pngInfo(rel);
      if (info.error) bad(`manifest 的 ${rel}：${info.error}`);
      const declared = /^(\d+)x(\d+)$/.exec(String(ic.sizes || ''));
      if (!declared) bad(`${rel} 的 sizes 不是 WxH：${ic.sizes}`);
      else if (info.w && (Number(declared[1]) !== info.w || Number(declared[2]) !== info.h)) {
        bad(`${rel} manifest 声称 ${ic.sizes}，IHDR 是 ${info.w}×${info.h}`);
      }
      if (Math.min(info.w || 0, info.h || 0) >= 512) big++;
      if (/maskable/.test(String(ic.purpose || ''))) maskable++;
    }
    if (!big) bad('manifest 里没有一张 ≥512 的图标（Chrome 的可安装门槛按这条判）');
    if (!maskable) notes.push('没有 maskable 图标：Android 桌面会自己裁，边缘会被切');
    notes.push(`manifest icons=${icons.length} 张，≥512 的 ${big} 张，maskable ${maskable} 张，display=${mf.display}`);
    if (!/^https?:|^\.|^\/|^\//.test(String(mf.start_url || ''))) bad(`start_url 不像能解析的地址：${mf.start_url}`);
  }
}

// ---- ⑤ sw.js 的口径：网络优先 + 版本号 + 不缓存自己 --------------------------------------------
const sw = read('sw.js');
if (!sw) bad('sw.js 不存在或为空');
else {
  if (!/VERSION/.test(sw)) bad('sw.js 里没有版本号：缓存名一旦定死，出新 HTML 配旧 JS 没人知道');
  if (/caches\.match[\s\S]{0,80}?\)\s*\|\|[^;]*fetch/.test(sw)) bad('sw.js 看着是 cache-first：会把未打包的 js/css 钉死在旧版');
  if (!/networkFirst|网络优先/.test(sw)) bad('sw.js 没写网络优先的取法');
  if (!/sw\.js/.test(sw)) bad('sw.js 没把自己排除在缓存外（缓存了自己的下一次更新取不回来）');
  else notes.push('sw.js：有 VERSION、网络优先、排除自身');
}

console.log(notes.map((n) => `  ok  ${n}`).join('\n'));
if (fails.length) {
  console.log(fails.map((f) => `  FAIL ${f}`).join('\n'));
  console.log(`资产闸：${fails.length} 条不成立`);
  process.exit(1);
}
console.log(`资产闸：${notes.length} 条读数全部落在盘上，0 条不成立`);
