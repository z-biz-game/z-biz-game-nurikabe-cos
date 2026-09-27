// 数墙 · 出题器（solution-first）
//
// 流程只有四步，每一步都可证：
//   ① 先种一个**合法的完整盘**（黑白分配满足三条规则），于是"有解"这件事从出生起就成立；
//   ② 由这个盘读出线索：每个白岛多大就写多大，数字落在岛里随机一格；
//   ③ 贪心删线索：每删一条，都把铅笔路径 `solve()` 从头再跑一遍，推不完就撤回 ——
//      所以出货的盘**保证**零猜测（玩家手上有的那七条规则，一条不多一条不少就能走到底）；
//   ④ 交给第二套实现 count.js 穷举对账：解数必须是 1，而且它找到的那个解要和 solve() 逐格相同。
//
// "铅笔推得完 ⟹ 唯一解"是数学上的必然（每条铅笔规则写下的格子在该盘面的每一个解里都成立，
// 全推完就只剩一个解），但 ④ 不是多余的仪式：它盯的是"规则实现有没有写错"这件事本身。
// 可靠性模糊测试（tools/engine-test.mjs）里那条"推完了但穷举说有两个解"的计数器必须为 0。
//
// 难度不是猜的：③ 之后用 solve() 的出手记录量一个分（见 scoreOf 与 tools/balance.mjs）。

import { createBoard, solve, verify, cluesFrom, WHITE, BLACK } from './nurikabe.js';
import { countSolutions, asNurikabe, UNIQUE, NONE, MANY, OVERBUDGET } from './count.js';
import { makeRng } from './rng.js';

// ---------- 档位：尺寸 × 岛的大小，是分难度的两根轴 ----------
// band 是"量出来的"分数区间，初值来自 tools/balance.mjs 的实测分位数，改轴必须重量。
//
// ⚠ 岛那根轴（maxIsland）只推到 4，不是随手写的：数墙出货的第一道闸门是"**满线索盘**铅笔推得完"
// （下面 generateOne 里的 fullNotPencil），岛越大这块盘越推不完，重试次数跟着爆。
// 实测（24 局/档，seed=`final.<档>.<i>`，见 fix 提交里的记录）：
//   5×5 岛≤3  24/24，分 34.5–42.5      6×6 岛≤4 24/24，分 51–59.5
//   7×7 岛≤4  24/24，分 71–80          8×8 岛≤4 24/24，分 90–100（重试峰值 244）
//   10×10 岛≤4 24/24，分 140.5–151.5（重试峰值 281）
//   —— 而 8×8 岛≤5 要 1000 次重试才勉强出满、10×10 岛≤5 在 1000 次下只出 21/24，
//   10×10 岛≤7（原来的写法）根本出货不了。岛轴只能停在 4，尺寸与黑密度那两根继续往上走。
export const TIERS = [
  {
    key: 'novice',
    name: '初学',
    w: 5,
    h: 5,
    maxIsland: 3,
    blackRatio: 0.6,
    minClues: 5,
    attempts: 200,
    band: [30, 48],
  },
  {
    key: 'skilled',
    name: '熟手',
    w: 6,
    h: 6,
    maxIsland: 4,
    blackRatio: 0.56,
    minClues: 6,
    attempts: 200,
    band: [46, 66],
  },
  {
    key: 'regular',
    name: '常规',
    w: 7,
    h: 7,
    maxIsland: 4,
    blackRatio: 0.54,
    minClues: 7,
    attempts: 300,
    band: [66, 88],
  },
  {
    key: 'expert',
    name: '高手',
    w: 8,
    h: 8,
    maxIsland: 4,
    blackRatio: 0.55,
    minClues: 8,
    attempts: 500,
    band: [85, 110],
  },
  {
    key: 'master',
    name: '大师',
    w: 10,
    h: 10,
    maxIsland: 4,
    blackRatio: 0.6,
    minClues: 10,
    attempts: 700,
    band: [133, 165],
  },
];

export const tierByKey = (key) => TIERS.find((t) => t.key === key) || null;
export const tierByName = (name) => TIERS.find((t) => t.name === name) || null;

// ---------- ① 种盘 ----------

function squareFullOK(isBlack, sq, u) {
  // 把 u 涂黑之后，任何一个 2×2 都不能四格全黑
  for (const s of sq) {
    if (s.indexOf(u) < 0) continue;
    let k = 0;
    for (const c of s) if (c !== u && isBlack[c]) k++;
    if (k >= 3) return false;
  }
  return true;
}

function groupsOf(board, cell, want) {
  const { n, nbr } = board;
  const seen = new Uint8Array(n);
  const out = [];
  for (let t = 0; t < n; t++) {
    if (cell[t] !== want || seen[t]) continue;
    const g = [];
    const stack = [t];
    seen[t] = 1;
    while (stack.length) {
      const c = stack.pop();
      g.push(c);
      for (const u of nbr[c]) if (cell[u] === want && !seen[u]) {
        seen[u] = 1;
        stack.push(u);
      }
    }
    out.push(g);
  }
  return out;
}

/**
 * 长出一块合法的黑墙：从随机一格开始，只往"贴着一格黑、又不会凑成 2×2 全黑"的地方长。
 * 连片是构造出来的，2×2 是逐格守出来的，所以黑墙那条规则永远成立；剩下的白格自然成岛。
 * 白岛太大时往里补黑（补的格子必须贴着已有黑块，所以连通性不会断）。
 * @returns {Uint8Array|null} WHITE/BLACK 数组，失败返回 null
 */
export function plant(w, h, rand, { blackRatio = 0.55, maxIsland = 5, tries = 300 } = {}) {
  const board = createGeometry(w, h);
  const { n, nbr, sq } = board;
  for (let attempt = 0; attempt < tries; attempt++) {
    const isBlack = new Uint8Array(n);
    let count = 0;
    const target = Math.max(2, Math.round(n * blackRatio));
    const start = rand.int(n);
    isBlack[start] = 1;
    count++;
    //  frontier：贴着黑块的白格
    const frontier = new Set(nbr[start]);
    while (count < target && frontier.size) {
      const list = [];
      for (const u of frontier) if (!isBlack[u] && squareFullOK(isBlack, sq, u)) list.push(u);
      if (!list.length) break;
      const c = rand.pick(list);
      isBlack[c] = 1;
      count++;
      for (const u of nbr[c]) if (!isBlack[u]) frontier.add(u);
      frontier.delete(c);
    }
    if (count < Math.ceil(target * 0.8)) continue;
    // 把超标的白岛切开
    let guard = 0;
    let ok = true;
    for (;;) {
      if (++guard > n * 4) {
        ok = false;
        break;
      }
      const land = new Uint8Array(n);
      for (let t = 0; t < n; t++) land[t] = isBlack[t] ? BLACK : WHITE;
      const whites = groupsOf(board, land, WHITE);
      const big = whites.filter((g) => g.length > maxIsland);
      if (!big.length) break;
      const g = rand.pick(big);
      const cands = g.filter((u) => squareFullOK(isBlack, sq, u) && nbr[u].some((v) => isBlack[v]));
      if (!cands.length) {
        ok = false;
        break;
      }
      isBlack[rand.pick(cands)] = 1;
    }
    if (!ok) continue;
    const land = new Uint8Array(n);
    for (let t = 0; t < n; t++) land[t] = isBlack[t] ? BLACK : WHITE;
    const whites = groupsOf(board, land, WHITE);
    if (whites.length < 2) continue;
    if (whites.some((x) => x.length > maxIsland)) continue;
    // 黑墙连片是构造保证的，但"构造保证"也要有人复核一遍（这里用最笨的 BFS）
    const blacks = groupsOf(board, land, BLACK);
    if (blacks.length !== 1) continue;
    if (sq.some((s) => s.every((c) => land[c] === BLACK))) continue;
    return land;
  }
  return null;
}

function createGeometry(w, h) {
  const n = w * h;
  const nbr = [];
  for (let t = 0; t < n; t++) {
    const x = t % w;
    const y = (t / w) | 0;
    const o = [];
    if (y > 0) o.push(t - w);
    if (x > 0) o.push(t - 1);
    if (x < w - 1) o.push(t + 1);
    if (y < h - 1) o.push(t + w);
    nbr.push(o);
  }
  const sq = [];
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const a = y * w + x;
      sq.push([a, a + 1, a + w, a + w + 1]);
    }
  }
  return { w, h, n, nbr, sq };
}

// ---------- ③ 删线索（每删一条都重跑铅笔路径） ----------

/** 铅笔路径能不能从空盘推到满盘；推完返回 {board, result}，否则 null。 */
export function pencilRun(w, h, clue) {
  let board = null;
  try {
    board = createBoard({ w, h, clue });
  } catch (e) {
    return null; // 数字和超了、盘上没数字……都不可能是能出货的线索集
  }
  const result = solve(board);
  if (result.conflict || !result.ok) return null;
  if (verify(board, result.cell).length) return null; // 推满了却过不了独立验收 —— 引擎缺陷，绝不放行
  return { board, result };
}

/**
 * 贪心删线索：把数字排个随机顺序，逐个试着拿掉；拿掉后铅笔路径仍然推得完才真的拿掉。
 * 反复过几轮（顺序换了，前面拿不掉的后面可能就拿得掉了），直到一轮里什么都没删掉。
 *
 * ⚠ 数墙删线索和别的谜题不一样：拿掉一个数字之后，**答案也会变**。
 * 那块没了数字的白岛要么并进隔壁的岛、要么整个塌成墙 —— 所以种下的那个盘不再是一个解
 * （4×4 全枚举里 2108/6000 个"删过线索"的盘干脆一个解都没有，就是这个原因）。
 * 结论有两条：① lot 里只存 clue，解一律由 solve() 现场推，绝不要把种盘当答案存起来；
 * ② 删线索之后必须重新跑一次穷举对账，不能沿用满线索盘那次结论。
 *
 * @param {(clue: Uint8Array, rest: number) => boolean} extraGate 额外闸门（rest = 删掉这一条之后还剩几条）
 */
export function pruneClues(w, h, clue, rand, { passes = 6, extraGate = null } = {}) {
  const out = Uint8Array.from(clue);
  let deleted = 0;
  let kept = 0;
  for (let p = 0; p < passes; p++) {
    const idxs = [];
    for (let t = 0; t < out.length; t++) if (out[t] > 0) idxs.push(t);
    if (idxs.length <= 1) break;
    rand.shuffle(idxs);
    let changedThisPass = 0;
    for (const t of idxs) {
      const saved = out[t];
      out[t] = 0;
      let rest = 0;
      for (let i = 0; i < out.length; i++) if (out[i] > 0) rest++;
      if (extraGate && !extraGate(out, rest)) {
        out[t] = saved;
        kept++;
        continue;
      }
      if (pencilRun(w, h, out)) {
        changedThisPass++;
        deleted++;
      } else {
        out[t] = saved;
        kept++;
      }
    }
    if (!changedThisPass) break;
  }
  return { clue: out, deleted, trials: deleted + kept };
}

// ---------- 难度分 ----------

/**
 * 难度分：Σ(规则权重 × 出手次数) + 0.5 × 回扫轮数。
 * ⚠ 它是**规模相关**的量 —— 盘大一倍、格子多一倍，出手次数就多一倍，分自然高。
 * 所以 balance.mjs 除了原始分还要打印"每格分"（score / 格数）这一列：那才是"同样大的盘
 * 谁更费脑子"的比较。两边的数都要摆出来，只报原始分就是拿尺寸冒充难度。
 */
export function scoreOf(result, board = null) {
  const cells = board ? board.n : result.cell.length;
  return {
    score: result.score,
    perCell: Math.round((result.score / cells) * 1000) / 1000,
    cells,
    steps: result.steps,
    sweeps: result.sweeps,
    topTier: result.topTier,
    breakdown: result.breakdown,
  };
}

// ---------- ④ 独立对账 ----------

/**
 * count.js 穷举对账：解数必须是 1，且它给出的那个解要和 solve() 逐格一致。
 * @returns {{level:'count'|'pencil', unique:boolean, status:string, mismatch:number, nodes:number}}
 * level='count' 表示穷举器真的跑完了（唯一解被第二套实现独立确认）；
 * level='pencil' 表示穷举器超预算 —— 唯一性只剩铅笔证明这一条腿，报告里要如实分开。
 */
export function crossCheck(w, h, clue, solvedCell, { budget = 1500000 } = {}) {
  const c = countSolutions({ w, h, clue }, { cap: 2, budget });
  if (c.status === OVERBUDGET) {
    return { level: 'pencil', unique: false, status: OVERBUDGET, mismatch: -1, nodes: c.nodes };
  }
  if (c.status !== UNIQUE) {
    return { level: 'count', unique: false, status: c.status, mismatch: -1, nodes: c.nodes };
  }
  const ref = asNurikabe(c.first);
  let mismatch = 0;
  for (let t = 0; t < ref.length; t++) if (ref[t] !== solvedCell[t]) mismatch++;
  return { level: 'count', unique: mismatch === 0, status: UNIQUE, mismatch, nodes: c.nodes };
}

/**
 * 出一局：种 → 读线索 → 删线索 → 铅笔验收 → 穷举对账。
 * 失败一定带 reason，且 reason 是分开的四类 —— 它们各自指向不同的毛病：
 *   planted-none       轴给得太狠，连合法盘都种不出来
 *   full-not-pencil    满线索盘本身就推不完（这条轴不适配这套规则集）
 *   pruned-not-pencil  删线索之后推不完（闸门漏了，属于缺陷）
 *   not-enough-clues   岛太少：满线索盘的数字数都够不到这一档的下限（轴要改，不是重试能解决的）
 *   cross-check        穷举器说不是唯一解，或和 solve() 逐格不一致 —— 绝不出货
 *   band               分数不在档位区间里（挑题用，不是缺陷）
 *   attempts-exhausted 试完了都没成，带 stats
 */
export function generateOne(spec = {}) {
  const {
    w = 6,
    h = 6,
    maxIsland = 5,
    blackRatio = 0.55,
    minClues = 4,
    seed = 1,
    attempts = 60,
    band = null,
    cross = true,
    budget = 1500000,
  } = spec;
  const stats = {
    attempts: 0,
    plantFail: 0,
    fullNotPencil: 0,
    fewClues: 0,
    prunedNotPencil: 0,
    crossFail: 0,
    bandMiss: 0,
  };
  for (let a = 0; a < attempts; a++) {
    stats.attempts++;
    const rand = makeRng(`${seed}#${a}`);
    const land = plant(w, h, rand, { blackRatio, maxIsland, tries: 60 });
    if (!land) {
      stats.plantFail++;
      continue;
    }
    const full = cluesFrom(w, h, land, (g) => rand.pick(g));
    const base = pencilRun(w, h, full);
    if (!base) {
      stats.fullNotPencil++;
      continue;
    }
    let fullCount = 0;
    for (let t = 0; t < full.length; t++) if (full[t] > 0) fullCount++;
    if (fullCount < minClues) {
      // 一块盘的线索数上限就是白岛块数（一岛一个数字，删只会更少）—— 够不到下限就别再试了
      stats.fewClues++;
      continue;
    }
    const pr = pruneClues(w, h, full, rand, { extraGate: (clue, rest) => rest >= minClues });
    const done = pencilRun(w, h, pr.clue);
    if (!done) {
      stats.prunedNotPencil++;
      continue;
    }
    let clues = 0;
    for (let t = 0; t < pr.clue.length; t++) if (pr.clue[t] > 0) clues++;
    if (clues < minClues) {
      stats.fewClues++;
      continue;
    }
    let crossInfo = null;
    if (cross) {
      // 注意对账用的是**删完之后**的 clue 和它自己的 solve 结果 —— 满线索那次结论沿用不了
      crossInfo = crossCheck(w, h, pr.clue, done.result.cell, { budget });
      if (!crossInfo.unique) {
        stats.crossFail++;
        continue;
      }
    }
    const m = scoreOf(done.result, done.board);
    if (band && (m.score < band[0] || m.score > band[1])) {
      stats.bandMiss++;
      continue;
    }
    return {
      ok: true,
      w,
      h,
      clue: Array.from(pr.clue),
      clues,
      deleted: pr.deleted,
      score: m.score,
      perCell: m.perCell,
      steps: m.steps,
      sweeps: m.sweeps,
      topTier: m.topTier,
      breakdown: m.breakdown,
      cross: crossInfo,
      stats,
    };
  }
  // reason 取"走得最远的那一步"：如果每次都过了种盘和铅笔、只在分数区间外，
  // 那要报 band 而不是把前面某个偶发的失败当结论 —— 报错了名字就会把人引去修错的地方。
  const ladder = [
    ['planted-none', 'plantFail'],
    ['full-not-pencil', 'fullNotPencil'],
    ['not-enough-clues', 'fewClues'],
    ['pruned-not-pencil', 'prunedNotPencil'],
    ['cross-check', 'crossFail'],
    ['band', 'bandMiss'],
  ];
  let reason = 'attempts-exhausted';
  for (const [name, key] of ladder) if (stats[key] > 0) reason = name;
  return { ok: false, reason, stats };
}

/** 采一批候选，挑分数最靠近 target 的那个（bake 按档位挑题用）。 */
export function bestOf(spec = {}) {
  const { samples = 8, target = null, band = null, ...rest } = spec;
  const pool = [];
  for (let i = 0; i < samples; i++) {
    const g = generateOne({ ...rest, band, seed: `${rest.seed || 0}~${i}` });
    if (g.ok) pool.push(g);
    if (target !== null && pool.length && Math.abs(pool[pool.length - 1].score - target) < 0.001) break;
  }
  if (!pool.length) return { ok: false, reason: 'no-sample', pool };
  if (target === null) return { ...pool[0], pool };
  pool.sort((a, b) => Math.abs(a.score - target) - Math.abs(b.score - target));
  // pool 要带出去：测试和 balance 都得能复核"挑中的这个确实是这批里离目标最近的"，
  // 只回一个数就只能信我嘴上说了。
  return { ...pool[0], pool };
}

export { NONE, MANY, OVERBUDGET, UNIQUE };
