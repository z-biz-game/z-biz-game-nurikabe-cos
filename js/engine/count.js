// 数墙 · 独立穷举计数器（第二套互不信任的代码）
//
// This file answers exactly one question — how many completions does this clue set have, and what
// is one of them — by walking the cells in order and trying the states for each. It reads the
// rules of the game as written on paper and nothing else:
//
//   1. 每个数字所在的白岛（含数字格）恰好 N 格，且一岛只一个数字
//   2. 所有黑格四连通成一整块
//   3. 没有任何 2×2 全黑
//
// It shares no constants, no neighbour table, no rule and no helper with js/engine/nurikabe.js:
// the point of a second opinion is that a mistake in the first one cannot show up twice. Its cell
// encoding is deliberately *different* (LAND/SEA/TODO below, and LAND is 0 where the engine's
// WHITE is 1) so a stray import breaks loudly instead of agreeing by accident; `asNurikabe()` is
// the one documented translation layer.
//
// The board array is three-valued (TODO marks "not decided yet"), which is what lets the pruning
// say "this white group can still grow" rather than "this white group is finished". Pruning is
// only ever an optimisation: the leaf check below re-reads the three rules from scratch, so a bug
// in the incremental version changes the *cost*, not the answer.

export const LAND = 0; // 白格 / 岛
export const SEA = 1; // 黑格 / 墙
export const TODO = 2; // 还没落子

export const UNIQUE = 'UNIQUE';
export const MANY = 'MANY';
export const NONE = 'NONE';
export const OVERBUDGET = 'OVERBUDGET';

const NO_NUM = 0; // 数墙的数字 ≥ 1，所以 0 可以安全地表示"这格没有数字"

function neighboursOf(w, h, t) {
  const x = t % w;
  const y = (t / w) | 0;
  const out = [];
  if (y > 0) out.push(t - w);
  if (x > 0) out.push(t - 1);
  if (x < w - 1) out.push(t + 1);
  if (y < h - 1) out.push(t + w);
  return out;
}

function build(w, h, clue) {
  const n = w * h;
  if (clue.length !== n) throw new Error('count.js: clue length mismatch');
  const num = new Int32Array(n);
  const nbr = [];
  for (let t = 0; t < n; t++) {
    const v = clue[t];
    if (v < 0 || v > n) throw new Error(`count.js: 数字 ${v} 不可能出现在 ${n} 格的盘上`);
    num[t] = v;
    nbr.push(neighboursOf(w, h, t));
  }
  const sq = [];
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const a = y * w + x;
    sq.push([a, a + 1, a + w, a + w + 1]);
  }
  const sqTouch = nbr.map(() => []);
  for (const s of sq) for (const t of s) sqTouch[t].push(s);
  return { w, h, n, num, nbr, sq, sqTouch };
}

// The land group containing `seed`, as far as it is already written.
function group(B, A, seed) {
  const cells = [];
  const boundary = [];
  const seen = new Set([seed]);
  const stack = [seed];
  while (stack.length) {
    const t = stack.pop();
    cells.push(t);
    for (const u of B.nbr[t]) {
      if (A[u] === LAND) {
        if (!seen.has(u)) {
          seen.add(u);
          stack.push(u);
        }
      } else boundary.push(u);
    }
  }
  let numbers = 0;
  let want = 0;
  for (const t of cells) {
    if (B.num[t] > 0) {
      numbers++;
      want = B.num[t];
    }
  }
  return { cells, boundary, numbers, want };
}

// Is this group still growable? A boundary cell that is TODO may still become land.
function growable(B, A, g) {
  return g.boundary.some((u) => A[u] === TODO);
}

// Already-decided groups whose fate is sealed, judged so that no valid completion is ever pruned:
// a full group with a still-undecided boundary cell is *not* dead — that cell just has to turn sea.
function groupDead(B, A, g) {
  if (g.numbers > 1) return true; // 一岛两数，永远修不好
  if (g.numbers === 1) {
    if (g.cells.length > g.want) return true; // 超编
    if (g.cells.length === g.want) return false; // 刚好：剩下的边界格只能成墙
    return !growable(B, A, g); // 没满又封了口 → 长不出来了
  }
  return !growable(B, A, g); // 一格数字都没有，且已无路可长
}

function finalBad(B, A) {
  for (let t = 0; t < B.n; t++) {
    if (A[t] === TODO) return '还有未定的格';
    // 数字格自己必须是白格：它算在岛的 N 格里。漏了这条的话"数字落在墙上"的假解会被放过。
    if (A[t] === SEA && B.num[t] > 0) return `数字 ${B.num[t]} 写在了一格黑墙上 @${t}`;
  }
  for (const s of B.sq) if (s.every((u) => A[u] === SEA)) return `2×2 全黑 @${s[0]}`;
  const seen = new Uint8Array(B.n);
  for (let t = 0; t < B.n; t++) {
    if (A[t] !== LAND || seen[t]) continue;
    const g = group(B, A, t);
    for (const c of g.cells) seen[c] = 1;
    if (g.numbers !== 1) return `岛里数字数=${g.numbers} @${t}`;
    if (g.cells.length !== g.want) return `岛 ${g.cells.length} 格 / 数字 ${g.want} @${t}`;
  }
  // 黑格连通（零块/一格墙为空成立，与 nurikabe.js 同口径 —— 见 DESIGN §3）
  let first = -1;
  let total = 0;
  for (let t = 0; t < B.n; t++) if (A[t] === SEA) {
    total++;
    if (first < 0) first = t;
  }
  if (total > 1) {
    const reach = new Uint8Array(B.n);
    const stack = [first];
    reach[first] = 1;
    let k = 1;
    while (stack.length) {
      const t = stack.pop();
      for (const u of B.nbr[t]) if (A[u] === SEA && !reach[u]) {
        reach[u] = 1;
        k++;
        stack.push(u);
      }
    }
    if (k !== total) return '墙断成几块';
  }
  return null;
}

/**
 * @param {object} b     { w, h, clue } —— clue[t] = 0（无数字）或 N
 * @param {object} opts  { cap = 2, budget = 400000, prune = true, all = false }
 * all=true 时把找到的解都收进 `all`（给"逐解对账"的模糊测试用），此时 cap 一般给 Infinity。
 * 注意 all 只在解不多的小盘上用：数墙的组合空间是 2^(w*h)，大盘上枚举不完。
 * prune=false 走"傻跑"分支：一格一格试、只在叶子上查规则，当本文件自己的参照实现。
 */
export function countSolutions(b, opts = {}) {
  const cap = opts.cap || 2;
  const budget = opts.budget || 400000;
  const prune = opts.prune !== false;
  const wantAll = !!opts.all;
  const B = build(b.w, b.h, b.clue);
  const A = new Uint8Array(B.n).fill(TODO);
  const trail = []; // 传播写下的格，回溯时按栈擦掉
  let nodes = 0;
  let solutions = 0;
  let first = null;
  const all = [];
  let over = false;

  const put = (t, v, queue) => {
    A[t] = v;
    trail.push(t);
    if (queue) queue.push(t);
  };
  const undoTo = (mark) => {
    while (trail.length > mark) A[trail.pop()] = TODO;
  };

  // (LAND ∪ TODO) 里连着的一整块：里面有没有数字？
  function regionOf(t) {
    const cells = [];
    let numbers = 0;
    const seen = new Uint8Array(B.n);
    const stack = [t];
    seen[t] = 1;
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      if (B.num[c] > 0) numbers++;
      for (const u of B.nbr[c]) if (A[u] !== SEA && !seen[u]) {
        seen[u] = 1;
        stack.push(u);
      }
    }
    return { cells, numbers };
  }

  // 规则二的增量读法：所有黑格必须连成一整块。分量按 (SEA ∪ TODO) 算 —— 白格是永久的隔断，
  // 两块各自带着黑格的分量再也接不上。
  //   C1 有 ≥2 个分量各自含黑格 → 这一支死
  //   C2 某个未定格是"桥"（拿掉它之后分量裂成 ≥2 块、各自带黑格）→ 它只能黑
  // 割点用一次 DFS 求出（dfn/low + 子树里的黑格数），和引擎那边"每格试着一涂白再走一遍"的
  // 笨办法是各写各的 —— 两边同谋的概率才是我们要防的东西。
  // 返回 false = 死；返回 true = 写下新格子（外层要把局部规则再跑一轮）；返回 null = 什么都没发生。
  function connectivity(queue) {
    const seen = new Uint8Array(B.n);
    let chunks = 0;
    let changed = false;
    for (let s = 0; s < B.n; s++) {
      if (A[s] === LAND || seen[s]) continue;
      const nodes = [];
      let seas = 0;
      const q = [s];
      seen[s] = 1;
      while (q.length) {
        const c = q.pop();
        nodes.push(c);
        if (A[c] === SEA) seas++;
        for (const u of B.nbr[c]) if (A[u] !== LAND && !seen[u]) {
          seen[u] = 1;
          q.push(u);
        }
      }
      if (seas === 0) continue; // 一整块还没落黑的地方，不限制
      chunks++;
      if (chunks >= 2) return false;
      if (seas < 2) continue;
      const inC = new Uint8Array(B.n);
      for (const c of nodes) inC[c] = 1;
      const dfn = new Int32Array(B.n);
      const low = new Int32Array(B.n);
      const subSea = new Int32Array(B.n);
      const parent = new Int32Array(B.n).fill(-1);
      const forced = [];
      let timer = 0;
      const visit = (u) => {
        timer++;
        dfn[u] = low[u] = timer;
        subSea[u] = A[u] === SEA ? 1 : 0;
        let seaParts = 0; // 拿掉 u 之后，带黑格的分支数
        for (const v of B.nbr[u]) {
          if (!inC[v]) continue;
          if (!dfn[v]) {
            parent[v] = u;
            visit(v);
            subSea[u] += subSea[v];
            if (low[v] < low[u]) low[u] = low[v];
            if (low[v] >= dfn[u] && subSea[v] > 0) seaParts++;
          } else if (v !== parent[u] && dfn[v] < low[u]) {
            low[u] = dfn[v];
          }
        }
        const above = parent[u] < 0 ? 0 : seas - subSea[u];
        if (above > 0) seaParts++;
        if (seaParts >= 2 && A[u] === TODO) forced.push(u);
      };
      visit(s);
      for (const u of forced) {
        if (A[u] !== TODO) continue;
        put(u, SEA, queue);
        changed = true;
      }
    }
    return changed ? true : null;
  }

  // 落一子之后，把三条规则的"增量后果"一次做完；返回 false = 这一支已经活不成。
  //   F1 ← 规则三：2×2 里三格黑 → 第四格只能白；四格黑 → 死
  //   F2 ← 规则一：岛凑满 N 格 → 四周未定的格只能黑；超编 / 一岛两数 / 长不出来 → 死
  //   F3 ← 规则一：白岛必须有数字 —— 一整块"还可能变白"的区域里一个数字都没有，这块只能全黑
  //   C1/C2 ← 规则二：见上
  // 这几条都只是那三行规则换个说法，没有引入任何"玩家会怎么想"的推理规则。
  // ⚠ 传播只能"多判死"不能"错判死"：错判死会**少算解**，从而把多解盘说成唯一解 —— 叶子上的
  // finalBad 挡不住这种错（它只在盘定完时才跑）。守住它的是 tools/engine-test.mjs 里
  // "同一批盘 prune=true / prune=false 解数必须相等"那条对账，以及和 4×4 全枚举比对的模糊测试。
  function propagate(seed) {
    const queue = [seed];
    for (let round = 0; round <= B.n + 2; round++) {
      while (queue.length) {
        const t = queue.pop();
        if (A[t] === SEA) {
          if (B.num[t] > 0) return false; // 规则一：数字那一格自己就是岛的一格，涂不了黑
          for (const s of B.sqTouch[t]) {
            let sea = 0;
            let free = -1;
            let twoFree = false;
            for (const u of s) {
              if (A[u] === SEA) sea++;
              else if (A[u] === TODO) {
                if (free >= 0) twoFree = true;
                free = u;
              }
            }
            if (sea === 4) return false;
            if (sea === 3 && !twoFree && free >= 0) put(free, LAND, queue);
          }
          for (const u of B.nbr[t]) {
            if (A[u] === SEA) continue;
            const r = regionOf(u);
            if (r.numbers > 0) continue;
            if (r.cells.some((c) => A[c] === LAND)) return false; // 没有数字的白岛，修不好
            for (const c of r.cells) put(c, SEA, queue);
          }
        } else if (A[t] === LAND) {
          const g = group(B, A, t);
          if (groupDead(B, A, g)) return false;
          if (g.numbers === 1 && g.cells.length === g.want) {
            for (const u of g.boundary) if (A[u] === TODO) put(u, SEA, queue);
          }
        }
      }
      const conn = connectivity(queue);
      if (conn === false) return false;
      if (conn === null) return true; // 局部和全局都推完了
    }
    // 走到这里说明传播一轮都没停：每次 put 都严格消掉一个 TODO，最多 B.n 次，所以这不可能发生。
    // 真发生了就是缺陷 —— 宁可抛错，也不许把它当成"这一支死了"（那会少算解）。
    throw new Error('count.js: 传播没有收敛（引擎缺陷）');
  }

  function go(t) {
    if (++nodes > budget) {
      over = true;
      return true;
    }
    while (t < B.n && A[t] !== TODO) t++; // 传播可能已经把后面几格定了
    if (t === B.n) {
      if (!finalBad(B, A)) {
        solutions++;
        if (!first) first = Uint8Array.from(A);
        if (wantAll) all.push(Uint8Array.from(A));
      }
      return solutions >= cap;
    }
    for (const v of [LAND, SEA]) {
      const mark = trail.length;
      A[t] = v;
      trail.push(t);
      const dead = prune ? !propagate(t) : v === SEA && B.num[t] > 0;
      if (!dead && go(t + 1)) {
        undoTo(mark);
        return true;
      }
      undoTo(mark);
    }
    return false;
  }

  go(0);
  if (over) return { status: OVERBUDGET, solutions, nodes, first: null, all: wantAll ? all : null };
  return {
    status: solutions >= cap ? MANY : solutions === 1 ? UNIQUE : solutions === 0 ? NONE : MANY,
    solutions,
    nodes,
    first,
    all: wantAll ? all : null,
  };
}

// 唯一的翻译层：穷举盘的 LAND/SEA → 引擎的 UNKNOWN 0 / WHITE 1 / BLACK 2。
export function asNurikabe(arr) {
  if (!arr) return null;
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] === LAND ? 1 : arr[i] === SEA ? 2 : 0;
  return out;
}

// 反方向：引擎的三色 → 穷举盘的两色 + TODO。
// 这里的 1/2 是引擎那边的 WHITE/BLACK，按字面量抄一份并写明出处 —— 这一层是**唯一**允许两边的
// 数字互相照面的地方，别处一律各用各的编码，这样两边各自写错时才不会被同一个常量一起带偏。
export function asLandSea(cell) {
  const out = new Uint8Array(cell.length);
  for (let i = 0; i < cell.length; i++) out[i] = cell[i] === 1 ? LAND : cell[i] === 2 ? SEA : TODO;
  return out;
}

/**
 * 独立复核：按三条规则的原文把一个盘查一遍（入参用本文件的 LAND/SEA/TODO 编码）。
 * 返回 null 表示合法，否则返回**所有**毛病拼成的一句话（中文）—— 只报第一条的坏处是"这块盘
 * 到底哪里错了"要看运气，闸门要能指认每一处，测试才能逐条对着写。
 * 这里刻意不调用任何增量剪枝（也不复用 finalBad 的走法），它就是最后那道闸。
 */
export function audit(b, cell) {
  const B = build(b.w, b.h, b.clue);
  const A = Uint8Array.from(cell);
  const bad = [];
  let todo = 0;
  for (let t = 0; t < B.n; t++) if (A[t] === TODO) todo++;
  if (todo) bad.push(`还有 ${todo} 格未定`);
  // 规则一：每块白岛恰好一个数字，且岛的大小 = 那个数字
  const seen = new Uint8Array(B.n);
  for (let t = 0; t < B.n; t++) {
    if (A[t] !== LAND || seen[t]) continue;
    const stack = [t];
    seen[t] = 1;
    let size = 0;
    const nums = [];
    while (stack.length) {
      const c = stack.pop();
      size++;
      if (B.num[c] > 0) nums.push(c);
      for (const u of B.nbr[c]) if (A[u] === LAND && !seen[u]) {
        seen[u] = 1;
        stack.push(u);
      }
    }
    if (!nums.length) bad.push(`从 @${t} 起的白岛没有数字（${size} 格）`);
    else if (nums.length > 1) bad.push(`一块白岛里挤了 ${nums.length} 个数字（@${nums.join(',')}）`);
    else if (size !== B.num[nums[0]]) bad.push(`@${nums[0]} 写着 ${B.num[nums[0]]}，那块岛却有 ${size} 格`);
  }
  for (let t = 0; t < B.n; t++) if (B.num[t] > 0 && A[t] === SEA) bad.push(`数字 ${B.num[t]} 写在了一格黑墙上 @${t}`);
  // 规则三：没有任何 2×2 全黑
  for (const s of B.sq) if (s.every((u) => A[u] === SEA)) bad.push(`2×2 全黑 @${s[0]}`);
  // 规则二：所有黑格连成一整块
  let seaTotal = 0;
  for (let t = 0; t < B.n; t++) if (A[t] === SEA) seaTotal++;
  if (seaTotal > 1) {
    const seenSea = new Uint8Array(B.n);
    let pieces = 0;
    for (let t = 0; t < B.n; t++) {
      if (A[t] !== SEA || seenSea[t]) continue;
      pieces++;
      const stack = [t];
      seenSea[t] = 1;
      while (stack.length) {
        const c = stack.pop();
        for (const u of B.nbr[c]) if (A[u] === SEA && !seenSea[u]) {
          seenSea[u] = 1;
          stack.push(u);
        }
      }
    }
    if (pieces > 1) bad.push(`墙断成了 ${pieces} 块（黑格共 ${seaTotal} 格）`);
  }
  return bad.length ? bad.join('；') : null;
}

/**
 * 复核一个引擎盘（UNKNOWN/WHITE/BLACK 三色表）。给测试和生成器用的"最后一道闸"。
 */
export function auditNurikabe(b, cell) {
  return audit(b, asLandSea(cell));
}
