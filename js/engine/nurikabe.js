// 数墙 · Nurikabe 引擎（铅笔路径）
//
// 规则（Nikoli 原版，三条）：
//   1. 数字 N 所在的白格岛（含该数字格）恰好 N 格，一个岛里只有一个数字，岛内四连通；
//   2. 所有黑格（墙）彼此四连通，成一整块；
//   3. 不允许任何 2×2 的格子全黑。
//
// 下面这套 `solve()` 是"玩家也会走的那条路"：它只做局部推导，绝不回溯、绝不看玩家落了什么，
// 所以它同时是 ① 生成阶段的验收（推得完才出货）、② 提示的唯一来源、③ 难度分的测量口径。
// 每一条规则写下的格子都在该盘面的**每一个解**里成立 —— 这是 `tools/engine-test.mjs` 里
// 那条"用穷举器逐解对账"的模糊测试所要证明的唯一一件事。
//
// 与 js/engine/count.js 的关系：那份穷举实现不 import 这里的任何一个常量、规则或几何表，
// 两边的表各自手抄一份；共享了就只是自己跟自己一致（见 DESIGN §3）。

export const UNKNOWN = 0;
export const WHITE = 1; // 岛
export const BLACK = 2; // 墙
// 数墙的数字 ≥ 1，所以 0 可以当"这格没有数字"。注意它和 cell 的 UNKNOWN=0 是两回事：
// 一个是线索表的哨兵，一个是玩家盘面的哨兵（见 DESIGN §2 那条踩过的坑）。
export const NO_NUMBER = 0;
// 岛的编号从 0 开始，所以"还没有归属"必须是 -1，不能是 0 —— 0 号岛的格会被当成无主。
export const NO_OWNER = -1;
// 已经判明白格、但还不属于任何有数字的岛：它必须和某个岛连上才算数。
export const FREE_WHITE = -2;

export const FIRST_ISLAND = 0;

export const colorName = (v) => (v === WHITE ? '白' : v === BLACK ? '黑' : '未定');

export function otherColor(v) {
  return v === WHITE ? BLACK : WHITE;
}

// ---------- 盘面 ----------

export function createBoard({ w, h, clue }) {
  // 只挡"根本没有格子的盘"：1×N 这类窄盘在数墙里没什么可玩的，但它是合法的几何，
  // 该不该出题是 solve/verify/生成器的事，不该由建盘这一步偷偷替玩家做主。
  if (!(w > 0 && h > 0)) throw new Error('board too small');
  const n = w * h;
  if (!clue || clue.length !== n) throw new Error('clue length mismatch');
  const numbers = [];
  const islandAt = new Int16Array(n).fill(NO_OWNER);
  let sum = 0;
  for (let t = 0; t < n; t++) {
    const v = clue[t];
    if (v === NO_NUMBER) continue;
    if (v < 1 || v > n) throw new Error(`${cellName(w, t)} 写着 ${v}，数墙的数字必须在 1 与 ${n} 之间`);
    islandAt[t] = numbers.length;
    numbers.push({ cell: t, size: v, idx: numbers.length });
    sum += v;
  }
  if (!numbers.length) throw new Error('盘上没有数字');
  if (sum > n) throw new Error(`数字之和 ${sum} 已超过格数 ${n}，岛放不下`);

  const nbr = [];
  for (let t = 0; t < n; t++) nbr.push(neighboursOf(w, h, t));
  const sq = [];
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const a = y * w + x;
    sq.push([a, a + 1, a + w, a + w + 1]);
  }
  const sqTouch = nbr.map(() => []);
  for (const s of sq) for (const t of s) sqTouch[t].push(s);

  return {
    w,
    h,
    n,
    clue: Uint8Array.from(clue),
    numbers,
    islandAt,
    nbr,
    sq,
    sqTouch,
    clues: numbers.length,
    whiteTotal: sum, // 任何解里白格总数都等于数字之和 —— 黑格数 = n - whiteTotal
    blackTotal: n - sum,
    cellName: (t) => cellName(w, t),
    sizeOf: (idx) => numbers[idx].size,
  };
}

export function neighboursOf(w, h, t) {
  const x = t % w;
  const y = (t / w) | 0;
  const out = [];
  if (y > 0) out.push(t - w);
  if (x > 0) out.push(t - 1);
  if (x < w - 1) out.push(t + 1);
  if (y < h - 1) out.push(t + w);
  return out;
}

export function cellName(w, t) {
  return `第${((t / w) | 0) + 1}行${(t % w) + 1}列`;
}

export const manhattan = (w, a, b) =>
  Math.abs((a % w) - (b % w)) + Math.abs(((a / w) | 0) - ((b / w) | 0));

// ---------- 通用图工具（每次推导都按当前盘面重算，盘最大 100 格） ----------

// 从若干源点出发、只能走 passable(u) 的格，返回每格的最短步数（走不到 = Infinity）。
function bfsDist(board, seeds, passable, limit = Infinity) {
  const dist = new Int32Array(board.n).fill(-1);
  const queue = [];
  for (const s of seeds) {
    if (s == null || s < 0) continue;
    dist[s] = 0;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    if (dist[t] >= limit) continue;
    for (const u of board.nbr[t]) {
      if (dist[u] === -1 && passable(u)) {
        dist[u] = dist[t] + 1;
        queue.push(u);
      }
    }
  }
  return dist;
}

const unreachable = (d, t) => d[t] < 0;

// 同色块（白格块 / 黑格块）
function colorGroups(board, cell, want) {
  const seen = new Uint8Array(board.n);
  const out = [];
  for (let t = 0; t < board.n; t++) {
    if (cell[t] !== want || seen[t]) continue;
    const group = [];
    const stack = [t];
    seen[t] = 1;
    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      for (const u of board.nbr[c]) if (cell[u] === want && !seen[u]) {
        seen[u] = 1;
        stack.push(u);
      }
    }
    out.push(group);
  }
  return out;
}

// ---------- 规则表 ----------
// weight 是这条规则在难度分里占的分量：越"要看得见全局"的规则越贵。
// text(board, d) 是提示要说的那句话 —— 玩家看到的解释和引擎写下的格子来自同一个 d。
export const Rules = {
  number: {
    key: 'number',
    name: '数字即白',
    tier: 1,
    weight: 1,
    text: (b, d) => `${b.cellName(d.cell)} 写着 ${b.clue[d.cell]}：这个格子自己就是岛的一格，只能是白格`,
  },
  full: {
    key: 'full',
    name: '满岛圈墙',
    tier: 2,
    weight: 1.5,
    text: (b, d) =>
      `${b.cellName(d.number)} 的岛已经凑满 ${d.size} 格，它四周未定的格再涂白就成 ${d.size + 1} 格了 —— 只能全黑`,
  },
  clash: {
    key: 'clash',
    name: '两岛相逼',
    tier: 3,
    weight: 2,
    text: (b, d) =>
      `${b.cellName(d.cell)} 同时挨着 ${b.cellName(d.a)}（${b.clue[d.a]} 格的岛）和 ${b.cellName(d.b)}（${b.clue[d.b]} 格的岛）的白格：它一白，两个岛就并成一个，只能黑`,
  },
  reach: {
    key: 'reach',
    name: '够不着即黑',
    tier: 2,
    weight: 1.5,
    text: (b, d) =>
      d.fields === 0
        ? `数墙的白格必须属于某个有数字的岛：这会儿每个岛都凑满了，${b.cellName(d.cell)} 再白也没有岛可去，只能黑`
        : `${b.cellName(d.cell)} 到最近那个还没满的岛还差 ${d.gap} 格，那点空位装不下它 —— 白格没有岛可去，只能黑`,
  },
  three: {
    key: 'three',
    name: '三黑补白',
    tier: 2,
    weight: 1.5,
    text: (b, d) => `${b.cellName(d.cell)} 所在的那个 2×2 已经黑了三格，第四格必须留白，否则就成了二二全黑`,
  },
  fill: {
    key: 'fill',
    name: '岛地必满',
    tier: 4,
    weight: 2.5,
    text: (b, d) =>
      `${b.cellName(d.number)} 的岛要 ${d.size} 格，而它周围还没被墙围死的格子恰好只剩 ${d.size} 格 —— 这一片必须全白`,
  },
  bridge: {
    key: 'bridge',
    name: '孤墙必连',
    tier: 5,
    weight: 3,
    text: (b, d) =>
      `${b.cellName(d.cell)} 一旦涂白，${b.cellName(d.a)} 那一片墙就和 ${b.cellName(d.b)} 那一片永久断开了：墙必须是一整块，所以它是桥，必黑`,
  },
};

export const RULE_ORDER = ['number', 'full', 'clash', 'reach', 'three', 'fill', 'bridge'];

// ---------- 归属合并（不是"规则"，是记账） ----------
// 相邻的两个白格必然同属一个岛，所以白格的岛编号要顺着扩散一遍。
// 这一步不改变颜色，因此不会成为提示的一条，但它决定"这个岛现在几格了"。
function consolidate(board, cell, owner) {
  let changed = true;
  let rounds = 0;
  while (changed) {
    if (++rounds > board.n + 2) return { conflict: '归属合并没收敛（引擎缺陷）' };
    changed = false;
    for (let t = 0; t < board.n; t++) {
      if (cell[t] !== WHITE) continue;
      if (board.islandAt[t] >= 0 && owner[t] !== board.islandAt[t]) owner[t] = board.islandAt[t];
      const mine = owner[t];
      let adopt = NO_OWNER;
      for (const u of board.nbr[t]) {
        if (cell[u] !== WHITE) continue;
        const theirs = board.islandAt[u] >= 0 ? board.islandAt[u] : owner[u];
        if (theirs === FREE_WHITE || theirs === NO_OWNER) continue;
        if (mine >= 0 && theirs >= 0 && mine !== theirs) {
          return {
            conflict: `${board.cellName(t)} 和它的白格邻居分属两个岛（${board.cellName(board.numbers[mine].cell)} 与 ${board.cellName(board.numbers[theirs].cell)} 并成了一个岛）`,
            cell: t,
          };
        }
        if (mine < 0 && theirs >= 0) adopt = theirs;
      }
      if (mine < 0 && adopt >= 0) {
        owner[t] = adopt;
        changed = true;
      }
    }
  }
  return { changed: rounds > 1 };
}

// ---------- 一次推导扫描 ----------
// 每条规则写下的格子，都只由"它自己那几条局部事实"决定，所以在盘面的每一个解里都成立。
export function propagate(board, cell, owner) {
  const found = [];
  let changed = false;
  let conflict = null;

  const write = (t, to, own, rule, detail) => {
    if (conflict) return false;
    if (cell[t] !== UNKNOWN) {
      if (cell[t] === to) {
        // 颜色已经对上：只有"归属第一次定下来"才算推进（它决定后面几条规则看得见的格数）
        if (to === WHITE && own >= 0 && owner[t] < 0) {
          owner[t] = own;
          changed = true;
        }
        return true;
      }
      conflict = `${board.cellName(t)} 已经是${colorName(cell[t])}色，可${rule.name}说它必须是${colorName(to)}色`;
      conflict += `（${rule.text(board, { ...detail, cell: t })}）`;
      return false;
    }
    cell[t] = to;
    owner[t] = to === WHITE ? own : NO_OWNER;
    found.push({ ...detail, cell: t, value: to, owner: owner[t], rule });
    changed = true;
    return true;
  };

  const known = () => {
    const sets = board.numbers.map(() => []);
    for (let t = 0; t < board.n; t++) if (cell[t] === WHITE && owner[t] >= 0) sets[owner[t]].push(t);
    return sets;
  };

  // ① 数字即白
  for (const num of board.numbers) {
    if (cell[num.cell] === BLACK) {
      conflict = `${board.cellName(num.cell)} 被涂黑了，可它写着 ${num.size} —— 数字格本身就是岛的一格`;
      return { found, changed, conflict };
    }
    if (!write(num.cell, WHITE, num.idx, Rules.number, { number: num.cell, size: num.size })) return { found, changed, conflict };
  }
  let sets = known();

  // ② 满岛圈墙：岛凑满 N 格 → 四周未定的格全黑
  for (const num of board.numbers) {
    const cells = sets[num.idx];
    if (cells.length > num.size) {
      conflict = `${board.cellName(num.cell)} 写着 ${num.size}，可它所在的岛已经有 ${cells.length} 格`;
      return { found, changed, conflict };
    }
    if (cells.length < num.size) continue;
    for (const t of cells) for (const u of board.nbr[t]) {
      if (cell[u] === UNKNOWN && !write(u, BLACK, NO_OWNER, Rules.full, { number: num.cell, size: num.size })) return { found, changed, conflict };
    }
  }
  sets = known();

  // ③ 两岛相逼：一格同时贴着两个岛的白格 → 必黑
  for (let t = 0; t < board.n; t++) {
    if (cell[t] !== UNKNOWN) continue;
    let a = -1;
    let b = -1;
    for (const u of board.nbr[t]) {
      if (cell[u] !== WHITE) continue;
      const o = owner[u] >= 0 ? owner[u] : board.islandAt[u];
      if (o < 0) continue;
      if (a < 0) a = o;
      else if (a !== o && b < 0) b = o;
      else if (b >= 0 && a !== o && b !== o) b = o;
    }
    if (a >= 0 && b >= 0 && a !== b) {
      if (!write(t, BLACK, NO_OWNER, Rules.clash, {
        a: board.numbers[a].cell,
        b: board.numbers[b].cell,
      })) return { found, changed, conflict };
    }
  }

  // ④ 够不着即黑：白格必须属于某个有数字的岛；每个岛都装不下它 → 必黑
  {
    const passableWhite = (idx) => (t) => cell[t] !== BLACK && (owner[t] < 0 || owner[t] === idx);
    // 每个还没满的岛：从它已知的白格出发、走"不撞墙也不穿别岛"的路，还能走多远
    const fields = [];
    for (const num of board.numbers) {
      const left = num.size - sets[num.idx].length;
      if (left <= 0) continue;
      const seeds = sets[num.idx].length ? sets[num.idx] : [num.cell];
      fields.push({ num, left, dist: bfsDist(board, seeds, passableWhite(num.idx)) });
    }
    for (let t = 0; t < board.n; t++) {
      if (cell[t] !== UNKNOWN) continue;
      let ok = false;
      let gap = null; // 最近的、还没满的岛还差几格才容得下它
      for (const f of fields) {
        if (unreachable(f.dist, t)) continue;
        if (f.dist[t] <= f.left) {
          ok = true;
          break;
        }
        const g = f.dist[t] - f.left;
        if (gap === null || g < gap) gap = g;
      }
      if (ok) continue;
      if (gap === null) gap = board.n; // 每个岛都被墙隔在外面
      if (!write(t, BLACK, NO_OWNER, Rules.reach, { cell: t, fields: fields.length, gap })) {
        return { found, changed, conflict };
      }
    }
  }

  // ⑤ 三黑补白：2×2 已有三黑 → 第四格必白
  for (const s of board.sq) {
    let blacks = 0;
    let free = -1;
    for (const t of s) {
      if (cell[t] === BLACK) blacks++;
      else if (cell[t] === UNKNOWN) free = t;
    }
    if (blacks === 4) {
      conflict = `${board.cellName(s[0])} 那一带 2×2 四格全黑了，数墙不许`;
      return { found, changed, conflict };
    }
    if (blacks === 3 && free >= 0) {
      if (!write(free, WHITE, FREE_WHITE, Rules.three, { cell: free })) return { found, changed, conflict };
    }
  }
  sets = known();

  // ⑥ 岛地必满：某岛能活动的非黑区恰好只剩 N 格 → 这些格全白
  for (const num of board.numbers) {
    const seeds = sets[num.idx].length ? sets[num.idx] : [num.cell];
    const others = (t) => cell[t] !== BLACK && !(owner[t] >= 0 && owner[t] !== num.idx);
    const dist = bfsDist(board, seeds, others, num.size + 1);
    const room = [];
    for (let t = 0; t < board.n; t++) if (dist[t] >= 0 && dist[t] <= num.size) room.push(t);
    // room 是"从这个岛出发、不穿别人的岛、走得到的格"。它比真正的活动域小，
    // 所以恰好等于 size 时那批格必须全白 —— 只要成立就是可写事实。
    if (room.length < num.size) {
      conflict = `${board.cellName(num.cell)} 的岛要 ${num.size} 格，可它四周没被墙围死的格子只剩 ${room.length} 格`;
      return { found, changed, conflict };
    }
    if (room.length > num.size) continue;
    for (const t of room) {
      if (cell[t] === UNKNOWN && !write(t, WHITE, num.idx, Rules.fill, { number: num.cell, size: num.size, cell: t })) return { found, changed, conflict };
    }
  }
  sets = known();

  // ⑦ 孤墙必连：一块未定格若是唯一能把两片墙接上的桥 → 必黑
  // 这里的"连通域"是**非白格**（黑 + 未定）的块：未定的格还有希望变黑，所以它算通路。
  // 把某个未定格 c 涂白之后，若这一块里的黑格分裂成两块以上、且每块都带着黑格，那这些黑格
  // 就再也接不上了（块外的格全是白格，白格不会变黑）—— 所以 c 必黑。
  {
    const seen = new Uint8Array(board.n);
    const comps = [];
    for (let t = 0; t < board.n; t++) {
      if (cell[t] === WHITE || seen[t]) continue;
      const comp = [];
      const stack = [t];
      seen[t] = 1;
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const u of board.nbr[c]) if (cell[u] !== WHITE && !seen[u]) {
          seen[u] = 1;
          stack.push(u);
        }
      }
      comps.push(comp);
    }
    const withBlack = comps
      .map((comp) => ({ comp, blacks: comp.filter((t) => cell[t] === BLACK) }))
      .filter((k) => k.blacks.length > 0);
    if (withBlack.length >= 2) {
      conflict = `墙被白格切成了 ${withBlack.length} 块（${board.cellName(withBlack[0].blacks[0])} 那一片和 ${board.cellName(withBlack[1].blacks[0])} 那一片再也接不上）`;
      return { found, changed, conflict };
    }
    for (const { comp, blacks } of withBlack) {
      if (blacks.length < 2) continue;
      const inComp = new Uint8Array(board.n);
      for (const t of comp) inComp[t] = 1;
      for (const c of comp) {
        if (cell[c] !== UNKNOWN) continue;
        // 把 c 当作已经涂白：从第一片黑格出发、还能走非白格到齐所有黑格吗
        const reach = bfsDist(board, [blacks[0]], (t) => inComp[t] && t !== c && cell[t] !== WHITE);
        let lost = -1;
        for (const b of blacks) if (unreachable(reach, b)) {
          lost = b;
          break;
        }
        if (lost < 0) continue;
        if (!write(c, BLACK, NO_OWNER, Rules.bridge, { cell: c, a: blacks[0], b: lost })) return { found, changed, conflict };
      }
    }
  }

  const merged = consolidate(board, cell, owner);
  if (merged.conflict) return { found, changed, conflict: merged.conflict };
  return { found, changed };
}

// 把 propagate 找到的一条事实包装成"步"：solve 的 rows 与 nextFact 的返回**必须是同一个形状**，
// 否则提示重放（UI 逐条演示、tools/engine-test 的对账）会拿着两套字段名各说各话。
// detail 指向这一行自己：rule.text(board, row.detail) 拿到的就是 {cell, value, number, gap, ...}。
const toRow = (f) => ({ cell: f.cell, value: f.value, owner: f.owner, rule: f.rule, detail: f });

// ---------- 铅笔路径：从空盘推到满盘 ----------
// rows 就是提示脚本：第 k 条是"线索已经能逼出的第 k 个事实"。
export function solve(board, { seed = null } = {}) {
  // 传进来的 owner 必须已经是合法形状（0 号岛是真的岛，不是"无主"）——
  // 早先这里写过一句 `if (owner[t] === UNKNOWN) owner[t] = NO_OWNER`，把 0 号岛的归属全抹了，
  // 于是所有 0 号岛相关的推导在带墨水的盘上静默失效。见 DESIGN §2。
  const cell = seed ? Uint8Array.from(seed.cell) : new Uint8Array(board.n);
  const owner = seed ? Int16Array.from(seed.owner) : new Int16Array(board.n).fill(NO_OWNER);
  const rows = [];
  const used = new Map();
  let sweeps = 0;
  let conflict = null;
  for (let guard = 0; guard < board.n * 6 + 40; guard++) {
    const pre = consolidate(board, cell, owner);
    if (pre.conflict) {
      conflict = pre.conflict;
      break;
    }
    const sweep = propagate(board, cell, owner);
    if (sweep.conflict) {
      conflict = sweep.conflict;
      break;
    }
    if (!sweep.changed) break;
    sweeps++;
    for (const f of sweep.found) {
      used.set(f.rule.key, (used.get(f.rule.key) || 0) + 1);
      rows.push(toRow(f));
    }
  }
  const filled = cell.every((v) => v !== UNKNOWN);
  let score = 0;
  for (const [name, n] of used) score += n * Rules[name].weight;
  if (conflict) {
    return { ok: false, conflict, cell, owner, rows, steps: rows.length, score: 0, breakdown: {}, sweeps, topTier: 0 };
  }
  let topTier = 0;
  for (const [key] of used) topTier = Math.max(topTier, Rules[key].tier);
  return {
    ok: filled,
    cell,
    owner,
    rows,
    steps: rows.length,
    score: Math.round((score + 0.5 * sweeps) * 10) / 10,
    raw: Math.round(score * 10) / 10,
    breakdown: Object.fromEntries(used),
    sweeps,
    topTier,
    depth: 0,
    backtracks: 0,
  };
}

// 下一步推得出什么（提示与 UI 用它；seed 传玩家的落子，于是它能说"这条推不下去了"）。
// 返回的形状和 solve().rows[k] 完全一样，所以"提示一条条重放"和"引擎自己推"是同一份脚本。
export function nextFact(board, cell, owner) {
  const c2 = Uint8Array.from(cell);
  const o2 = Int16Array.from(owner);
  const merged = consolidate(board, c2, o2);
  if (merged.conflict) return { conflict: merged.conflict };
  const sweep = propagate(board, c2, o2);
  if (sweep.conflict) return { conflict: sweep.conflict };
  return sweep.found.length ? toRow(sweep.found[0]) : null;
}

// ---------- 玩家的墨水还能不能收场 ----------
// 规则写下的每一格在所有解里成立，所以"逼出矛盾 ⟹ 确实无解"：这条警告不冤枉人。
// 反过来不成立（规则不完备），所以它只说"这些格和数字已经矛盾了"，绝不说"这样放是对的"。
export function reachable(board, cell, owner) {
  const c2 = Uint8Array.from(cell);
  const o2 = owner ? Int16Array.from(owner) : new Int16Array(board.n).fill(NO_OWNER);
  const probe = solve(board, { seed: { cell: c2, owner: o2 } });
  if (probe.conflict) return false;
  return true;
}

// ---------- 独立验收：只读盘面，按规则的原文查 ----------
// 这里绝不读 derived、也不读提示脚本，所以"提示逻辑写错"伪造不出一场胜利。
export function verify(board, cell) {
  const bad = [];
  for (let t = 0; t < board.n; t++) if (cell[t] === UNKNOWN) bad.push({ why: '还有未定的格', cell: t });
  for (const num of board.numbers) {
    if (cell[num.cell] === BLACK) bad.push({ why: '数字格被涂黑', cell: num.cell });
  }
  for (const group of colorGroups(board, cell, WHITE)) {
    const nums = group.filter((t) => board.clue[t] > 0);
    if (nums.length === 0) bad.push({ why: '岛没有数字', cell: group[0], cells: group });
    else if (nums.length > 1) bad.push({ why: '一个岛里两个数字', cell: nums[0], cells: group });
    else if (group.length !== board.clue[nums[0]]) {
      bad.push({
        why: group.length > board.clue[nums[0]] ? '岛超编' : '岛不够格',
        cell: nums[0],
        want: board.clue[nums[0]],
        have: group.length,
        cells: group,
      });
    }
  }
  for (const s of board.sq) if (s.every((t) => cell[t] === BLACK)) bad.push({ why: '2×2 全黑', cell: s[0], cells: s });
  const groups = colorGroups(board, cell, BLACK);
  if (groups.length >= 2) bad.push({ why: '墙断开了', cell: groups[0][0], pieces: groups.length });
  return bad;
}

export function complete(board, cell) {
  return verify(board, cell).length === 0 && cell.every((v) => v !== UNKNOWN);
}

// ---------- 界面读数 ----------
export function diagnose(board, cell) {
  let white = 0;
  let black = 0;
  let unknown = 0;
  for (let t = 0; t < board.n; t++) {
    if (cell[t] === WHITE) white++;
    else if (cell[t] === BLACK) black++;
    else unknown++;
  }
  const bad = verify(board, cell);
  const badCells = new Set();
  for (const b of bad) for (const t of b.cells || [b.cell]) if (t != null) badCells.add(t);
  const islands = [];
  const okIslands = new Set();
  for (const num of board.numbers) {
    const group = colorGroups(board, cell, WHITE).find((g) => g.includes(num.cell));
    const have = group ? group.length : 0;
    const closed = group ? group.every((t) => board.nbr[t].every((u) => cell[u] !== UNKNOWN)) : false;
    islands.push({ idx: num.idx, cell: num.cell, size: num.size, have, closed, ok: have === num.size && closed });
    if (have === num.size) okIslands.add(num.idx);
  }
  const wall = colorGroups(board, cell, BLACK);
  const wallDone = board.blackTotal > 0 && unknown === 0 && wall.length === 1;
  return {
    white,
    black,
    unknown,
    total: board.n,
    filled: board.n - unknown,
    clues: board.clues,
    islandsDone: islands.filter((i) => i.ok).length,
    okIslands,
    islands,
    wallPieces: wall.length,
    wallDone,
    badCells,
    problems: bad,
    conflicts: bad.filter((b) => b.why !== '还有未定的格').length,
  };
}

// ---------- 需要几层假设才推得完（只用于难度测量，出货的盘必须为 0） ----------
// 语义：铅笔推不动时，挑一个未定格分两支假设。
//   两支里一支逼出矛盾、另一支推得完  ⟹ 那一支其实是被规则**逼**出来的，深度沿用子问题带回来的数
//     （子调用按 depth+1 跑，那个数已经含着这一次假设了，别再给它 +1，否则一次假设会报成两次）；
//   两支都推得完                    ⟹ 这块盘至少两个解，标记 ambiguous（这种盘绝不出货）；
//   两支都死                        ⟹ 无解；
//   超出 maxDepth / 预算耗尽        ⟹ 'unknown'，不当作能推完。
// 所以 `solved && depth === 0` 才是真正的"零猜测"，而 depth>0 只是给难度分一个参考量。
export function analyse(board, { maxDepth = 3, budget = 6000 } = {}) {
  let nodes = 0;
  let backtracks = 0;
  let capped = false;

  function run(cell, owner, depth) {
    if (++nodes > budget) {
      capped = true;
      return { status: 'unknown', depth };
    }
    const r = solve(board, { seed: { cell, owner } });
    if (r.conflict) return { status: 'dead', depth };
    if (r.ok) return { status: 'solved', depth, steps: r.steps };
    if (depth >= maxDepth) return { status: 'unknown', depth };
    let pick = -1;
    for (let t = 0; t < board.n; t++) if (r.cell[t] === UNKNOWN) {
      pick = t;
      break;
    }
    if (pick < 0) return { status: 'unknown', depth };
    const branches = [];
    for (const v of [WHITE, BLACK]) {
      const c2 = Uint8Array.from(r.cell);
      const o2 = Int16Array.from(r.owner);
      c2[pick] = v;
      o2[pick] = v === WHITE ? FREE_WHITE : NO_OWNER;
      branches.push(run(c2, o2, depth + 1));
    }
    const [a, b] = branches;
    if (a.status === 'unknown' || b.status === 'unknown') return { status: 'unknown', depth };
    if (a.status === 'solved' && b.status === 'solved') {
      backtracks++;
      return { status: 'ambiguous', depth };
    }
    if (a.status === 'dead' && b.status === 'dead') return { status: 'dead', depth };
    const live = a.status === 'solved' ? a : b.status === 'solved' ? b : null;
    if (live) {
      backtracks++;
      // live.depth 已经含着"这一次假设"（子调用是按 depth+1 跑的），所以这里**不能再加一层** ——
      // 加了一次假设就说成两次，难度分里的 depth 会整体虚高一档。
      return { status: 'solved', depth: live.depth, steps: live.steps + r.steps };
    }
    // 一支 dead、另一支 ambiguous / unknown：不当"推得完"报告（宁可少报，也不虚报零猜测）
    return { status: 'unknown', depth };
  }

  const base = run(new Uint8Array(board.n), new Int16Array(board.n).fill(NO_OWNER), 0);
  return {
    solved: base.status === 'solved',
    ambiguous: base.status === 'ambiguous',
    status: base.status,
    capped,
    // solved:false 时这个数只是下界：真正需要的假设层数 > maxDepth
    depth: base.depth,
    backtracks,
    nodes,
  };
}

// ---------- 玩家盘面状态（含撤销栈） ----------
export function createState(board) {
  return { board, cell: new Uint8Array(board.n), owner: new Int16Array(board.n).fill(NO_OWNER), history: [] };
}

export function snapshot(st) {
  st.history.push({ cell: Uint8Array.from(st.cell), owner: Int16Array.from(st.owner) });
  if (st.history.length > 800) st.history.shift();
  return st;
}

export function undo(st) {
  const last = st.history.pop();
  if (!last) return false;
  st.cell.set(last.cell);
  st.owner.set(last.owner);
  return true;
}

export function setCell(st, t, value) {
  if (!st || t < 0 || t >= st.board.n) return false;
  if (st.board.clue[t] > 0 && value === BLACK) return false; // 数字格不许涂黑
  if (st.cell[t] === value) return false;
  snapshot(st);
  st.cell[t] = value;
  st.owner[t] = value === WHITE ? (st.board.islandAt[t] >= 0 ? st.board.islandAt[t] : FREE_WHITE) : NO_OWNER;
  return true;
}

// 单击循环：未定 → 白 → 黑 → 未定（数字格跳过白，因为它已经是白）
export function cycleCell(st, t) {
  const cur = st.cell[t];
  const next = cur === UNKNOWN ? WHITE : cur === WHITE ? BLACK : UNKNOWN;
  return setCell(st, t, next) ? next : null;
}

export function resetInk(st) {
  st.cell.fill(UNKNOWN);
  st.owner.fill(NO_OWNER);
  st.history.length = 0;
  return st;
}

// 由一个解（白/黑盘）读出它自己的数字：岛有多大就写多大 —— 出题时用它当"满线索盘"。
// where(group) 决定数字落在岛的哪一格（默认第一格）；出题时传一个随机位置，同一块解才能长出不同长相。
export function cluesFrom(w, h, land, where = null) {
  const clue = new Uint8Array(w * h);
  const n = w * h;
  const board = { w, h, n, nbr: [], clue };
  for (let t = 0; t < n; t++) board.nbr.push(neighboursOf(w, h, t));
  const groups = colorGroups(board, land, WHITE);
  for (const g of groups) clue[where ? where(g) : g[0]] = g.length;
  return clue;
}
