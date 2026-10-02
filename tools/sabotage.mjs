// 破坏试验台账：把「文档可能抄的是一个已经不存在的数」这件事，一类谎一类谎地塞回代码里，
// 证明 tools/doctest.mjs 真的会红，而且红的就是文档点名的那一条断言 —— 不是随便一条别的红。
//
// 为什么要这道闸：doctest 是绿的，但「绿」有两种：一种是被断言真的守住了，一种是解析器集体扑空
// （正则改了形状、锚点被删空、balance 没跑起来）。前者绿是成绩，后者绿是假账。唯一的分辨办法是
// 主动把代码改坏，看这道闸是不是立刻变红并且报出对应的那一条。这里就把每一类谎固化成一把刀。
//
// 五条规矩：
//   1. 每把刀改一个真实的代码文件（不是改文档），当场跑 node tools/doctest.mjs，读回真实 rc；
//   2. rc 必须 != 0，而且日志里必须出现「文档点名的那条断言」的 FAIL 行 —— 只红在别处不算逼到；
//   3. 复原只用内存里读回来的原始字节 writeFileSync，绝不借 git 命令复原；复原后再读回逐字节比对；
//   4. 台账的 rc 一格是「从脚本读回来的真实读数」，第一版没跑过的用 '?'，跑成功后自钉成数字；
//      自钉必须是幂等的：干净树上重跑，刀数与 rc 都不变，闸依旧是绿的；
//   5. 最后跑一遍「对照」：不带任何破坏的 doctest + engine-test 必须都是绿的，证明台账不是靠
//      把闸改坏来让自己变绿。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => join(ROOT, rel);

// 四把刀，各打 doctest 的一个不同组：D1 档位 band、D2 铅笔规则权重、D7 端口默认号、D8 侧栏读数。
// 全部是纯逻辑的常量改动 —— 不动浏览器、不动端口，因此这把刀在任何机器上都一样快、一样准。
const KNIVES = [
  {
    id: 'K1', group: 'D1', file: 'js/engine/generate.js',
    from: '    band: [34, 43],', to: '    band: [34, 42],',
    breaks: '把「初学」档的 band 上限从 43 改成 42（文档难度表写的是 34–43）',
    // doctest 里那条断言的标签会打「D1 初学 的 band 34–43 == TIERS 现值」，红就红在这句
    assert: /^.*FAIL .*D1 初学 的 band .* == TIERS 现值.*$/m,
    rc: '1',
  },
  {
    id: 'K2', group: 'D2', file: 'js/engine/nurikabe.js',
    from: '    weight: 3,', to: '    weight: 2,',
    breaks: '把第 7 条规则 bridge 的权重从 3 改成 2（文档规则表写的是 5 / 3）',
    assert: /^.*FAIL .*D2 bridge 的层级\/权重 .* == Rules 现值.*$/m,
    rc: '1',
  },
  {
    id: 'K3', group: 'D7', file: 'tools/verify.sh',
    from: 'HTTP_WANT=${HTTP_PORT:-5311}', to: 'HTTP_WANT=${HTTP_PORT:-5312}',
    breaks: '把 verify.sh 的 HTTP 默认端口从 5311 改成 5312（与 package.json dev / 文档不同源）',
    assert: /^.*FAIL .*D7 HTTP 默认号两处一致.*$/m,
    rc: '1',
  },
  {
    id: 'K4', group: 'D8', file: 'index.html',
    from: 'class="stat"><span>步数', to: 'class="stat-x"><span>步数',
    breaks: '把侧栏第一个读数单元的 class 改掉（文档明写「侧栏八个读数」，页面只剩七个 stat）',
    assert: /^.*FAIL .*D8a index\.html 解析到 .* 个 stat 单元.*$/m,
    rc: '1',
  },
];

const runGate = () => {
  const r = spawnSync('node', ['tools/doctest.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const runEngine = () => {
  const r = spawnSync('node', ['tools/engine-test.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const problems = [];
const ledger = [];

// 先立「干净树」这个前提：每把刀的 from 必须在、to 必须在（改坏过的话 to 也命中不了原始态），
// 而且 to 不能已经存在于文件里 —— 若已在，说明上一次没复原干净，直接判红不往下动。
for (const k of KNIVES) {
  if (!existsSync(p(k.file))) { problems.push(`${k.id}: 目标文件不存在 ${k.file}`); continue; }
  const src = readFileSync(p(k.file), 'utf8');
  const nFrom = src.split(k.from).length - 1;
  if (nFrom !== 1) problems.push(`${k.id}: ${k.file} 里 from 命中 ${nFrom} 次（必须恰好 1 次才敢改）`);
}
if (problems.length) { for (const x of problems) console.log(`  前置不干净：${x}`); process.exit(1); }

for (const k of KNIVES) {
  const original = readFileSync(p(k.file), 'utf8'); // 原始字节进内存，复原只认这份
  const sabotaged = original.replace(k.from, k.to);
  if (sabotaged === original) { problems.push(`${k.id}: 替换没生效（from 与 to 相同？）`); continue; }
  writeFileSync(p(k.file), sabotaged, 'utf8');
  let gate;
  try {
    gate = runGate();
  } finally {
    // 无论闸跑成什么、有没有抛，都必须用内存里的原始字节写回去
    writeFileSync(p(k.file), original, 'utf8');
  }
  const back = readFileSync(p(k.file), 'utf8');
  const restored = back === original; // 复原后逐字节回读校验
  const tripped = gate.rc !== 0 && k.assert.test(gate.out);
  const named = (gate.out.match(k.assert) || ['(日志里没有点名的那条 FAIL)'])[0].trim();
  k.rc = String(gate.rc);
  ledger.push({ id: k.id, group: k.group, breaks: k.breaks, rc: gate.rc, tripped, restored, named });
  console.log(`  [${tripped ? '逼红' : '未逼红'}] ${k.id} → ${k.group} · 破坏「${k.breaks}」 · doctest rc=${gate.rc}`);
  console.log(`      点名的断言：${named}`);
  if (!restored) problems.push(`${k.id}: 复原后逐字节不一致（还原没做到）`);
  if (gate.rc === 0) problems.push(`${k.id}: 塞了这类谎 doctest 却还是 rc=0 —— 这一类谎没人守`);
  else if (!k.assert.test(gate.out)) problems.push(`${k.id}: doctest 红了但不是红在点名的那条（${k.group}）`);
}

// 自钉：把读回来的真实 rc 写进本文件的台账（幂等 —— 同样的刀只会得到同样的 rc）。
// 必须在对照跑之前落盘：doctest 的 D16c 会读这个文件，rc 若还是 '?' 对照就红。
const selfPath = fileURLToPath(import.meta.url);
const selfSrc = readFileSync(selfPath, 'utf8');
let stamped = selfSrc;
for (const k of KNIVES) {
  const re = new RegExp(`(id: '${k.id}'[\\s\\S]*?rc: ')[^']*(')`);
  if (!re.test(stamped)) { problems.push(`自钉：找不到 ${k.id} 的 rc 槽`); continue; }
  stamped = stamped.replace(re, `$1${k.rc}$2`);
}
if (stamped !== selfSrc) writeFileSync(selfPath, stamped, 'utf8'); // 幂等：干净重跑时这里 no-op

// 对照跑：不带任何破坏，doctest 与 engine-test 都必须绿 —— 证明台账不是靠改坏闸来绿。
const ctl = runGate();
const eng = runEngine();
console.log(`\n对照（干净树）：doctest rc=${ctl.rc} · engine-test rc=${eng.rc}`);
if (ctl.rc !== 0) { console.log(ctl.out.split('\n').filter(l => l.includes('FAIL')).slice(0, 20).join('\n')); }

console.log('\n== 破坏试验台账（rc 均为本次从脚本读回的真实读数）==');
console.log('| 刀 | 打哪组 | 破坏 | 逼到的断言 | 真实 rc |');
console.log('|---|---|---|---|---|');
for (const r of ledger) console.log(`| ${r.id} | ${r.group} | ${r.breaks} | ${r.named.slice(0, 46)} | ${r.rc} |`);

if (problems.length) { console.log('\n台账不绿：'); for (const x of problems) console.log(`  - ${x}`); process.exit(1); }
if (ctl.rc !== 0 || eng.rc !== 0) { console.log('对照不绿：闸在干净树上是红的'); process.exit(1); }
console.log(`\n台账全绿：${ledger.length} 把刀各自逼红了点名的断言，复原逐字节一致，干净树对照 doctest+engine-test 双绿。`);
process.exit(0);
