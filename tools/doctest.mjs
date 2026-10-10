// 文档是被断言的面：README / DESIGN 里印出去的每一个「现值」都必须等于代码或闸的现在值。
//
// 为什么要有这个文件：上一轮交付里 438/755/5019/p50=37.5/七条规则 1/1.5/2/…/band [34,43] 这类
// 数字被写进文档，靠人眼对表。引擎断言由 tools/engine-test.mjs 复测、band 由 tools/balance.mjs 复测、
// 浏览器读数由 tools/scenarios.js 复测 —— 只有"文档抄的数 == 代码或闸的现值"这一条没有命令守着。
// 散文可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。
//
// 五条规矩（照 z-biz-game-kurotto-cos/tools/doctest.mjs 的机制走，不自创一套）：
//   1. 每一条等式都配一条「解析到几行」的反空转断言 —— 正则没命中不是绿，是红；
//   2. 只比现值，不复测读数：ms/秒这类本机墙钟量在这里只以「文档自己写明这一列会漂」的关系出现（D14），
//      绝不重新计时，也绝不把新测的毫秒写回文档；能逐位复现的结构数字（p50、拒收数、断言数、阈值、
//      档位、权重、深度、步数=格数）才在这里比数值 —— 而且用**仓自己的工具**（balance / engine-test）
//      现场跑一遍再对表，不是拿文档当基准；
//   3. 文档改形状（表格列、句子措辞、引用格式）不算通过的理由：解析不到就是红；
//   4. 引用 `file:NN` 的每一条都跑一次范围与锚点检查 —— 只要代码改一个字，行号就漂；
//   5. 本闸自己发出的组数与项数都自钉 —— 加一项、删一项都得同时改这里的钉，否则红。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS } from '../js/engine/generate.js';
import { Rules, RULE_ORDER } from '../js/engine/nurikabe.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const emitted = new Set();
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  const m = label.match(/^D\d+/);
  if (!m) throw new Error(`断言标签必须以 D<N> 开头：${label}`);
  emitted.add(m[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const TIER_NAMES = ['初学', '熟手', '常规', '高手', '大师'];

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const BAL_SRC = read('tools/balance.mjs');
const ENG_SRC = read('tools/engine-test.mjs');
const SCEN = read('tools/scenarios.js');
const GEN_SRC = read('js/engine/generate.js');
const NURI_SRC = read('js/engine/nurikabe.js');
const COUNT_SRC = read('js/engine/count.js');
const STORE_SRC = read('js/store.js');
const RNG_SRC = read('js/engine/rng.js');
const MAIN_SRC = read('js/main.js');
const GAME_SRC = read('js/ui/game.js');
const HTML = read('index.html');

const run = (cmd, env, ms) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 本闸用**仓自己的工具**做现值来源 —— balance 与 engine-test 都是逻辑跑，秒级，不开浏览器
const BAL = run('node tools/balance.mjs', { SAMPLES: '24' }, 120000);
const ENG = run('node tools/engine-test.mjs', {}, 60000);

// ---- D1 档位：README 难度表解析到 5 行，档名/尺寸/band 逐格等于 TIERS 现值 ----
const tierRows = [...README.matchAll(/^\| (初学|熟手|常规|高手|大师) \| (\d+)×\d+ \| (\d+)–(\d+) \|/gm)];
ok(tierRows.length === TIERS.length, `D1a README 难度表解析到 ${TIERS.length} 行（解析不到不等于通过）`,
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档`);
for (const t of TIERS) {
  const row = tierRows.find(m => m[1] === t.name);
  ok(!!row, `D1 ${t.name} 那一行在文档的档位表里`, row ? `| ${row[1]} | ${row[2]}×… |` : '文档里没有这一档');
  if (!row) continue;
  ok(+row[2] === t.w, `D1b ${t.name} 的边长 ${t.w}×${t.h} == TIERS 现值`, `文档 ${row[2]}×? vs 代码 ${t.w}×${t.h}`);
  ok(+row[3] === t.band[0] && +row[4] === t.band[1], `D1 ${t.name} 的 band ${t.band[0]}–${t.band[1]} == TIERS 现值（页面「实测 X–Y 分」同源）`,
    `文档 ${row[3]}–${row[4]} vs 代码 [${t.band}]`);
}
// DESIGN §10 那句 "`TIERS` 是 `js/engine/generate.js:35-91`" 也走一次锚点
const tiersAt = (DESIGN.match(/TIERS` 是 `js\/engine\/generate\.js:(\d+)-(\d+)`/) || []).slice(1).map(Number);
ok(tiersAt.length === 2 && TIERS.length === 5 && GEN_SRC.split('\n')[tiersAt[0] - 1].includes('export const TIERS')
  && GEN_SRC.split('\n').slice(tiersAt[0] - 1, tiersAt[1] + 1).join('\n').includes('band: [139, 161]'),
  `D1c DESIGN 那句「TIERS 是 generate.js:${tiersAt.join('–') || '解析不到'}」真的坐在 TIERS 的整段上`,
  `第一行：${GEN_SRC.split('\n')[(tiersAt[0] || 1) - 1].slice(0, 44)}…`);

// ---- D2 七条铅笔规则：README 那张规则表 == Rules / RULE_ORDER 现值 ----
const ruleRows = [...README.matchAll(/^\| [①②③④⑤⑥⑦] \| `(\w+)` \| ([^|]+?) \| (\d+) \/ ([\d.]+) \|/gm)];
ok(ruleRows.length === RULE_ORDER.length, `D2a README 的规则表解析到 ${RULE_ORDER.length} 行（解析不到就是表格形状改了）`,
  `解析 ${ruleRows.length} 行 vs RULE_ORDER ${RULE_ORDER.length} 条`);
RULE_ORDER.forEach((key, i) => {
  const row = ruleRows[i];
  const R = Rules[key];
  ok(!!row && row[1] === key && row[2].trim() === R.name, `D2 ${i + 1} 条 (${key}/${R.name}) 与 README 表逐字同`,
    row ? `文档 ${row[1]}/${row[2].trim()} vs 代码 ${key}/${R.name}` : '解析不到');
  ok(!!row && +row[3] === R.tier && +row[4] === R.weight, `D2 ${key} 的层级/权重 ${R.tier}/${R.weight} == Rules 现值`,
    row ? `文档 ${row[3]}/${row[4]} vs 代码 ${R.tier}/${R.weight}` : '解析不到');
});
const ruleCount = [...DOCS.matchAll(/([一二三四五六七八九十])条(?:铅笔规则|命名规则|局部推理)/g)].map(m => CN[m[1]]);
ok(ruleCount.length >= 3 && ruleCount.every(x => x === RULE_ORDER.length),
  `D2c 文档里所有「N 条铅笔规则 / N 条命名规则 / N 条局部推理」都等于 ${RULE_ORDER.length}（解析到 ${ruleCount.length} 处）`,
  ruleCount.join('/'));

// ---- D3 balance 那一次的分位表：p50 / 每格 / 步数 / 轮数 / 深度 / 入带率 / 节点 / 线索 全部由 balance 现场跑出来再对 ----
ok(BAL.rc === 0, `D3a balance SAMPLES=24 现场跑就是绿的（rc=${BAL.rc}）—— 不绿的读数不是现值`, `rc=${BAL.rc}`);
const balTable = {};
for (const ln of BAL.out.split('\n')) {
  const p = ln.trim().split(/\s+/);
  if (TIER_NAMES.includes(p[0]) && p.length >= 17 && /^\d+\/24$/.test(p[3])) {
    balTable[p[0]] = { size: p[1], band: p[2], shipped: p[3], min: p[4], p25: p[5], p50: p[6], p75: p[7], p90: p[8], max: p[9],
      cellP50: p[10], steps: p[11], sweeps: p[12], depth: p[13], inBand: p[14], nodes50: p[15], nodes95: p[16] };
  }
}
ok(Object.keys(balTable).length === 5, `D3b balance 的分位表解析到 ${Object.keys(balTable).length} 行（每档一行；解析不到就是列名或格式换了）`,
  Object.keys(balTable).join('/'));
const docDiffRows = [...README.matchAll(
  /^\| (初学|熟手|常规|高手|大师) \| (\d+)×\d+ \| \d+–\d+ \| \*\*([\d.]+)\*\* \| ([\d.]+) \| (\d+) \| (\d+) \| (\S+) \| (\d+%) \| (\d+) \/ (\d+) \| (\d+) \|$/gm)];
ok(docDiffRows.length === 5, `D3c README 难度表的五行全部解析到（p50/每格/步数/轮数/深度/入带率/节点 p50-p95/线索 p50）`,
  `解析 ${docDiffRows.length} 行`);
for (const m of docDiffRows) {
  const name = m[1], b = balTable[name];
  ok(!!b, `D3 ${name} 在 balance 的现场表里还在`, b ? '在' : 'balance 打印里没有这一档');
  if (!b) continue;
  ok(+m[3] === +b.p50, `D3 ${name} p50 ${m[3]} == balance 现场值 ${b.p50}`, `文档 ${m[3]} vs balance ${b.p50}`);
  ok(+m[4] === +b.cellP50, `D3 ${name} 每格 p50 ${m[4]} == balance 现场值 ${b.cellP50}`, `文档 ${m[4]} vs balance ${b.cellP50}`);
  ok(+m[5] === +b.steps, `D3 ${name} 步数 p50 ${m[5]} == balance 现场值 ${b.steps}`, `文档 ${m[5]} vs balance ${b.steps}`);
  ok(+m[6] === +b.sweeps, `D3 ${name} 轮数 p50 ${m[6]} == balance 现场值 ${b.sweeps}`, `文档 ${m[6]} vs balance ${b.sweeps}`);
  ok(m[7] === b.depth, `D3 ${name} 深度 ${m[7]} == balance 现场值 ${b.depth}（观测集合，不是配置）`, `文档 ${m[7]} vs balance ${b.depth}`);
  ok(m[8] === b.inBand, `D3 ${name} 入带率 ${m[8]} == balance 现场值 ${b.inBand}`, `文档 ${m[8]} vs balance ${b.inBand}`);
  ok(+m[9] === +b.nodes50 && +m[10] === +b.nodes95, `D3 ${name} 穷举节点 p50/p95 ${m[9]}/${m[10]} == balance 现场值 ${b.nodes50}/${b.nodes95}`,
    `文档 ${m[9]}/${m[10]} vs balance ${b.nodes50}/${b.nodes95}`);
}
// 线索 p50 藏在 balance 的"逐样本明细"行里：`  初学 5×5 · 入带 24/24 · 线索p50 6 · …`
const clueDetail = {};
for (const m of BAL.out.matchAll(/^\s+(初学|熟手|常规|高手|大师) \d+×\d+ · 入带 (\d+)\/(\d+) · 线索p50 (\d+)/gm)) {
  clueDetail[m[1]] = { inBand: `${m[2]}/${m[3]}`, clues50: +m[4] };
}
ok(Object.keys(clueDetail).length === 5, `D3d balance 的逐样本明细解析到 ${Object.keys(clueDetail).length} 行`, Object.keys(clueDetail).join('/'));
for (const m of docDiffRows) {
  const c = clueDetail[m[1]];
  ok(!!c && +m[11] === c.clues50, `D3e ${m[1]} 线索 p50 文档 ${m[11]} == balance 现算 ${c ? c.clues50 : '?'}`, `文档 ${m[11]} vs balance ${c ? c.clues50 : '?'}`);
}

// ---- D4 拒绝统计表：每一档的 采样/推不动/占比 与五档合计的三格都从 balance 现场跑出来对 ----
const rejRows = {};
for (const m of BAL.out.matchAll(/^(?:[✓✗] )?\s*(初学|熟手|常规|高手|大师)（\d+×\d+）: 采样 (\d+) 个盘，满线索就推不动而丢的 (\d+)（([\d.]+%)）/gm)) {
  rejRows[m[1]] = { sample: +m[2], fullNotPencil: +m[3], pct: m[4] };
}
ok(Object.keys(rejRows).length === 5, `D4a balance 的拒绝统计解析到 ${Object.keys(rejRows).length} 档`, Object.keys(rejRows).join('/'));
const docRej = [...README.matchAll(/^\| (初学|熟手|常规|高手|大师) \d+×\d+ \| (\d+) \| (\d+) \| ([\d.]+%) \|$/gm)];
ok(docRej.length === 5, `D4b README 拒绝统计表解析到 ${docRej.length} 行（每行 = 一档），解析不到就是列名改了`, `${docRej.length} 行`);
for (const m of docRej) {
  const b = rejRows[m[1]];
  ok(!!b && +m[2] === b.sample && +m[3] === b.fullNotPencil && `${m[4]}` === b.pct,
    `D4 ${m[1]} 那一行（采样 ${m[2]} / 推不动 ${m[3]} / 占比 ${m[4]}）== balance 现跑`,
    b ? `文档 ${m[2]}/${m[3]}/${m[4]} vs balance ${b.sample}/${b.fullNotPencil}/${b.pct}` : 'balance 里没有这一档');
}
const totalRej = BAL.out.match(/五档合计: 采样 (\d+) 个盘，其中「满线索就推不动」(\d+)（([\d.]+%)）/);
const docTotalRej = README.match(/五档合计采样 (\d+) 个盘，其中 (\d+) 个（([\d.]+%)）/);
ok(!!totalRej && !!docTotalRej && +totalRej[1] === +docTotalRej[1] && +totalRej[2] === +docTotalRej[2] && totalRej[3] === docTotalRej[3],
  `D4c 五档合计 采样 ${docTotalRej?.[1]} / 推不动 ${docTotalRej?.[2]}（${docTotalRej?.[3]}）== balance 现跑（${totalRej?.[1]}/${totalRej?.[2]}/${totalRej?.[3]}）`,
  `balance ${totalRej?.slice(1).join('/') || '未解析'} vs 文档 ${docTotalRej?.slice(1).join('/') || '未解析'}`);

// ---- D5 引擎断言总数：README 与 DESIGN 抄的 438 / 8 节 == engine-test 现场跑的 RESULT ----
const engLine = ENG.out.match(/^断言 (\d+)\/(\d+) 通过$/m);
ok(!!engLine && ENG.rc === 0, `D5a engine-test 现场跑 rc=${ENG.rc} 且打了「断言 N/N 通过」那一句`, engLine ? `断言 ${engLine[1]}/${engLine[2]}` : '解析不到');
const engTotal = engLine ? +engLine[2] : -1;
const docEng = [...DOCS.matchAll(/(?:引擎断言|断言) (\d+)\/(\d+) 通过/g)].map(m => ({ pass: +m[1], total: +m[2] }));
ok(docEng.length >= 1 && docEng.every(x => x.total === engTotal && x.pass === engTotal),
  `D5 README/DESIGN 的「断言 N/N 通过」等于 engine-test 现跑的 ${engTotal}（解析 ${docEng.length} 处：${docEng.map(x => x.total).join('/')}）`,
  `现跑 ${engTotal}`);
const secNames = [...ENG.out.matchAll(/^  [✓✗] ([A-E][0-9]?|E) · [^—]+— (\d+) 条断言/gm)].map(m => ({ name: m[1], total: +m[2] }));
ok(secNames.length === 8, `D5b engine-test 的八节（A1 A2 B C D1 D2 D3 E）现场解析到 ${secNames.length} 行`, secNames.map(s => s.name).join('/'));
const docSecs = [...DOCS.matchAll(/八 ?节（A1 A2 B C D1 D2 D3 E）/g)].length + [...DOCS.matchAll(/engine-test`? 的?八 ?节/g)].length;
ok(docSecs >= 1 && secNames.length === 8, `D5c 文档「engine-test 的八节（A1 A2 B C D1 D2 D3 E）」与现场节数相同`, `现场 ${secNames.length} 节 · 文档点到 ${docSecs} 处`);
// 累计计数最后一节 == 总数（README:164 那句 19→39→154→165→185→242→425→438 就是这条纪律）
ok(secNames[secNames.length - 1].total === engTotal, `D5d engine-test 的最后一节累计计数 == 总数（累计口径不是手抄）`,
  `最后 ${secNames[secNames.length - 1].name} 累计 ${secNames[secNames.length - 1].total} vs 总数 ${engTotal}`);

// ---- D6 结构数字：步数=格数、每档 3 条规则下限、缺陷类必为 0 —— 全部由 balance 现场跑 ----
for (const m of docDiffRows) {
  const b = balTable[m[1]];
  const t = TIERS.find(x => x.name === m[1]);
  ok(+m[5] === t.w * t.h && +m[5] === +b.steps, `D6 ${m[1]} 步数 p50 ${m[5]} == 档内格数 ${t.w}×${t.h}=${t.w * t.h}（出货盘每格恰好一次）`,
    `文档 ${m[5]} vs 代码 ${t.w * t.h} vs balance ${b?.steps}`);
}
ok(/check\(r\.rules\.length >= 3,/.test(BAL_SRC), `D6b 每档至少动用 3 条规则那一条在 balance 里是代码`,
  BAL_SRC.match(/check\(r\.rules\.length >= 3[^)]*\)/)?.[0]?.slice(0, 60) || '解析不到');
ok(/check\(totals\.prunedNotPencil === 0,/.test(BAL_SRC) && /check\(totals\.crossFail === 0,/.test(BAL_SRC),
  'D6c balance 里"缺陷类必为 0"是代码：删线索后推不完 / 穷举不认同 各一条 check',
  `两行都在=${/prunedNotPencil === 0/.test(BAL_SRC) && /crossFail === 0/.test(BAL_SRC)}`);

// ---- D7 端口：README/DESIGN == verify.sh 与 server.cjs 与 playtest.cjs 现值（默认号；override 只是手工跑的法子）----
const cdpWant = (VERIFY.match(/CDP_WANT=\$\{CDP_PORT:-(\d+)\}/) || [])[1];
const httpWant = (VERIFY.match(/HTTP_WANT=\$\{HTTP_PORT:-(\d+)\}/) || [])[1];
const prefWant = (VERIFY.match(/PREF_WANT=\$\{PREFIX_PORT:-(\d+)\}/) || [])[1];
const devM = (PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/);
const docPort = DOCS.match(/(\d+)（HTTP）\/ (\d+)（CDP）\/ (\d+)（前缀）/);
ok(!!cdpWant && !!httpWant && !!prefWant && !!devM,
  `D7a verify.sh 的三个 *_WANT 与 package.json dev 端口都解析到（CDP ${cdpWant} · HTTP ${httpWant} · PREF ${prefWant} · dev ${devM?.[1]}）`,
  `verify ${httpWant}/${cdpWant}/${prefWant} · package ${devM?.[1]}`);
ok(+httpWant === 5311 && +devM[1] === 5311, `D7 HTTP 默认号两处一致：verify.sh ${httpWant} == package.json dev ${devM?.[1]}`,
  `verify.sh=${httpWant} · package=${devM?.[1]}`);
ok(+prefWant === 5398 && /5398/.test(DOCS), `D7b 前缀形态 5398 在脚本与文档里同源`, `verify.sh=${prefWant} · 文档命中=${/5398/.test(DOCS)}`);
ok(+cdpWant === 9361, `D7c verify.sh 的 CDP 默认号就是这一仓的 9361（家族公共汽车 9334/9335/9347 之外，文档不抄它也不与它冲突）`,
  `verify.sh=${cdpWant}`);

// ---- D8 侧栏八个读数：index.html 有八个 stat 元素，README 明写「八个读数」----
const statCells = [...HTML.matchAll(/<div class="stat"><span>([^<]+)<\/span>/g)].map(m => m[1]);
ok(statCells.length === 8, `D8a index.html 解析到 ${statCells.length} 个 stat 单元（README:40 那句「侧栏八个读数」）`,
  statCells.join('/'));
const docEight = (README.match(/侧栏八个读数/) || [])[0];
ok(!!docEight, `D8 README 那句「侧栏八个读数」还在（改了 index.html 的读数就得同时改这句）`, docEight || '解析不到');
// 八个读数的名字也逐条等于 README 括号里的顺序
const docNames = [...(README.match(/（步数 \/ 提示 \/ 已定 \/ 未定 \/ 凑满的岛 \/ 墙块数 \/ 冲突 \/ 难度实测/) || [])[0].matchAll(/(步数|提示|已定|未定|凑满的岛|墙块数|冲突|难度实测)/g)].map(m => m[1]);
ok(docNames.length === 8 && docNames.join('|') === statCells.join('|'), `D8b README 列的八个读数名字与 index.html 的 stat 单元格逐条相同`,
  `文档 ${docNames.join('/')} vs 页面 ${statCells.join('/')}`);

// ---- D9 场景注册表：verify.sh 的默认场景名与 scenarios.js 里的注册名一一对上，README 抄的"九个"是真的 ----
const scenDone = (VERIFY.match(/SCENARIOS_DONE="([^"]+)"/) || [, ''])[1].trim().split(/\s+/).filter(Boolean);
ok(scenDone.length === 9, `D9a verify.sh 的 SCENARIOS_DONE 解析到 ${scenDone.length} 个场景（九个：first zero hint conflict save resume daily layout narrow）`,
  scenDone.join(' '));
const docScen = (README.match(/SCENARIOS_DONE="[^"]*"/) || [])[0];
const docNine = (README.match(/九个场景/) || [])[0];
ok(/first zero hint conflict save resume daily layout narrow/.test(DOCS) && (docNine || /九 ?个场景|九个场景/.test(DOCS) || /9 个场景/.test(DOCS)),
  `D9b 文档里"九个场景 / 9 个场景 / first … narrow 那一串"三处都在（少一处就是文档改了一半）`,
  `清单命中=${/first zero hint conflict save resume daily layout narrow/.test(DOCS)} · 九个=${docNine || '没有'} · 现值 ${scenDone.length}`);
const FIXTURE = SCEN.slice(SCEN.indexOf('const FIXTURE = ['), SCEN.indexOf('// <<<FIXTURE'));
const fixtureRows = (FIXTURE.match(/^\s*\{$/gm) || []).length;
ok(fixtureRows === 9, `D9c scenarios.js 的 FIXTURE 是 9 行手抄指纹（README:190 与 DESIGN:11 说的都是九行；0 行或 !=9 就是红）`,
  `${fixtureRows} 行`);

// ---- D10 符号锚点：文档为某个文件写的 `file:NN` / `file:NN-MM` 引用，必须真的覆盖到该符号现在的行 ----
const fileRanges = (file) => {
  const esc = file.replace(/[./]/g, '\\$&');
  return [...DOCS.matchAll(new RegExp('`' + esc + ':(\\d+)(?:-(\\d+))?`', 'g'))].map(m => [+(m[1]), +(m[2] || m[1])]);
};
const lineOf = (file, re) => { const a = read(file).split('\n'); for (let i = 0; i < a.length; i++) if (re.test(a[i])) return i + 1; return -1; };
const ANCHORS = [
  ['js/engine/nurikabe.js', 'RULE_ORDER', /export const RULE_ORDER/],
  ['js/engine/nurikabe.js', 'complete()', /export function complete/],
  ['js/engine/nurikabe.js', 'cycleCell', /export function cycleCell/],
  ['js/engine/generate.js', 'TIERS', /export const TIERS/],
  ['js/engine/generate.js', 'crossCheck', /export function crossCheck/],
  ['js/engine/count.js', 'OVERBUDGET return', /if \(over\) return \{ status: OVERBUDGET/],
  ['js/engine/count.js', 'finalBad', /function finalBad/],
  ['js/engine/rng.js', 'dailySeed', /export function dailySeed/],
  ['js/store.js', 'nurikabe.save.v1', /const KEY = 'nurikabe\.save\.v1'/],
  ['tools/engine-test.mjs', 'e2e seed', /seed: 'e2e'/],
];
for (const [file, what, srcRe] of ANCHORS) {
  const real = lineOf(file, srcRe);
  const ranges = fileRanges(file);
  const hits = ranges.filter(([a, b]) => real >= a && real <= b);
  ok(real > 0, `D10 代码侧「${what}」解析到了（找不到就是空转）`, `${file}:${real}`);
  ok(hits.length >= 1, `D10 文档为 ${file} 写的某处 \`file:NN\` 真的覆盖到「${what}」现在的第 ${real} 行`,
    ranges.length ? `文档范围：${ranges.map(([a, b]) => a === b ? String(a) : `${a}-${b}`).join(' / ')} · 代码现在 ${real}` : '文档里解析不到这个文件的行引用');
}

// ---- D11 泛引用范围检查：README + DESIGN 里每一条 path:NN / path:NN-MM 都落在真实文件行数内 ----
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/|js\/|tools\/|css\/)?[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,11}):(\d+)(?:-(\d+))?/g)]; // 后缀不许写死：名单里没有的那个后缀，这条腿就永远读不到它，而「都核过了」照样打印
const resolve = (p) => {
  if (existsSync(join(ROOT, p))) return p;
  const base = p.split('/').pop();
  for (const d of ['tools/', 'js/engine/', 'js/', 'js/ui/', 'css/', '']) if (existsSync(join(ROOT, d + base))) return d + base;
  return null;
};
// 一条引用的两道查抽成一个函数，是因为下面那把空行刀要走**同一条代码路径**：把空行那一道删掉，范围检查
// 照样全绿，只有这一把会立刻红——否则新加的那道查就是一张没有对照的等式。
const citeMiss = (file, fromRaw, toRaw) => {
  const rp = resolve(file);
  const label = `${file}:${fromRaw}${toRaw ? '-' + toRaw : ''}`;
  if (!rp) return `${label}（文件不存在）`;
  const src = read(rp).split('\n');
  const from = +fromRaw;
  const to = +(toRaw || fromRaw);
  if (from > src.length || to > src.length) return `${label}（该文件只有 ${src.length} 行）`;
  // 「在界内」不等于「指到了代码」：句子里没贴名字的裸引用不核锚点（D18 那段写明），只过这一道范围检查，
  // 所以整段空白必须在这里红——否则它指着的只是一片行距，两道查都会放它过。
  if (src.slice(from - 1, to).join('').trim() === '') return `${label} 那几行整段是空行`;
  return '';
};
const bad = [];
for (const c of cites) {
  const miss = citeMiss(c[1], c[2], c[3]);
  if (miss) bad.push(miss);
}
// 反空转的刀：目标行号现量（本闸自己这份文件的第一处空行），不写死——写死的那个数会在有人填了那一行之后
// 悄悄地不再测任何东西，`blankAt > 0` 把那一天变成红。
const probeBlank = read('tools/doctest.mjs').split('\n');
let blankAt = 0;
for (let i = 1; i < probeBlank.length; i++) if (String(probeBlank[i]).trim() === '') { blankAt = i + 1; break; }
const blankKnife = blankAt ? citeMiss('tools/doctest.mjs', blankAt, null) : '';
ok(cites.length >= 40, `D11a 文档里的 path:NN 引用解析到 ${cites.length} 条（少于 40 条说明引用格式改了）`, `${cites.length} 条`);
ok(bad.length === 0 && !!blankKnife, `D11 每一条 path:NN 引用都落在真实文件的行数内、且被指的那几行整段不许是空行（改了代码不重编就是这里红；这一格自己带一把指向空行的刀）`,
  bad.length ? `越界/不存在/空行：${bad.slice(0, 5).join('，')}${bad.length > 5 ? ` …共 ${bad.length} 条` : ''}`
    : blankKnife ? `${cites.length} 条全部在范围内 · 刀：第 ${blankAt} 行是空行，指过去判红「${blankKnife.split(' ').pop()}」`
      : '本闸自己的文件里找不出空行靶子 —— 空行那一道没被证明过');

// ---- D18 锚点从文档现推：落在行数内不够，被指的那几行还得真坐着它点名的那个东西 ----
// D11 只问"这个行号存在吗"。一句「`OVERBUDGET` 在 `count.js:352`」如果其实指的是隔壁那一行，行号照样在
// 范围内，D11 一路绿——本仓上一轮就是这样绿的（DESIGN 那句把 OVERBUDGET 与 UNIQUE 混引到 352）。
// 这一段拿同一份文档当输入现推锚点：贴着 `path:NN` 写出来的那个反引号标识符，必须真的出现在被指的那几行里。
// 口径写死：一条锚点 = (文件, 行段, 名字)，同一处在两份文档各写一次只算一条；句子里没有贴着名字的裸
// `path:NN` 这里一条都不核，那部分仍只过 D11 —— 这条腿没覆盖什么，README 里也照样写明，不装作全覆盖。
const ANCH_CITE = /^([\w./-]+\.[A-Za-z][A-Za-z0-9]{0,11}):(\d+)(?:-(\d+))?$/; // 后缀不许写死：名单里没有的那个后缀，这条腿就永远读不到它，而「都核过了」照样打印
const ANCH_ID = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const anchorTok = (body) => {
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  if (seg.includes('/')) return '';
  const head = seg.split('(')[0].trim();
  if (ANCH_ID.test(head)) return head;
  const lhs = head.split(/[=:]\s/)[0].trim();
  return ANCH_ID.test(lhs) ? lhs : '';
};
const deriveAnchors = (text) => {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map(m => ({ body: m[1], s: m.index, end: m.index + m[0].length }));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < spans.length; i++) {
    const c = spans[i].body.match(ANCH_CITE);
    if (!c) continue;
    let anchor = '';
    const next = spans[i + 1];
    if (next) {
      const gap = text.slice(spans[i].end, next.s);
      if (gap.length <= 4 && !gap.includes('\n') && (/^[（(]/.test(gap.replace(/\s+/g, '')) || gap.replace(/\s+/g, '') === '的')) anchor = anchorTok(next.body);
    }
    if (!anchor && i > 0) {
      const prev = spans[i - 1];
      const gap = text.slice(prev.end, spans[i].s);
      const g = gap.replace(/\s+/g, '');
      if (gap.length <= 4 && !gap.includes('\n') && !/\s/.test(prev.body) && (/^[（(]/.test(g) || /[\w一-鿿]/.test(g))) anchor = anchorTok(prev.body);
    }
    if (!anchor) continue;
    const from = +c[2];
    const to = +(c[3] || c[2]);
    const key = `${c[1]}:${from}-${to}:${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: c[1], from, to, anchor, label: `${c[1]}:${from}${c[3] ? '-' + c[3] : ''}` });
  }
  return out;
};
// 整词，不是子串：`clue` 坐在声明 `clueRuns` 的那一行上不算命中，名字两侧再是字母、数字、`_`、`$`
// 就不是这个标识符本身。子串口径比它替掉的手写锚点表**更弱**——一个短名字会"出现在"任何碰巧含它的
// 标识符里，于是把一次真的漂读成绿。缓存是因为一条腿要对同一个名字核上百次。
const wordCache = new Map();
const hasWord = (text, name) => {
  if (!wordCache.has(name)) {
    wordCache.set(name, new RegExp('(^|[^A-Za-z0-9_$])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_$])'));
  }
  return wordCache.get(name).test(text);
};
const anchorMiss = (list) => list.filter(d => {
  const rp = resolve(d.file);
  if (!rp) return true;
  const src = read(rp).split('\n');
  if (d.from < 1 || d.to > src.length) return true;
  return !hasWord(src.slice(d.from - 1, d.to).join('\n'), d.anchor);
});
const citeKey = (d) => `${d.file}:${d.from}${d.to !== d.from ? '-' + d.to : ''}`;
const docAnchors = deriveAnchors(DOCS);
const anchorBad = anchorMiss(docAnchors);
// 这一格自带一把刀，走的就是上面那条代码路径：把某条现推锚点的名字截掉最后一格，截出来的串仍然是被指
// 那几行的子串、却不再是一个完整标识符（`fooBar` 那行永远"含" `fooBa`）。整词口径必须为它红；口径哪天
// 退回子串，那一天正是所有候选都"过"、这把刀挑不出红的那一天，所以挑不出就当场红，不许静默跳过。
const wordKnife = (() => {
  for (const d of docAnchors) {
    const rp = resolve(d.file);
    if (!rp) continue;
    const body = read(rp).split('\n').slice(d.from - 1, d.to).join('\n');
    const cut = d.anchor.slice(0, -1);
    if (cut.length < 3 || !body.includes(d.anchor) || !body.includes(cut)) continue;
    if (anchorMiss([{ ...d, anchor: cut }]).length) return { d, cut };
  }
  return null;
})();
ok(anchorBad.length === 0 && !!wordKnife, 'D18a 从文档现推的每一个锚点都作为**完整标识符**坐在被指的那几行里（整词口径；行号在范围内不算数，这一格自己带一把截前缀的刀）',
  anchorBad.length ? `漂 ${anchorBad.length} 处：${anchorBad.slice(0, 6).map(d => `${citeKey(d)} 里找不到 ${d.anchor}`).join('，')}`
    : wordKnife ? `现推 ${docAnchors.length} 条，全部落回原处 · 刀：${citeKey(wordKnife.d)} 的 ${wordKnife.d.anchor} 截成 ${wordKnife.cut} 判红`
      : '现推锚点里截不出前缀靶子 —— 这一格没被证明过');
ok(docAnchors.length >= 15, `D18b 现推锚点解析到 ${docAnchors.length} 条（少于 15 条就是引用格式被改了或解析断了，那不是"更绿"）`,
  `${docAnchors.length} 条，头四条：${docAnchors.slice(0, 4).map(d => `${citeKey(d)}=${d.anchor}`).join(' ')}`);
// 刀（下在内存里，盘上一个字节不动）：把某条引用的行号整段往后挪两行，检查器必须认这笔漂。
// 先找一把"挪得动"的锚点——挪完那两行里不再有它点名的东西；一把都找不到就判红，不许静默跳过。
const knifeTarget = docAnchors.find(d => anchorMiss([{ ...d, from: d.from + 2, to: d.to + 2 }]).length === 1);
const kDoc = knifeTarget ? DOCS.replace(citeKey(knifeTarget), `${knifeTarget.file}:${knifeTarget.from + 2}${knifeTarget.to !== knifeTarget.from ? '-' + (knifeTarget.to + 2) : ''}`) : DOCS;
const kMiss = kDoc === DOCS ? [] : anchorMiss(deriveAnchors(kDoc));
ok(!!knifeTarget && kMiss.length >= 1, 'D18c 刀：把一句引用的行号挪两行，这一格必须认它漂（而不是"少推出一条所以更绿"）',
  !knifeTarget ? '文档里找不出一把挪得动的锚点 —— 这条腿没被证明过'
    : `下刀处 ${citeKey(knifeTarget)} 的 ${knifeTarget.anchor} → 现推漂 ${kMiss.length} 处：${kMiss.slice(0, 2).map(d => citeKey(d)).join('，')}`);
{
  const quoted = [...DOCS.matchAll(/现推锚点 (\d+) 条/g)].map(m => +m[1]);
  ok(quoted.length >= 1 && quoted.every(v => v === docAnchors.length),
    'D18d 文档抄的「现推锚点 N 条」等于这一次真的从文档推出来的条数（删掉这个数字同样算红）',
    `闸数到 ${docAnchors.length} · 文档写了 ${quoted.length} 处：${[...new Set(quoted)].join('/') || '一处都没写'}`);
}

// ---- D12 承诺表：README 那四行「四条承诺」的闸名都指得到真东西 ----
const promiseSection = README.slice(README.indexOf('## 这四条承诺'), README.indexOf('## 这个仓'));
const promiseRows = promiseSection.split('\n')
  .filter(l => /^\| \*\*/.test(l))
  .map(l => { const cells = l.split('|').slice(1, -1).map(s => s.trim()); return { name: cells[0], body: cells[1] || '' }; });
ok(promiseRows.length === 4, `D12a 承诺表解析到 ${promiseRows.length} 行（!=4 就是表格形状被改了或整节被删）`,
  `${promiseRows.length} 行`);
for (const r of promiseRows) {
  const targets = [...r.body.matchAll(/`((?:js|tools)\/[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,11})(?::\d+(?:-\d+)?)?`/g)].map(x => x[1]); // 后缀不许写死：名单里没有的那个后缀，这条腿就永远读不到它，而「都核过了」照样打印
  const real = targets.filter(p => existsSync(join(ROOT, p)));
  ok(targets.length >= 1 && real.length === targets.length, `D12 ${r.name.slice(0, 12)}… 那一行的每一处 path 都在树里`,
    `点名 ${targets.length} · 在树 ${real.length}${real.length !== targets.length ? ` · 缺：${targets.filter(t => !real.includes(t)).join(',')}` : ''}`);
}

// ---- D13 接线：doctest 与 sabotage 进了 verify.sh、ci.yml 的 check job 与 package.json 的 scripts ----
const pkgHas = k => (PKG.scripts?.[k] || '').includes(`tools/${k}.mjs`);
ok(pkgHas('doctest') && pkgHas('sabotage'), `D13a package.json 有 doctest 与 sabotage 两条 script 且都指向本仓的 tools/`,
  `doctest=${PKG.scripts?.doctest} · sabotage=${PKG.scripts?.sabotage}`);
const inVerify = /node tools\/doctest\.mjs/.test(VERIFY);
const inCi = /node tools\/doctest\.mjs/.test(CI);
const inCiSab = /node tools\/sabotage\.mjs/.test(CI);
ok(inVerify, 'D13b verify.sh 里接了 doctest 这一道逻辑闸（npm run verify 与 bash tools/verify.sh 都跑同一件事）', `verify=${inVerify}`);
ok(inCi && inCiSab, 'D13c ci.yml 的 check job 里同时接了 doctest 与 sabotage（本地绿＝CI 绿；不许有只在本地或只在 CI 才跑的那道）',
  `ci.doctest=${inCi} · ci.sabotage=${inCiSab}`);
const verifyCmd = /bash tools\/verify\.sh/.test(CI);
ok(verifyCmd && PKG.scripts?.verify === 'bash tools/verify.sh', `D13d verify.sh 是 CI 与本地共用的那一条命令`,
  `pkg.verify=${PKG.scripts?.verify} · ci 里有 bash tools/verify.sh=${verifyCmd}`);
const ciCheckBlock = CI.slice(CI.indexOf('check:'), CI.indexOf('browser:'));
ok(/node tools\/doctest\.mjs/.test(ciCheckBlock) && /node tools\/sabotage\.mjs/.test(ciCheckBlock),
  'D13e doctest 与 sabotage 都在 ci.yml 的 check job 里（不是在 browser job 里靠 Chrome）',
  `check job 内 doctest=${/node tools\/doctest\.mjs/.test(ciCheckBlock)} · sabotage=${/node tools\/sabotage\.mjs/.test(ciCheckBlock)}`);

// ---- D14 墙钟那类：只比方向与来源、绝不重测、也绝不把新测的毫秒写回文档 ----
const msDriftNotes = [...DOCS.matchAll(/(双峰分布的中位×2 是假的天花板|墙钟走 stderr|绝对毫秒预算就是假承诺|不设 `budgetMs` 门禁|不设 budgetMs 闸)/g)].map(m => m[1]);
ok(msDriftNotes.length >= 3, `D14a 文档里三处以上写明「墙钟 ms 会漂、走 stderr、不设 budgetMs 闸」（少了就是有人把这一列又搬回 stdout 或写了绝对预算）`,
  `${msDriftNotes.length} 处`);
const balMsStderr = /console\.error\([^)]*出题墙钟/.test(BAL_SRC);
const balHasBudget = !/budgetMs\s*[=:]|process\.exit\([^)]*ms/.test(BAL_SRC);
ok(balMsStderr && balHasBudget, `D14b balance.mjs 的 ms 那一段确实走 stderr 且没有 budgetMs 判定路径（文档那句「不设 budgetMs」有代码背书）`,
  `stderr=${balMsStderr} · 无 budgetMs 判定=${balHasBudget}`);

// ---- D15 UNPINNED 清单：文档抄的、需要探针或本机跑才有值的读数不进等式；但每条都要"还在文档里" ----
const UNPINNED = [
  ['U1', '五档出题墙钟 p50/p90/p95（1.6/3.4/4.8 … 106.8/338.5/558.9）', /初学 1\.6\/3\.4\/4\.8/],
  ['U2', '出题合计 4.9s / 端到端 5.0s', /出题合计 4\.9s/],
  ['U3', '线上部署件那一跑 9 场景 / 755 条 / 0 失败 / 20 秒', /9 个场景、\*\*755 条、0 失败、20 秒/],
  ['U4', 'generate.js:29-34 注释里的另一批 seed（final.<档>.<i>：34.5–42.5 等）', /34\.5–42\.5/],
  ['U5', 'DESIGN §5 里那批 island 轴上限实测（8×8 岛≤4 7/200 / 岛≤5 3/200 …）', /8×8 岛 ≤4 出 7\/200/],
];
UNPINNED.forEach(([id, what, re]) => {
  const hits = (DOCS.match(re) || []).length;
  ok(hits >= 1, `D15 ${id}「${what}」还写在文档里（钉不住 ≠ 可以删；删了就是这一条红）`, `${hits} 处`);
});
const unpinnedHits = UNPINNED.filter(([, , re]) => re.test(DOCS)).length;
ok(unpinnedHits === UNPINNED.length, `D15a 反空转：${UNPINNED.length} 条 unpinned 逐条在文档里找到 needle`, `${unpinnedHits}/${UNPINNED.length}`);

// ---- D16 台账本身：文档说的刀数 == sabotage.mjs 里 KNIVES 条数；每行的 rc 一格是数字不是问号 ----
const sabSrc = existsSync(join(ROOT, 'tools/sabotage.mjs')) ? read('tools/sabotage.mjs') : '';
const knifeIds = [...sabSrc.matchAll(/id: '(K\d+)'/g)].map(m => m[1]);
ok(knifeIds.length >= 4, `D16a sabotage.mjs 里至少 4 把刀（当前 ${knifeIds.length} 把：${knifeIds.join(' ')}）`,
  `${knifeIds.length} 把：${knifeIds.join(' ')}`);
const knifeCountDoc = (README.match(/破坏试验台账（(\d+) 把刀）/) || [])[1];
ok(!!knifeCountDoc && +knifeCountDoc === knifeIds.length, `D16b README 那句「台账（N 把刀）」等于 sabotage.mjs 里的刀数`,
  `文档 ${knifeCountDoc ?? '未解析'} vs 脚本 ${knifeIds.length}`);
const rcCells = knifeIds.map(id => {
  const m = sabSrc.match(new RegExp(`id: '${id}'[\\s\\S]*?rc: '(\\d+|\\?)'`));
  return m ? m[1] : null;
});
ok(rcCells.every(x => x && /^\d+$/.test(x)), `D16c 台账每一格 rc 都是从脚本读回来的数字（? 表示这一版还没整跑过）`,
  rcCells.join(' / '));

// ---- D17 自数：这道闸自己发出的 D 组数与项数都钉死 —— 删一条 test/少解析一行就是这里红 ----
const EXPECT_GROUPS = 18;
const EXPECT_ROWS = 161;
// 注意求值顺序：ok() 的 label/detail 实参在本条计入 emitted/rows 之前就已算好，
// 所以这里显式把「本闸接下来要发的 D17a、D17b 两条」和「D17 这一组」预先并进总数再比。
const finalRows = rows + 2;
const finalGroups = emitted.size + (emitted.has('D17') ? 0 : 1);
ok(finalGroups === EXPECT_GROUPS, `D17a 本闸发出 ${finalGroups} 组 D 标签（钉在 ${EXPECT_GROUPS}；删一组就是这里红）`,
  `${[...emitted, 'D17'].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => +a.slice(1) - +b.slice(1)).join(' ')}`);
ok(finalRows === EXPECT_ROWS, `D17b 本闸项数 == 钉的 ${EXPECT_ROWS}（增/删一条 ok() 都要改这里；不改就是这里红）`,
  `本次累计 ${finalRows} 项`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
console.log(`钉成等式的文档现值：${rows - UNPINNED.length} 项 · 显式 unpinned：${UNPINNED.length} 项`);
if (fail.length) { for (const f of fail) console.log(`  未过：${f}`); process.exit(1); }
process.exit(0);
