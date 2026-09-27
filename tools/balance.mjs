// 数墙 · 难度实测台（tools/balance.mjs）
//
// 这份文件对每档**现场出题**、量出分数分布，然后用 exit code 兑现 `js/engine/generate.js:21`
// 那句承诺：TIERS[].band 是量出来的，页面才敢对玩家说「实测 X–Y 分」。规则权重、删线索轮数、
// 档位轴任何一处改动都可能让 band 说谎 —— 说谎就在这儿 exit 1，而不是在 README 里重新编一个数。
//
//   npm run balance                # 默认每档 5 题，本地快查
//   SAMPLES=24 npm run balance     # 发布口径（CI 里跑的就是这条）
//
// 三道闸，每道都可证伪：
//   1. 出货率    每档 SAMPLES 题必须在 attempts 次尝试内全部出得来（出不来 = 门槛悬空）。
//   2. 入带率    每档 100%：量出来的每一题分数都要落在 TIERS 的 band 里。这是「难度是量出来的」
//      的可执行形式。band 覆盖不了实测分布就是 band 写错了 —— 按实测改 band，不许改这条闸。
//   3. 阶梯      五档 p50 严格递增。「初学 < 大师」在这一刻是机器在查，不是文案在说。
//
// 测的是**不筛带**的原始分布（generateOne band=null）：带筛完再量等于自己给自己打分。
// 而带一旦覆盖全部实测样本，出货路径（makePuzzle 带筛）在同一批 seed 上逐步等价 —— 每次尝试
// 的 rand 流 `${seed}#${a}` 与 band 无关，band 只在最后放行/不放行，全放行即同一串结果。
// 所以这一趟既量了真分布，又证明了出货不会在 band 上空转 attempts。
//
// 确定性：stdout 逐字节可复跑（diff <(node tools/balance.mjs) <(node tools/balance.mjs) 为空）。
// 期望值里没有 Math.random()/Date.now()，seed 全部显式（`scn|<档>|<i>`），sort 比较器只比数字。
// 唯一的墙钟例外是出题耗时 —— 它在物理上就不可能逐字节复跑，所以整段走 stderr，
// 按「时延基线取尾巴」的口径报 p50/p90/p95 的绝对值，不设 budgetMs 闸（双峰分布的中位×2
// 是假的天花板；真要闸，闸的是 stdout 里确定性的穷举节点数尾巴）。
//
// 拒绝统计如实呈现：门槛是被拒的盘撑起来的。大师档九成以上的采样盘死在「满线索就推不动」，
// 这个数就印在那一行的百分比里，别只报命中率。

import { performance } from 'node:perf_hooks';
import { TIERS, generateOne } from '../js/engine/generate.js';
import { createBoard, solve, verify, Rules, RULE_ORDER } from '../js/engine/nurikabe.js';
import { UNIQUE } from '../js/engine/count.js';

const SAMPLES = Math.max(1, Number(process.env.SAMPLES) || 5);
// 和 js/ui/game.js makePuzzle 用的是同一个对账预算：这里过的盘就是玩家会拿到的盘。
const CROSS_BUDGET = Number(process.env.CROSS_BUDGET) || 1500000;

// 分位数：最近秩法（对 24 个样本取 p50 = 第 13 小的分数）。纯下标运算，无插值无随机。
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const pct = (n, d) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const sameBreakdown = (a, b) =>
  RULE_ORDER.every((k) => (a[k] || 0) === (b[k] || 0)) &&
  Object.keys(a).length === Object.keys(b).length;

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  return !!ok;
};

const wallT0 = performance.now(); // 只进 stderr，stdout 里不许有墙钟
const msAll = [];

console.log(`数墙 · 难度实测 · SAMPLES=${SAMPLES}/档 · seed=scn|<档>|<i> · 对账预算=${CROSS_BUDGET}`);
console.log('测量口径：generateOne band=null（不筛带），入带率按 TIERS 现值对未筛样本结算');

const rows = [];
for (const t of TIERS) {
  const scores = [];
  const perCells = [];
  const steps = [];
  const sweeps = [];
  const clues = [];
  const draws = []; // 每题采样了多少个盘（stats.attempts）—— 聚合命中率要拆到样本
  const nodes = []; // 穷举对账的节点数：确定性的「费脑子」代理量
  const times = []; // ms，只进 stderr
  const depths = new Set();
  const rulesSeen = new Set();
  const stats = { attempts: 0, plantFail: 0, fullNotPencil: 0, fewClues: 0, prunedNotPencil: 0, crossFail: 0, bandMiss: 0 };
  let inBand = 0;
  let shipped = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const seed = `scn|${t.key}|${i}`; // 显式种子串，禁 Math.random
    const t0 = performance.now();
    const g = generateOne({
      w: t.w, h: t.h, maxIsland: t.maxIsland, blackRatio: t.blackRatio,
      minClues: t.minClues, seed, attempts: t.attempts, band: null, budget: CROSS_BUDGET,
    });
    const dt = performance.now() - t0;
    times.push(dt);
    msAll.push(dt);
    if (!g.ok) {
      check(false, `${t.name} #${String(i).padStart(2, '0')}（seed=${seed}）在 ${t.attempts} 次尝试里出不了货：reason=${g.reason} stats=${JSON.stringify(g.stats)}`);
      continue;
    }
    shipped++;
    for (const k of Object.keys(stats)) stats[k] += k === 'attempts' ? g.stats.attempts : g.stats[k];
    draws.push(g.stats.attempts);
    nodes.push(g.cross.nodes);
    for (const k of Object.keys(g.breakdown)) rulesSeen.add(k);
    depths.add(g.topTier);

    // —— 出货承诺逐题重验：零猜测、独立验收、穷举唯一、分数是盘的属性而不是生成器_STATE ——
    const board = createBoard({ w: g.w, h: g.h, clue: Uint8Array.from(g.clue) });
    const r = solve(board);
    check(r.ok, `${t.name} #${String(i).padStart(2, '0')}: 铅笔路径没推完（出货盘必须零猜测）`);
    check(verify(board, r.cell).length === 0, `${t.name} #${String(i).padStart(2, '0')}: 独立验收不过`);
    check(
      r.score === g.score && r.steps === g.steps && r.sweeps === g.sweeps && sameBreakdown(r.breakdown, g.breakdown),
      `${t.name} #${String(i).padStart(2, '0')}: 复解不一致（生成时 ${g.score}/${g.steps}/${g.sweeps}，重跑 ${r.score}/${r.steps}/${r.sweeps}）—— 分数得是盘的属性`,
    );
    check(g.cross.status === UNIQUE && g.cross.level === 'count' && g.cross.mismatch === 0,
      `${t.name} #${String(i).padStart(2, '0')}: 穷举对账没把唯一性证完（status=${g.cross.status} level=${g.cross.level} mismatch=${g.cross.mismatch}）`);
    check(g.clues >= t.minClues && g.steps === t.w * t.h, `${t.name} #${String(i).padStart(2, '0')}: 线索数/步数不满足档位下限`);

    const hit = g.score >= t.band[0] && g.score <= t.band[1];
    if (hit) inBand++;
    else console.log(`    ✗ ${t.name} #${String(i).padStart(2, '0')} 分数 ${g.score} 出带 [${t.band}]`);
    scores.push(g.score);
    perCells.push(g.perCell);
    steps.push(g.steps);
    sweeps.push(g.sweeps);
    clues.push(g.clues);
  }

  scores.sort((a, b) => a - b); // 比较器只比数字（node 与 Chrome 才会画同一张盘）
  perCells.sort((a, b) => a - b);
  steps.sort((a, b) => a - b);
  sweeps.sort((a, b) => a - b);
  times.sort((a, b) => a - b);
  nodes.sort((a, b) => a - b);
  const sortedClues = clues.slice().sort((a, b) => a - b);
  rows.push({
    tier: t, shipped, inBand,
    min: scores[0], p25: q(scores, 0.25), p50: q(scores, 0.5), p75: q(scores, 0.75), p90: q(scores, 0.9), max: scores[scores.length - 1],
    cellP50: q(perCells, 0.5),
    steps50: q(steps, 0.5), sweeps50: q(sweeps, 0.5), clues50: q(sortedClues, 0.5),
    depths: [...depths].sort((a, b) => a - b).join('/'),
    rules: [...rulesSeen].sort((a, b) => RULE_ORDER.indexOf(a) - RULE_ORDER.indexOf(b)),
    nodes50: q(nodes, 0.5), nodes95: q(nodes, 0.95),
    ms50: q(times, 0.5), ms90: q(times, 0.9), ms95: q(times, 0.95), msSum: times.reduce((a, b) => a + b, 0),
    scores, draws, clues: sortedClues, stats,
  });
}

// ---------- 分位表 ----------
console.log('\n== 五档分位表（每档现场生成 SAMPLES 题；ms 走 stderr；节=穷举节点数）==');
const header = ['档位', '尺寸', 'band', '出货', 'min', 'p25', 'p50', 'p75', 'p90', 'max', '每格p50', '步数', '轮数', '深度', '入带率', '节p50', '节p95'];
console.log('  ' + header.map((h) => String(h).padStart(7)).join(' '));
for (const r of rows) {
  const t = r.tier;
  const cells = [
    `${t.w}×${t.h}`, `${t.band[0]}–${t.band[1]}`, `${r.shipped}/${SAMPLES}`,
    r.min, r.p25, r.p50, r.p75, r.p90, r.max, r.cellP50.toFixed(3),
    r.steps50, r.sweeps50, r.depths, `${Math.round((100 * r.inBand) / Math.max(1, r.shipped))}%`,
    r.nodes50, r.nodes95,
  ];
  console.log('  ' + [t.name, ...cells].map((v) => String(v).padStart(7)).join(' '));
}

// ---------- 每样本明细（聚合数必须能拆回样本，防退化样本把均值撑好看） ----------
console.log('\n== 逐样本明细（每行 = 该档 SAMPLES 个出货样本的第 1…N 个）==');
for (const r of rows) {
  console.log(`  ${r.tier.name} ${r.tier.w}×${r.tier.h} · 入带 ${r.inBand}/${r.shipped} · 线索p50 ${r.clues50} · 出场规则 ${r.rules.map((k) => Rules[k].name).join(' ')}`);
  console.log(`    分数   ${r.scores.join(' ')}`);
  console.log(`    采样盘 ${r.draws.join(' ')}`);
}

// ---------- 拒绝统计：门槛是被拒的盘撑起来的，只报命中率就是粉饰 ----------
console.log('\n== 拒绝统计（出货每盘采了多少样、按什么理由丢；band=null 下带筛未启用，出带按上行入带率结算）==');
const totals = { attempts: 0, plantFail: 0, fullNotPencil: 0, fewClues: 0, prunedNotPencil: 0, crossFail: 0 };
for (const r of rows) {
  const s = r.stats;
  for (const k of Object.keys(totals)) totals[k] += s[k];
  console.log(
    `  ${r.tier.name}（${r.tier.w}×${r.tier.h}）: 采样 ${r.stats.attempts} 个盘，` +
    `满线索就推不动而丢的 ${r.stats.fullNotPencil}（${pct(s.fullNotPencil, s.attempts)}），` +
    `种不出合法盘 ${r.stats.plantFail}（${pct(s.plantFail, s.attempts)}），` +
    `岛数够不到线索下限 ${r.stats.fewClues}（${pct(s.fewClues, s.attempts)}），` +
    `删线索后推不完(缺陷) ${r.stats.prunedNotPencil}，穷举不认同(缺陷/超预算) ${r.stats.crossFail}`
  );
}
console.log(`  五档合计: 采样 ${totals.attempts} 个盘，其中「满线索就推不动」${totals.fullNotPencil}（${pct(totals.fullNotPencil, totals.attempts)}）—— 难度阶梯就是被这个拒收率撑起来的`);

// ---------- 三道闸 ----------
// 闸 1：出货率 —— SAMPLES 题全出得来
for (const r of rows) check(r.shipped === SAMPLES, `${r.tier.name}: 只出得来 ${r.shipped}/${SAMPLES} 题（attempts=${r.tier.attempts} 不够或轴太狠）`);
// 闸 2：入带率 100% + 中位数在带内
for (const r of rows) {
  check(r.shipped > 0 && r.inBand === r.shipped && r.shipped === SAMPLES, `${r.tier.name}: 入带率 ${(100 * r.inBand) / Math.max(1, r.shipped)}% ≠ 100%（实测 ${r.min}–${r.max}，band [${r.tier.band}]）`);
  check(r.p50 >= r.tier.band[0] && r.p50 <= r.tier.band[1], `${r.tier.name}: p50 ${r.p50} 不在带 [${r.tier.band}] 里`);
}
// 闸 3：阶梯严格递增；带本身的位置也得单调（和 tools/engine-test.mjs 的结构断言同向）
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1];
  const b = rows[i];
  check(b.p50 > a.p50, `阶梯断了：${a.tier.name} p50 ${a.p50} ≥ ${b.tier.name} p50 ${b.p50}`);
  check(b.tier.band[0] >= a.tier.band[0], `${b.tier.name} 带下沿 ${b.tier.band[0]} 比 ${a.tier.name} 的 ${a.tier.band[0]} 还低`);
  check(b.tier.band[1] >= a.tier.band[1], `${b.tier.name} 带上沿 ${b.tier.band[1]} 比 ${a.tier.name} 的 ${a.tier.band[1]} 还低`);
  check(b.min >= a.min, `${b.tier.name} 实测 min ${b.min} 比 ${a.tier.name} 的 ${a.min} 低：档位轴的方向可疑`);
}
// 缺陷类必须为零：generateOne 文档把「删完线索推不完」「穷举不认同」定为缺陷/绝不出货类
check(totals.prunedNotPencil === 0, `删线索后推不完 ${totals.prunedNotPencil} 次 —— 闸门漏了，属缺陷`);
check(totals.crossFail === 0, `穷举不认同 ${totals.crossFail} 次 —— 要么引擎有洞，要么对账预算 ${CROSS_BUDGET} 不够，两种都得查`);
// 每档至少动用过 bridge（tier 5）之外还要有浅规则在场：只剩尺寸撑分就测不到脑子
for (const r of rows) {
  check(r.rules.length >= 3, `${r.tier.name}: 只出场了 ${r.rules.length} 条规则（${r.rules.join(',')}），分数只剩盘大小在撑`);
}

// 每格分（score/格）是「同size谁更费脑子」的那根读数 —— scoreOf 的文档要求两边都摆出来。
const cellP50s = rows.map((r) => r.cellP50);
const cellMonotone = cellP50s.every((v, i) => i === 0 || v > cellP50s[i - 1]);
console.log(`\n  每格分 p50 阶梯：${cellP50s.map((v, i) => `${rows[i].tier.name} ${v.toFixed(3)}`).join(' · ')}`);
console.log(cellMonotone
  ? '  每格分同样递增：难度不只是尺寸'
  : '  注：每格分不单调 —— 原始分递增有尺寸贡献在，阶梯主要由「更大的盘 + 更多出手」撑起，两列都要看（见 scoreOf 注释）');

const wallMs = performance.now() - wallT0;
// ---------- 时延尾巴走 stderr：墙钟进不了逐字节复跑的 stdout ----------
console.error('\n== 出题墙钟（stderr：不可复跑所以不进 stdout 闸；双峰分布，基线看 p95 绝对值，不设中位×2 的 budgetMs）==');
for (const r of rows) {
  console.error(`  ${r.tier.name} ${r.tier.w}×${r.tier.h}: ms p50 ${r.ms50.toFixed(1)} · p90 ${r.ms90.toFixed(1)} · p95 ${r.ms95.toFixed(1)} · 该档合计 ${(r.msSum / 1000).toFixed(1)} s`);
}
console.error(`  出题墙钟合计 ${(msAll.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s · 端到端 ${(wallMs / 1000).toFixed(1)} s（含逐题复解重验与穷举对账）`);

console.log(`\n结论：${failures.length ? `${failures.length} 项未过 —— band 与实测脱节或阶梯断了，见上文 ✗` : '门禁全过：五档全出货、入带率 100%、p50 严格递增'}`);
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length ? 1 : 0);
