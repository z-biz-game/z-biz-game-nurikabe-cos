// 数墙 · 引擎测试（Node 里跑，不开浏览器）
//
// 四组事情，每组都只对"可交付"这件事负责：
//   A 三条规则的独立复核 —— 穷举器自己先要对（含 prune=true / prune=false 对账）
//   B 七条铅笔规则的手推锚点 —— 每一步都能用人话推出来，且各配一条"不该出手"的反例
//   C 规则可靠性模糊测试 —— 小盘全枚举，铅笔写下的每一格必须在**每一个解**里成立
//   D 生成器与状态机 —— 出货的盘零猜测 + 唯一解，落子/撤销/循环的边界
//
// 断言数会打印出来；有任何一条红就 exit 1。禁止用放宽断言的办法把绿的凑出来。

import {
  createBoard, solve, propagate, nextFact, reachable, verify, complete, diagnose, analyse,
  createState, setCell, cycleCell, undo, resetInk, snapshot, cluesFrom,
  Rules, RULE_ORDER, UNKNOWN, WHITE, BLACK, NO_OWNER, FREE_WHITE,
} from '../js/engine/nurikabe.js';
import {
  countSolutions, asNurikabe, asLandSea, audit, auditNurikabe,
  LAND, SEA, UNIQUE, MANY, NONE, OVERBUDGET,
} from '../js/engine/count.js';
import {
  plant, pencilRun, pruneClues, crossCheck, generateOne, bestOf, TIERS, tierByKey, scoreOf,
} from '../js/engine/generate.js';
import { makeRng, hashSeed, dailySeed, seedFrom } from '../js/engine/rng.js';

// ---------- 断言小工具 ----------
let total = 0;
const failures = [];
let section = '';
const perSection = [];
function begin(name) {
  if (section) perSection.push([section, total, failures.length]);
  section = name;
}
function is(cond, label) {
  total++;
  if (!cond) failures.push(`${section} / ${label}`);
  return !!cond;
}
function eq(got, want, label) {
  return is(got === want, `${label}：期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
}
function ne(got, notWant, label) {
  return is(got !== notWant, `${label}：不该等于 ${JSON.stringify(notWant)}`);
}
function noThrow(fn, label) {
  try {
    fn();
    return is(true, label);
  } catch (e) {
    return is(false, `${label}：抛了 ${e.message}`);
  }
}

// ---------- 读盘工具（测试里用字符画盘，免得下标看花眼） ----------
// '#'=黑 '·'/'.'=白 '?'/'.'=未定，数字直接写
function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const clue = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch >= '1' && ch <= '9') clue[y * w + x] = Number(ch);
    }
  }
  return { w, h, clue };
}
// ⚠ 两种写法都要认：['··#','#··'] 和 '··#/#··'。早先只按数组取下标，斜杠串被当成一整行，
// 墨水就涂到别的格子上去了 —— 于是"引擎推错了"的红其实是我这行读盘读歪了。
function inkOf(spec) {
  const rows = (Array.isArray(spec) ? spec : [spec]).flatMap((s) => String(s).split('/'));
  const h = rows.length;
  const w = rows[0].length;
  const cell = new Uint8Array(w * h);
  const owner = new Int16Array(w * h).fill(NO_OWNER);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y].length !== w) throw new Error(`inkOf 的行宽不一致：${rows.map((r) => r.length).join(',')}（这是测试自己的 bug，别当引擎的）`);
      const ch = rows[y][x];
      cell[y * w + x] = ch === '#' ? BLACK : ch === '·' || ch === 'o' ? WHITE : UNKNOWN;
    }
  }
  return { cell, owner };
}
function paint(board, cell) {
  const out = [];
  for (let y = 0; y < board.h; y++) {
    let line = '';
    for (let x = 0; x < board.w; x++) {
      const t = y * board.w + x;
      line += cell[t] === WHITE ? '·' : cell[t] === BLACK ? '#' : '?';
    }
    out.push(line);
  }
  return out.join('/');
}
const cellRows = (arr) => arr.join('/');
function has(rows, cell, key) {
  return rows.some((r) => r.cell === cell && r.value === (key === undefined ? undefined : r.value) && r.rule.key === key);
}
function firstOf(rows, key) {
  return rows.find((r) => r.rule.key === key) || null;
}
function cellsOf(rows, key) {
  return rows.filter((r) => r.rule.key === key).map((r) => r.cell);
}

// =====================================================================
begin('A1 · 盘的构造与校验');
// =====================================================================
{
  const g = grid(['1.1', '...', '1.1']);
  const b = createBoard(g);
  eq(b.n, 9, '3×3 有 9 格');
  eq(b.clues, 4, '四个数字');
  eq(b.whiteTotal, 4, '白格总数 = 数字之和');
  eq(b.blackTotal, 5, '黑格总数 = 格数 - 白格总数');
  eq(b.cellName(0), '第1行1列', '格子的中文坐标（行在上）');
  eq(b.cellName(8), '第3行3列', '右下角');
  eq(b.cellName(4), '第2行2列', '正中间');
  eq(b.sizeOf(2), 1, '2 号岛的大小');
  eq(b.islandAt[0], 0, '数字格自带岛编号');
  eq(b.islandAt[1], NO_OWNER, '没有数字的格无岛编号');
  eq(b.sq.length, 4, '3×3 有 4 个 2×2');
  eq(b.nbr[0].length, 2, '角上两邻');
  eq(b.nbr[4].length, 4, '中心四邻');
  eq(b.nbr[1].length, 3, '边上三邻');
  noThrow(() => createBoard({ w: 1, h: 5, clue: Uint8Array.from([1, 0, 1, 0, 1]) }), 'w=1 也要能建（数墙的墙需要至少两格宽，这条边界不在这里查）');
  // 上面那句故意宽松：真正的边界在 solve/verify 里查，这里只保证不炸
}
{
  const bad = [
    [{ w: 3, h: 3, clue: new Uint8Array(8) }, 'clue 长度不对'],
    [{ w: 3, h: 3, clue: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]) }, '盘上没数字'],
    [{ w: 3, h: 3, clue: Uint8Array.from([9, 9, 0, 0, 0, 0, 0, 0, 0]) }, '两个 9 格岛装不进 9 格'],
  ];
  for (const [spec, why] of bad) {
    let threw = false;
    try {
      createBoard(spec);
    } catch (e) {
      threw = true;
    }
    is(threw, `createBoard 该拒就拒：${why}`);
  }
  let threw = false;
  try {
    createBoard({ w: 3, h: 3, clue: Uint8Array.from([0, 0, 0, 0, 12, 0, 0, 0, 0]) });
  } catch (e) {
    threw = true;
  }
  is(threw, '数字大过格数要拒');
}

// =====================================================================
begin('A2 · 穷举器自己先要对');
// =====================================================================
{
  const one = Uint8Array.from([1, 0, 0, 0]);
  const r = countSolutions({ w: 2, h: 2, clue: one }, { cap: 2 });
  is(r.status === NONE || r.status === MANY || r.status === UNIQUE, `2×2 一个 1 的盘状态合法（${r.status}）`);
  // 2×2 上放得下的最大岛数是一个：两个岛（哪怕 1+2）都装不下。全枚举 2×2 的每一种线索分配验过，
  // 带两个数字的盘一个解都没有 —— 1 格岛要孤住就得把它两邻都涂黑，那两格恰好是对角线，墙断成两块。
  // 原先这块盘写的正是 `[1,2;.,.]`，穷举器报 NONE 是对的，错的是我嘴上说它"有解"。
  // 换成单个 2 格岛：横着长 / 竖着长两个解，每一个都要过穷举器自己的复核。
  const b2 = Uint8Array.from([2, 0, 0, 0]);
  const r2 = countSolutions({ w: 2, h: 2, clue: b2 }, { cap: 9, all: true });
  is(r2.solutions > 0, '2×2 [2,.;.,.] 有解');
  for (const sol of r2.all) {
    is(audit({ w: 2, h: 2, clue: b2 }, sol) === null, '穷举器交出来的每个解都能过自己的复核');
  }
  // 翻译层往返
  const cell = Uint8Array.from([UNKNOWN, WHITE, BLACK, UNKNOWN]);
  const back = asNurikabe(asLandSea(cell));
  is(cell.every((v, i) => back[i] === v), 'asLandSea → asNurikabe 往返不变');
  eq(asLandSea(cell)[2], SEA, 'BLACK → SEA');
  eq(asLandSea(cell)[1], LAND, 'WHITE → LAND');
  eq(asLandSea(cell)[0], 2, 'UNKNOWN → TODO');
}
{
  // 一个必然无解的盘：两个 1 挨着放，中间那格黑不掉也白不了
  const g = grid(['11', '..']);
  const r = countSolutions(g, { cap: 3 });
  eq(r.status, NONE, '2×2 上两个相邻的 1 无解（岛各 1 格，挨着就并成两格）');
  is(audit(g, Uint8Array.from([LAND, LAND, SEA, SEA])) !== null, '复核也拒这个盘');
}
{
  // 复核函数对三条规则各自都要抓到
  const g = grid(['2.1', '...', '...']);
  const good = { w: 3, h: 3, clue: g.clue };
  is(typeof auditNurikabe(good, Uint8Array.from([1, 1, 2, 2, 2, 2, 2, 1, 1])) === 'string', '岛不够格要被复核抓到');
  is(auditNurikabe(good, Uint8Array.from([1, 1, 2, 1, 2, 2, 2, 1, 1])) !== null, '2×2 全黑要被复核抓到');
  is(auditNurikabe({ w: 3, h: 3, clue: Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 1]) }, Uint8Array.from([2, 1, 1, 1, 1, 1, 1, 1, 1])) !== null, '数字落在黑墙上要被复核抓到');
  const g4 = grid(['1.1', '...', '1.1']);
  const ok4 = Uint8Array.from([1, 2, 1, 2, 2, 2, 1, 2, 1]);
  eq(auditNurikabe(g4, ok4), null, '四角各一个 1 的 3×3 是合法盘');
  const brokenWall = Uint8Array.from([1, 2, 1, 1, 1, 1, 1, 2, 1]);
  is(/墙|断/.test(auditNurikabe(g4, brokenWall) || ''), '墙断开要被复核抓到');
  const twoNums = Uint8Array.from([1, 1, 1, 1, 2, 1, 1, 1, 1]);
  is(/数字|岛/.test(auditNurikabe(g4, twoNums) || ''), '一个岛两个数字要被复核抓到');
}
{
  const b = createBoard({ w: 3, h: 3, clue: Uint8Array.from([1, 0, 1, 0, 0, 0, 1, 0, 1]) });
  const bad = verify(b, Uint8Array.from([WHITE, WHITE, WHITE, UNKNOWN, UNKNOWN, UNKNOWN, WHITE, UNKNOWN, WHITE]));
  is(bad.length > 0, 'verify 也报未定与岛错编');
  eq(verify(b, Uint8Array.from([1, 2, 1, 2, 2, 2, 1, 2, 1])).length, 0, 'verify 认下四角 1 的解');
  is(complete(b, Uint8Array.from([1, 2, 1, 2, 2, 2, 1, 2, 1])), 'complete 同口径');
  ne(countSolutions({ w: 3, h: 3, clue: b.clue }, { cap: 2 }).status, OVERBUDGET, '小盘穷举不该超预算');
}

// =====================================================================
begin('B · 七条铅笔规则的手推锚点');
// =====================================================================
// 主锚点盘：4×4，数字 2 在第2行2列、5 在第3行1列。
// 全部七条规则都在这块盘上出手，每一步都能用人话推出来（下面逐条写清）。
// 唯一解（穷举器 cap=2 已确认）：
//   ####
//   #··#
//   ·###
//   ····
const ANCHOR = { w: 4, h: 4, clue: Uint8Array.from([0, 0, 0, 0, 0, 2, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0]) };
const ANCHOR_CELL = Uint8Array.from([2, 2, 2, 2, 2, 1, 1, 2, 1, 2, 2, 2, 1, 1, 1, 1]);
const anchorBoard = createBoard(ANCHOR);
const anchorSolve = solve(anchorBoard);
{
  const c = countSolutions(ANCHOR, { cap: 2 });
  eq(c.status, UNIQUE, '锚点盘唯一解（穷举器口径）');
  eq(anchorSolve.ok, true, '锚点盘铅笔推得完');
  eq(paint(anchorBoard, anchorSolve.cell), paint(anchorBoard, ANCHOR_CELL), '铅笔答案与手推答案逐格一致');
  is(asNurikabe(c.first).every((v, i) => v === anchorSolve.cell[i]), '两套实现给出的答案逐格相同');
  eq(anchorSolve.steps, 16, '16 步正好铺满 16 格');
  eq(anchorSolve.rows.length, 16, 'rows 步数与 steps 相同');
  is(!anchorSolve.conflict, '锚点盘不该有矛盾');
}
// ① 数字即白：写着数字的那一格本身就是岛的一格
{
  const r = firstOf(anchorSolve.rows, 'number');
  is(!!r, '出手过①数字即白');
  eq(r.cell, 5, '第2行2列先落白');
  eq(r.value, WHITE, '数字格是白格，不是黑格');
  eq(anchorSolve.rows.filter((x) => x.rule.key === 'number').map((x) => x.cell).join(','), '5,8', '两个数字各落一格');
  // 2×2 上放不下两个岛（全枚举 2×2 的所有线索集验过：带两个数字的盘一个解都没有，
  // 1 格岛要孤住就得把两格黑成对角线，墙断两块），所以这里只用一个数字。
  const b = createBoard({ w: 2, h: 2, clue: Uint8Array.from([1, 0, 0, 0]) });
  const s = solve(b);
  is(!!firstOf(s.rows, 'number'), '2×2 也要先落数字格');
}
// ② 满岛圈墙：岛凑满 N 格 → 四周未定的格全黑
{
  const r = firstOf(anchorSolve.rows, 'full');
  is(!!r, '出手过②满岛圈墙');
  eq(r.cell, 10, '第3行3列被黑掉');
  eq(r.value, BLACK, '满岛的邻居只能黑');
  eq(r.detail.number, 5, '这条账记在 2 格岛头上');
  eq(r.detail.size, 2, '它已经凑满 2 格');
  is(/凑满/.test(r.rule.text(anchorBoard, r.detail)), '文案说得出"凑满"');
  // 手推：2 格岛 = {第2行2列, 第2行3列}，它四周只剩第3行3列还没定 —— 再白就成 3 格了
  const g = grid(['1.1', '...', '1.1']);
  const b = createBoard({ w: 3, h: 3, clue: g.clue });
  const s = solve(b);
  eq(cellsOf(s.rows, 'full').join(','), '1,3,5,7', '四个 1 格岛把上下左右四条边全圈成墙');
  eq(paint(b, s.cell), '·#·/###/·#·', '四角 1 的 3×3 一步到位');
  is(complete(b, s.cell), '这个盘推完就是合法解');
}
// ③ 两岛相逼：一格同时贴着两个岛的白格 → 必黑
{
  const r = firstOf(anchorSolve.rows, 'clash');
  is(!!r, '出手过③两岛相逼');
  eq(r.cell, 4, '第2行1列是第一个被逼出来的');
  eq(r.value, BLACK, '它只能黑');
  eq(r.detail.a, 5, '一边挨着 2 格岛');
  eq(r.detail.b, 8, '另一边挨着 5 格岛');
  is(/并成/.test(r.rule.text(anchorBoard, r.detail)), '文案说得出"两个岛并成一个"');
  // 反例：只贴一个岛的格不该被③判
  eq(cellsOf(anchorSolve.rows, 'clash').join(','), '4,9', '这块盘上只有两格同时贴着两个岛');
  is(!cellsOf(anchorSolve.rows, 'clash').includes(1), '第1行2列只贴 2 格岛，不该被③判');
}
// ④ 够不着即黑：白格必须有岛可归；哪个岛都装不下它 → 必黑
{
  const r = firstOf(anchorSolve.rows, 'reach');
  is(!!r, '出手过④够不着即黑');
  eq(r.cell, 0, '第1行1列先被判定');
  eq(r.value, BLACK, '它只能黑');
  eq(r.detail.gap, 1, '手推：2 格岛只剩 1 个空位，而它离岛 2 步 —— 还差 1 格');
  eq(r.detail.fields, 2, '还有两个没满的岛可查');
  // 手推反例：第1行2列离 2 格岛正好 1 步、岛还剩 1 格 —— ④不能判它
  is(!cellsOf(anchorSolve.rows, 'reach').includes(1), '够得着的第1行2列不被④判');
  // 全部岛凑满的情况：文案要换一套说法
  const g = grid(['1.1', '...', '1.1']);
  const b = createBoard(g);
  const s = solve(b);
  const rr = firstOf(s.rows, 'reach');
  is(!!rr, '四角 1 的盘中间那格由④收尾');
  eq(rr.cell, 4, '判的是正中间');
  eq(rr.detail.fields, 0, '一个没满的岛都不剩');
  is(/凑满/.test(rr.rule.text(b, rr.detail)), '文案改成"每个岛都凑满了"');
}
// ⑤ 三黑补白：2×2 里黑了三格 → 第四格必白
{
  const r = firstOf(anchorSolve.rows, 'three');
  is(!!r, '出手过⑤三黑补白');
  eq(r.cell, 6, '第2行3列被留白');
  eq(r.value, WHITE, '它必须白');
  // 手推：第1行3列/第1行4列/第2行4列 已经是墙，2×2 第四格再黑就是二二全黑
  is(/2×2/.test(r.rule.text(anchorBoard, r.detail)), '文案提到 2×2');
  // 反例：只黑两格的 2×2 不该出手
  const b2 = createBoard({ w: 3, h: 3, clue: Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 3]) });
  const seed = inkOf(['???/##?/???']);
  const s2 = solve(b2, { seed });
  eq(cellsOf(s2.rows, 'three').length, 0, '2×2 只有两格黑时⑤不出手');
  // 手推：第2行1列/第2行2列/第3行1列 已是墙，第2行第3列那个 2×2 只差第3行2列 —— 再黑就四格全黑
  const seed3 = inkOf(['???/##?/#??']);
  const s3 = solve(b2, { seed: seed3 });
  eq(cellsOf(s3.rows, 'three').join(','), '7', '三格黑时⑤才出手，补的正是第3行2列');
  // 四格全黑要报矛盾（挑一块不碰数字格的 2×2：第1行2列 / 第1行3列 / 第2行1列… 见字符画）
  const s4 = solve(b2, { seed: inkOf(['?##/###/???']) });
  is(/2×2|全黑/.test(s4.conflict || ''), '四格全黑当场报矛盾');
}
// ⑥ 岛地必满：岛周围还没被墙围死的格子恰好只剩 N 格 → 这一片全白
{
  const r = firstOf(anchorSolve.rows, 'fill');
  is(!!r, '出手过⑥岛地必满');
  eq(r.value, WHITE, '⑥写的是白格');
  eq(cellsOf(anchorSolve.rows, 'fill').join(','), '12,13,14,15', '底下一整排必须白');
  eq(r.detail.number, 8, '记在 5 格岛头上');
  eq(r.detail.size, 5, '它要 5 格');
  is(/恰好/.test(r.rule.text(anchorBoard, r.detail)), '文案说得出"恰好只剩"');
  // 反例：还没被墙围死时格子数 > N，⑥不能出手
  const g = grid(['4..', '...', '.2.']);
  const b2 = createBoard(g);
  const s2 = solve(b2);
  eq(cellsOf(s2.rows, 'fill').length, 0, '4 格岛还有 8 格可活动时⑥不出手');
  eq(s2.ok, false, '这时候推不完（这是事实，不是缺陷）');
  // 手推锚点：上下两条 3 格岛，中间那一排已经是墙 —— 每个岛"还没被墙围死"的格子
  // 恰好只剩它自己那一行的另两格（3 格岛要 3 格，已有 1 格）→ ⑥一次把这两格落白。
  const b5 = createBoard(grid(['3..', '###', '3..']));
  const s5 = solve(b5, { seed: inkOf(['???/###/???']) });
  is(cellsOf(s5.rows, 'fill').length > 0 || s5.conflict !== null, '围死之后要么⑥出手、要么当场矛盾');
  eq(cellsOf(s5.rows, 'fill').join(','), '1,2,7,8', '两条 3 格岛被中间那排墙封死 → 各自那一行摊满');
}
// ⑦ 孤墙必连：唯一能把两片墙接上的桥 → 必黑
{
  const r = firstOf(anchorSolve.rows, 'bridge');
  is(!!r, '出手过⑦孤墙必连');
  eq(r.cell, 1, '第1行2列是那座桥');
  eq(r.value, BLACK, '桥必须黑');
  eq(r.detail.a, 0, '一头是第1行1列那片墙');
  eq(r.detail.b, 2, '另一头是第1行3列那片墙');
  is(/桥|一整块/.test(r.rule.text(anchorBoard, r.detail)), '文案说得出"它是桥"');
  // 手推：第1行1列和第1行4列已经黑了，第2行1列也被③逼黑 —— 顶边那条墙只能从第1行2列或第1行3列绕下来；
  // 第1行3列也黑了之后，第1行2列一白就把 {第1行1列,第2行1列} 这块墙彻底孤立
  eq(cellsOf(anchorSolve.rows, 'bridge').join(','), '1', '这块盘上只有一座桥');
  // 反例：墙本来就一整块时不出手
  const b = createBoard({ w: 3, h: 3, clue: Uint8Array.from([1, 0, 1, 0, 0, 0, 1, 0, 1]) });
  eq(cellsOf(solve(b).rows, 'bridge').length, 0, '四角 1 的盘没有桥可判');
}
{
  // 规则表本身：每条都要有 key/名称/档位/权重/文案，且 RULE_ORDER 与 Rules 一致
  eq(RULE_ORDER.length, Object.keys(Rules).length, 'RULE_ORDER 覆盖了所有规则');
  for (const key of RULE_ORDER) {
    const R = Rules[key];
    is(!!R, `${key} 在规则表里`);
    eq(R.key, key, `${key} 的 key 自洽`);
    is(typeof R.name === 'string' && R.name.length >= 2, `${key} 有中文名`);
    is(typeof R.weight === 'number' && R.weight > 0, `${key} 有权重`);
    is(typeof R.tier === 'number' && R.tier >= 1, `${key} 有档位`);
    const row = anchorSolve.rows.find((x) => x.rule.key === key);
    is(!!row, `${key} 在锚点盘上真的出手（否则锚点盘要换）`);
    const text = R.text(anchorBoard, row ? row.detail : { cell: 0, number: 0, size: 1, a: 0, b: 1, gap: 1, fields: 1 });
    is(typeof text === 'string' && text.length > 6 && !/NaN|undefined/.test(text), `${key} 的中文文案没有 NaN/undefined`);
  }
  const tiers = RULE_ORDER.map((k) => Rules[k].tier);
  is(new Set(tiers).size >= 4, '规则至少分了 4 档（难度轴要有分辨力）');
}

// =====================================================================
begin('C · 规则可靠性模糊测试（全枚举对账）');
// =====================================================================
{
  // 4×4 的所有黑白分配 → 合法完整盘 → 每岛一个数字 → 再随机删几条（删完可能 0 解 / 多解，都要能查）
  const W = 4;
  const H = 4;
  const N = 16;
  const nbr = [];
  for (let t = 0; t < N; t++) {
    const x = t % W;
    const y = (t / W) | 0;
    const o = [];
    if (y > 0) o.push(t - W);
    if (x > 0) o.push(t - 1);
    if (x < W - 1) o.push(t + 1);
    if (y < H - 1) o.push(t + W);
    nbr.push(o);
  }
  const sq = [];
  for (let y = 0; y + 1 < H; y++) {
    for (let x = 0; x + 1 < W; x++) {
      const a = y * W + x;
      sq.push([a, a + 1, a + W, a + W + 1]);
    }
  }
  const groups = (arr, want) => {
    const seen = new Uint8Array(N);
    const out = [];
    for (let t = 0; t < N; t++) {
      if (arr[t] !== want || seen[t]) continue;
      const g = [];
      const st = [t];
      seen[t] = 1;
      while (st.length) {
        const c = st.pop();
        g.push(c);
        for (const u of nbr[c]) if (arr[u] === want && !seen[u]) {
          seen[u] = 1;
          st.push(u);
        }
      }
      out.push(g);
    }
    return out;
  };
  const fulls = [];
  for (let mask = 0; mask < (1 << N); mask++) {
    const arr = new Uint8Array(N);
    for (let t = 0; t < N; t++) arr[t] = mask & (1 << t) ? SEA : LAND;
    if (sq.some((s) => s.every((t) => arr[t] === SEA))) continue;
    const wg = groups(arr, LAND);
    if (groups(arr, SEA).length > 1) continue;
    if (wg.length < 2) continue;
    fulls.push({ arr, wg });
  }
  is(fulls.length > 3000, `4×4 合法完整盘枚举到 ${fulls.length} 块`);

  const rand = makeRng('fuzz.v1');
  let boards = 0;
  let solvable = 0;
  let unsound = 0;
  let conflictOnSolvable = 0;
  let pencilComplete = 0;
  let multiplePencil = 0;
  let mismatch = 0;
  let pruneMismatch = 0;
  const fires = {};
  const sample = 900;
  for (let i = 0; i < sample; i++) {
    const f = fulls[rand.int(fulls.length)];
    const clue = new Uint8Array(N);
    for (const g of f.wg) clue[rand.pick(g)] = g.length;
    const positions = [];
    for (let t = 0; t < N; t++) if (clue[t] > 0) positions.push(t);
    const dropCount = Math.floor(rand.next() * positions.length * 0.6);
    rand.shuffle(positions);
    for (let d = 0; d < dropCount && positions.length > 1; d++) clue[positions.pop()] = 0;
    boards++;
    let r;
    try {
      r = countSolutions({ w: W, h: H, clue }, { cap: Infinity, all: true, budget: 600000 });
    } catch (e) {
      is(false, `穷举器在小盘上不该抛：${e.message}`);
      continue;
    }
    if (r.status === OVERBUDGET) continue;
    if (r.solutions === 0) continue; // 无解的盘对"可靠性"没有信息量
    solvable++;
    if (r.solutions === 1) {
      const slow = countSolutions({ w: W, h: H, clue }, { cap: 4, budget: 6000000, prune: false });
      if (slow.status === OVERBUDGET || slow.solutions !== r.solutions) pruneMismatch++;
    }
    const sols = r.all.map(asNurikabe);
    const b = createBoard({ w: W, h: H, clue });
    const s = solve(b);
    if (s.conflict) {
      conflictOnSolvable++;
      continue;
    }
    for (const row of s.rows) {
      fires[row.rule.key] = (fires[row.rule.key] || 0) + 1;
      // 可靠性：这一格必须在**每一个解**里都成立
      for (const sol of sols) if (sol[row.cell] !== row.value) unsound++;
    }
    if (s.ok) {
      pencilComplete++;
      if (r.solutions !== 1) multiplePencil++;
      else if (!asNurikabe(r.first).every((v, t) => v === s.cell[t])) mismatch++;
    }
  }
  eq(solvable > 400, true, `样本里可解的盘够多（${solvable}/${boards}）`);
  eq(unsound, 0, '铅笔写下的每一格都在每一个解里成立（可靠性）');
  eq(conflictOnSolvable, 0, '有解的盘绝不被判成矛盾');
  eq(multiplePencil, 0, '铅笔推完了而穷举说解不唯一 —— 这是最严重的不一致');
  eq(mismatch, 0, '铅笔答案与穷举答案在唯一解盘上逐格相同');
  eq(pruneMismatch, 0, '穷举器剪枝版与傻跑版解数相同');
  eq(Object.keys(fires).length, RULE_ORDER.length, `小盘上七条规则都被触发到（${Object.keys(fires).join(',')}）`);
  is(pencilComplete > 20, `样本里确实有铅笔能推完的盘（${pencilComplete} 块）`);
}
{
  // 带墨水的盘也要可靠：只跟"与墨水一致的那些解"比
  const W = 4;
  const H = 4;
  const N = 16;
  const rand = makeRng('fuzz.seeded.v1');
  let tested = 0;
  let unsound = 0;
  for (let i = 0; i < 220 && tested < 60; i++) {
    const clue = Uint8Array.from([0, 0, 0, 0, 0, 2, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0]);
    for (let t = 0; t < N; t++) if (rand.next() < 0.25) clue[t] = 0;
    let used = 0;
    for (let t = 0; t < N; t++) if (clue[t] > 0) used++;
    if (used < 2) continue;
    const r = countSolutions({ w: W, h: H, clue }, { cap: Infinity, all: true, budget: 400000 });
    if (r.status === OVERBUDGET || r.solutions === 0) continue;
    const sols = r.all.map(asNurikabe);
    // 随机挑一个解，涂对其中若干格当墨水
    const base = rand.pick(sols);
    const cell = new Uint8Array(N);
    const owner = new Int16Array(N).fill(NO_OWNER);
    for (let t = 0; t < N; t++) {
      if (rand.next() < 0.45) cell[t] = base[t];
      else cell[t] = UNKNOWN;
    }
    let any = false;
    for (let t = 0; t < N; t++) if (cell[t] !== UNKNOWN) any = true;
    if (!any) continue;
    const b = createBoard({ w: W, h: H, clue });
    const s = solve(b, { seed: { cell: Uint8Array.from(cell), owner } });
    if (s.conflict) continue;
    tested++;
    const keep = sols.filter((sol) => sol.every((v, t) => cell[t] === UNKNOWN || v === cell[t]));
    if (!keep.length) continue;
    for (const row of s.rows) for (const sol of keep) if (sol[row.cell] !== row.value) unsound++;
  }
  is(tested >= 30, `带墨水的盘也测到了（${tested} 块）`);
  eq(unsound, 0, '有墨水时铅笔写下的格子依然在所有相容解里成立');
}

// =====================================================================
begin('D1 · 矛盾检测：墨水自相矛盾时引擎要当场说');
// =====================================================================
{
  const b = createBoard(ANCHOR);
  const blackOnNumber = inkOf(['????/?#??/????/????']);
  const s = solve(b, { seed: blackOnNumber });
  is(/数字|涂黑/.test(s.conflict || ''), '把数字格涂黑 → 当场矛盾');
  eq(s.ok, false, '矛盾的盘不算推完');
  eq(reachable(b, blackOnNumber.cell, blackOnNumber.owner), false, 'reachable 说这盘收不了场');
  // 挑一块不碰数字格（第2行2列 / 第3行1列）的 2×2：右下角那四格
  const twoTwo = inkOf(['????/????/??##/??##']);
  const s2 = solve(b, { seed: twoTwo });
  is(/2×2|全黑/.test(s2.conflict || ''), '2×2 全黑 → 当场矛盾');
  const splitWall = solve(createBoard(ANCHOR), { seed: inkOf(['####/·##?/####/####']) });
  is(typeof splitWall.conflict === 'string' || splitWall.ok === false, '墙被切两块时报矛盾或推不完');
  const overFull = solve(b, { seed: { cell: Uint8Array.from([0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]), owner: Int16Array.from([NO_OWNER, NO_OWNER, NO_OWNER, NO_OWNER, 0, 0, 0, NO_OWNER, 1, NO_OWNER, NO_OWNER, NO_OWNER, NO_OWNER, NO_OWNER, NO_OWNER, NO_OWNER]) } });
  is(/超编|凑满|两个岛|已经是/.test(overFull.conflict || ''), '2 格岛长出第 3 格白 → 矛盾');
  const merged = solve(b, { seed: inkOf(['····/····/····/····']) });
  is(/岛|数字/.test(merged.conflict || ''), '全白的盘（两个岛并成一个）→ 矛盾');
  void splitWall;
}
{
  // 没有矛盾时不能乱报（reachable 只在规则逼出矛盾时说 false）
  const b = createBoard({ w: 3, h: 3, clue: Uint8Array.from([1, 0, 1, 0, 0, 0, 1, 0, 1]) });
  const st = createState(b);
  is(reachable(b, st.cell, st.owner), '空盘当然收得了场');
  cycleCell(st, 4);
  is(reachable(b, st.cell, st.owner) === true || reachable(b, st.cell, st.owner) === false, 'reachable 返回布尔');
}
{
  const b = createBoard(ANCHOR);
  const st = createState(b);
  // 墨水要落在唯一解那一边：第2行1列在这个盘上是墙（唯一解 · 见上），落白就把盘推成矛盾，
  // 那时候 nextFact 只能报矛盾、给不出提示 —— 原先这里写的正是"落白"，红的是我这个 fixture。
  setCell(st, 4, BLACK);
  const fact = nextFact(b, st.cell, st.owner);
  is(!!fact, '有墨水时还给得出下一步');
  const s = solve(b, { seed: { cell: Uint8Array.from(st.cell), owner: Int16Array.from(st.owner) } });
  eq(fact ? fact.cell : -1, s.rows.length ? s.rows[0].cell : -1, 'nextFact 和 solve 的第一步说的是同一格');
  eq(fact ? fact.value : -1, s.rows.length ? s.rows[0].value : -1, '说的是同一个颜色');
  // 提示不能剧透：nextFact 说的格子必须是玩家还不知道的
  is(s.rows.every((r) => r.value === WHITE || r.value === BLACK), '每一步都落到具体颜色');
  is(s.rows.every((r) => typeof r.rule.name === 'string' && r.detail), '每一步都带规则名和理由');
  const blacked = inkOf(['????/?#??/????/????']);
  eq(nextFact(b, blacked.cell, blacked.owner).cell, undefined, '墨水矛盾时 nextFact 不给提示，只给 conflict');
  is(/矛盾|数字|涂黑/.test(JSON.stringify(nextFact(b, blacked.cell, blacked.owner))), 'nextFact 把矛盾原文带出来');
}
{
  // 逐步重放：把 rows 一条条写回空盘，每一步都还能被 propagate 复现
  const b = createBoard(ANCHOR);
  const cell = new Uint8Array(b.n);
  const owner = new Int16Array(b.n).fill(NO_OWNER);
  let ok = true;
  for (const row of anchorSolve.rows) {
    const f = nextFact(b, cell, owner);
    if (!f || f.cell !== row.cell || f.value !== row.value) {
      ok = false;
      break;
    }
    cell[row.cell] = row.value;
    owner[row.cell] = row.value === WHITE ? f.owner : NO_OWNER;
  }
  is(ok, '提示脚本可以一条条重放，顺序不撒谎');
  eq(paint(b, cell), paint(b, ANCHOR_CELL), '重放到底就是那个唯一解');
  const s = solve(b, { seed: { cell: Uint8Array.from(cell), owner } });
  eq(s.ok, true, '已经满了的盘再推一次也说"完了"');
  eq(s.steps, 0, '满了的盘没有下一步');
}

// =====================================================================
begin('D2 · 状态机：落子 / 循环 / 撤销');
// =====================================================================
{
  const b = createBoard(ANCHOR);
  const st = createState(b);
  eq(st.cell.length, b.n, '状态里每格一个色');
  eq(st.history.length, 0, '开局没有历史');
  // 越界的两条先查：这时候第1行2列还没被循环碰过，"盘面干净"才是被越界拒绝之后的干净
  eq(setCell(st, 99, WHITE), false, '越界落子拒掉');
  eq(setCell(st, -1, WHITE), false, '负下标落子拒掉');
  eq(st.cell[1], UNKNOWN, '越界之后盘面干净');
  eq(cycleCell(st, 1), WHITE, '未定 → 白');
  eq(st.history.length, 1, '落子留下一条可撤销记录');
  eq(cycleCell(st, 1), BLACK, '白 → 黑');
  eq(cycleCell(st, 1), UNKNOWN, '黑 → 未定（循环回起点）');
  eq(cycleCell(st, 1), WHITE, '再来一遍还是白');
  eq(setCell(st, 5, BLACK), false, '数字格不许涂黑');
  eq(st.cell[5], UNKNOWN, '数字格保持未定（引擎推之前不写死，留给 solve 说理由）');
  eq(setCell(st, 5, WHITE), true, '数字格可以落白');
  eq(st.owner[5], 0, '落白的数字格自带岛编号');
  eq(setCell(st, 5, WHITE), false, '重复落同一格不产生新历史');
  const before = st.history.length;
  undo(st);
  is(st.history.length === before - 1, '撤销吐出一条历史');
  is(undo(st), true, '还能继续撤销');
  const st2 = createState(b);
  eq(undo(st2), false, '没有历史时撤销返回 false，不崩');
  resetInk(st2);
  is(st2.cell.every((v) => v === UNKNOWN) && st2.history.length === 0, 'resetInk 把墨水全擦了');
  for (let i = 0; i < 900; i++) snapshot(st2);
  is(st2.history.length <= 800, `历史栈封顶（${st2.history.length}）`);
}
{
  const b = createBoard(ANCHOR);
  const st = createState(b);
  const snap = Uint8Array.from(st.cell);
  setCell(st, 0, BLACK);
  is(st.cell[0] === BLACK && snap[0] === UNKNOWN, 'snapshot 之后原数组不被改（各存一份拷贝）');
  const s1 = solve(b, { seed: { cell: Uint8Array.from(st.cell), owner: Int16Array.from(st.owner) } });
  eq(st.cell[0], BLACK, 'solve 不改玩家的盘（它自己拷一份）');
  const s2 = solve(b, { seed: { cell: Uint8Array.from(st.cell), owner: Int16Array.from(st.owner) } });
  eq(paint(b, s1.cell), paint(b, s2.cell), '同一个盘推两次结果相同（确定性）');
  void s2;
}
{
  // diagnose：界面上所有读数都从它来
  const b = createBoard(ANCHOR);
  const st = createState(b);
  let d = diagnose(b, st.cell);
  eq(d.unknown, b.n, '空盘全部未定');
  eq(d.white, 0, '空盘没有白格');
  eq(d.black, 0, '空盘没有黑格');
  eq(d.clues, 2, '两个数字');
  eq(d.conflicts, 0, '空盘不该报冲突');
  eq(d.filled, 0, '落子数为 0');
  // 画布读的是 markedCells：整张空盘 25 格全在 badCells 里（未定），
  // 但一格都不许标红 —— 这两份名册必须能分开，否则"未定不是冲突"只是嘴上说的。
  eq(d.badCells.size, b.n, '空盘的 badCells 就是那些未定格');
  eq(d.markedCells.size, 0, '空盘没有一格该标红');
  const s = solve(b);
  d = diagnose(b, s.cell);
  eq(d.unknown, 0, '推完的盘没有未定');
  eq(d.white, b.whiteTotal, '白格数 = 数字之和');
  eq(d.black, b.blackTotal, '黑格数 = 剩下的');
  eq(d.islandsDone, 2, '两个岛都凑满了');
  eq(d.wallPieces, 1, '墙是一整块');
  eq(d.wallDone, true, '墙也封好了');
  eq(d.problems.length, 0, '推完的盘过不了 verify 就是缺陷');
  eq(d.conflicts, 0, '推完没有冲突');
  const bad = inkOf(['####/####/####/####']);
  d = diagnose(b, bad.cell);
  is(d.conflicts > 0, '全黑的盘报冲突');
  is(d.badCells.size > 0, '冲突格子给得出高亮集合');
  eq(d.markedCells.size, d.badCells.size, '全黑的盘没有未定格：两份名册这时是同一批格');
  eq(d.white, 0, '读数里白格数对得上');
}
{
  // analyse：假设深度只用于测量；出货的盘必须是 0
  const b = createBoard(ANCHOR);
  const a = analyse(b, { maxDepth: 2, budget: 4000 });
  eq(a.solved, true, '锚点盘零假设就推得完');
  eq(a.depth, 0, '深度 0');
  eq(a.backtracks, 0, '零回溯');
  is(a.nodes >= 1, '至少跑了一次');
  const needGuess = createBoard(grid(['...3.', '.....', '.6...', '.....', '1.1..']));
  // 旧的 '2...3/.....' 那块盘穷举器直接报 NONE（两个岛隔着 5 列墙，15 格白岛装不下 2+3 之外的一切），
  // analyse 一进门就被"岛装不下"剪光，nodes 永远是 1 —— 红的是我挑了块死盘，不是 analyse 没跑。
  // 这块换上来的盘：铅笔推不完（下面那条断言盯着），但穷举器确认唯一解，正是"要猜一步"的样本。
  const s = solve(needGuess);
  is(!s.ok, '这块盘铅笔推不完（拿来当 analyse 的反面样本）');
  eq(countSolutions({ w: 5, h: 5, clue: needGuess.clue }, { cap: 2, budget: 4000000 }).status, UNIQUE, '反面样本自己得是唯一的可解盘');
  const a2 = analyse(needGuess, { maxDepth: 3, budget: 20000 });
  is(a2.nodes > 1, 'analyse 真的跑了');
  is(a2.solved ? a2.depth >= 1 : true, '推不完的话深度至少 1');
  void s;
}
{
  // cluesFrom：从一个解读它自己的数字
  // 这块 land 原先写的是 [1,1,2 / 1,1,2 / 1,1,2]（·#· 那样竖着排）—— 那是**一整块** 6 格白岛，
  // 读出来只剩一个数字 6，所以"两块岛两个数字"当然对不上。换成横着切两刀、上下各 3 格。
  const land = Uint8Array.from([WHITE, WHITE, WHITE, BLACK, BLACK, BLACK, WHITE, WHITE, WHITE]);
  const clue = cluesFrom(3, 3, land);
  const b = createBoard({ w: 3, h: 3, clue });
  eq(clue.reduce((a, v) => a + v, 0), 6, '读出来的数字之和 = 白格数');
  eq(b.clues, 2, '两块白岛两个数字');
  const s = solve(b);
  is(s.ok, '满线索盘能推完');
  eq(paint(b, s.cell), '···/###/···', '推回原盘');
  const clue2 = cluesFrom(3, 3, land, (g) => g[g.length - 1]);
  is(clue2.every((v, i) => v === 0 || (land[i] === WHITE && v === 3)), '换个落点仍然是合法线索集（数字写在白岛上、大小就是那块岛的格数）');
  const b2 = createBoard({ w: 3, h: 3, clue: clue2 });
  eq(paint(b2, solve(b2).cell), '···/###/···', '换落点也认得回同一个盘');
}

// =====================================================================
begin('D3 · 生成器：出货的盘必须零猜测 + 唯一解');
// =====================================================================
{
  const rand = makeRng('plant.v1');
  let planted = 0;
  for (let i = 0; i < 20; i++) {
    const land = plant(6, 6, rand, { blackRatio: 0.6, maxIsland: 4, tries: 60 });
    if (!land) continue;
    planted++;
    const b = { w: 6, h: 6, clue: cluesFrom(6, 6, land) };
    eq(auditNurikabe(b, land), null, `种出来的盘三条规则全过（第${i}块）`);
    is(land.some((v) => v === WHITE) && land.some((v) => v === BLACK), '种的盘既有白也有黑');
    const whites = land.filter((v) => v === WHITE).length;
    is(whites >= 2, '白岛不止一格');
    const sizes = [];
    const seen = new Uint8Array(36);
    for (let t = 0; t < 36; t++) {
      if (land[t] !== WHITE || seen[t]) continue;
      let n = 0;
      const st = [t];
      seen[t] = 1;
      while (st.length) {
        const c = st.pop();
        n++;
        for (let k = 0; k < 4; k++) {
          const x = c % 6 + (k === 1 ? -1 : k === 3 ? 1 : 0);
          const y = ((c / 6) | 0) + (k === 0 ? -1 : k === 2 ? 1 : 0);
          if (x < 0 || y < 0 || x >= 6 || y >= 6) continue;
          const u = y * 6 + x;
          if (land[u] === WHITE && !seen[u]) {
            seen[u] = 1;
            st.push(u);
          }
        }
      }
      sizes.push(n);
    }
    is(sizes.every((s) => s <= 4), '白岛不超过轴给的上限');
    if (planted >= 10) break;
  }
  // 断言的是"够 10 块"，循环就得跑到真的攒够 10 块为止（原先 break 在 6 块就收工，
  // 于是 is(planted >= 10) 永远红 —— 那是循环写错，不是种盘种不出来：实测 20 次全中）。
  is(planted >= 10, `种盘的成功率够用（${planted}/20）`);
}
{
  // pencilRun：推完 + 过独立验收才算数
  const g = grid(['1.1', '...', '1.1']);
  const r = pencilRun(3, 3, g.clue);
  is(!!r, '四角 1 的盘 pencilRun 认');
  eq(r.result.ok, true, '确实推完');
  is(!pencilRun(3, 3, new Uint8Array(9)), '没数字的盘 pencilRun 不认');
  is(!pencilRun(2, 2, Uint8Array.from([1, 1, 0, 0])), '装不下的盘 pencilRun 不认');
  is(!pencilRun(5, 5, Uint8Array.from([2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), '推不完的盘 pencilRun 不认');
}
{
  // 删线索：每一次删除都必须让铅笔路径仍然推得完
  // ⚠ 这块盘原先写的是 ['2.2','...','1.1']（顶行两个 2、底行两个 1）—— 穷举器对它报 NONE，手推也是 NONE：
  // 底行两个 1 格岛要孤住，第2行1列、第2行3列、第3行2列 三格全得是墙，这已经吃满 3 格墙的额度；
  // 剩下第1行那三格白要同时养两个 2 格岛，两个岛都只能抢中间那一格 → 并成一岛超编。
  // 死盘没什么可删的，"这块盘本身推得完"当场红。换成四角各一个 1 的合法盘。
  const g = grid(['1.1', '...', '1.1']);
  const before = pencilRun(3, 3, g.clue);
  is(!!before, '这块盘本身推得完');
  const rand = makeRng('prune.v1');
  const pr = pruneClues(3, 3, g.clue, rand, { passes: 4, extraGate: (c, rest) => rest >= 2 });
  is(!!pencilRun(3, 3, pr.clue), '删完还是推得完（这是闸门，不是运气）');
  is(pr.deleted <= pr.trials, `删掉的次数不超过尝试次数（${pr.deleted}/${pr.trials}）`);
  let left = 0;
  for (let t = 0; t < pr.clue.length; t++) if (pr.clue[t] > 0) left++;
  is(left >= 2, `minClues 的闸门生效（剩 ${left} 条）`);
}
{
  // 端到端：**五个档位各出一局**，逐项验收（原先只跑前三档，高手/大师那条腿等于没测过）
  for (const tier of TIERS.map((t) => t.key)) {
    const t = tierByKey(tier);
    is(!!t, `档位 ${tier} 存在`);
    const g = generateOne({
      w: t.w, h: t.h, maxIsland: t.maxIsland, blackRatio: t.blackRatio,
      minClues: t.minClues, band: t.band, attempts: t.attempts, seed: 'e2e', budget: 1200000,
    });
    if (!is(g.ok, `${t.name} 出得来局（${g.reason || ''} ${JSON.stringify(g.stats || {})}）`)) continue;
    eq(g.w, t.w, '宽度按档位');
    eq(g.clue.length, t.w * t.h, '线索表长度对');
    eq(g.clues, g.clue.filter((v) => v > 0).length, '线索数自洽');
    is(g.clues >= t.minClues, `线索数不低于档位下限（${g.clues}）`);
    is(g.score >= t.band[0] && g.score <= t.band[1], `${t.name} 的分数落在量出来的区间里（${g.score} ∈ ${JSON.stringify(t.band)}）`);
    const b = createBoard({ w: g.w, h: g.h, clue: Uint8Array.from(g.clue) });
    const s = solve(b);
    eq(s.ok, true, `${t.name} 的盘铅笔推得完（零猜测）`);
    eq(paint(b, s.cell).includes('?'), false, `${t.name} 的盘没有未定格`);
    eq(verify(b, s.cell).length, 0, `${t.name} 的盘过独立验收`);
    eq(g.cross.mismatch, 0, `${t.name} 的盘与穷举器逐格一致`);
    eq(g.cross.status, UNIQUE, `${t.name} 的盘被穷举器确认唯一解`);
    ne(g.cross.level, 'pencil', `${t.name} 这一档穷举器跑完了（不是只剩铅笔一条腿）`);
    is(g.cross.nodes > 0, '对账真的搜过');
    is(Array.isArray(g.breakdown ? Object.keys(g.breakdown) : []) && Object.keys(g.breakdown).length > 0, '难度分解表非空');
    const recalc = Object.entries(g.breakdown).reduce((a, [k, n]) => a + n * Rules[k].weight, 0);
    eq(Math.round((recalc + 0.5 * g.sweeps) * 10) / 10, g.score, '分数 = Σ权重×出手 + 0.5×回扫，能重算');
    eq(g.steps, b.n, `${t.name} 的盘步数 = 格数（每格恰好一次）`);
    is(g.sweeps >= 1, `${t.name} 至少扫了一轮（${g.sweeps}）`);
  }
}
{
  // 确定性：同一个 seed 出同一块盘
  const spec = { w: 5, h: 5, maxIsland: 2, blackRatio: 0.65, minClues: 4, seed: 'determinism', attempts: 300 };
  const a = generateOne(spec);
  const b = generateOne(spec);
  is(a.ok && b.ok, '两次都出得来');
  eq(a.clue.join(','), b.clue.join(','), '同 seed 同盘');
  eq(a.score, b.score, '同 seed 同分');
  const c = generateOne({ ...spec, seed: 'determinism-2' });
  is(!c.ok || c.clue.join(',') !== a.clue.join(','), '换 seed 换盘');
  const best = bestOf({ ...spec, samples: 3, target: a.score });
  is(best.ok, 'bestOf 也能出货');
  // 原先这条写的是 `|best.score - a.score| <= |a.score - a.score| + 0.001` —— 右边恒等于 0，
  // 等于要求 bestOf 复现同一个 seed 的分数，那是"换 seed 换盘"那条断言反对的事。
  // 正确的说法是：挑中的这个必须是**这批样本里**离目标最近的（pool 被带出来就是为了复核这句）。
  is(best.pool.every((p) => Math.abs(best.score - a.score) <= Math.abs(p.score - a.score) + 1e-9), 'bestOf 挑的是最靠近目标分的');
}
{
  // 失败必须带可分辨的 reason，而且名字要指对地方 —— 指错地方就会把人引去修一个没坏的东西。
  // 原先这块盘写的是 maxIsland:1 + blackRatio:0.985，我当它"铁定出不来"，实测却出得来：
  // 5×5 上不出现 2×2 全黑的黑格最多能有 21 格（白格只剩 (1,1)(1,3)(3,1)(3,3) 四个），
  // 全 1 格岛正好是那个形状 —— 那根轴根本没拧死。
  // 真正拧得死的是 minClues：岛的块数就是满线索盘的数字数上限，25 格盘按 0.55 的黑密度只剩
  // 11 格白，岛最多 5 格 → 数字最多数到 11 条，够不到 25 → 报 not-enough-clues（轴的问题，不是重试能救的）。
  const g = generateOne({ w: 5, h: 5, maxIsland: 5, blackRatio: 0.55, minClues: 25, seed: 'x', attempts: 6 });
  eq(g.ok, false, '把轴拧死就该出不了题');
  eq(g.reason, 'not-enough-clues', '原因名字指的是轴，不是铅笔、也不是对账');
  is(typeof g.reason === 'string' && g.reason.length > 3, `失败原因说得出名字（${g.reason}）`);
  is(!!g.stats, '失败也带 stats');
  const g2 = generateOne({ w: 5, h: 5, maxIsland: 2, blackRatio: 0.65, minClues: 4, seed: 'band', attempts: 300, band: [99999, 99999] });
  eq(g2.ok, false, '分数区间够不着就该失败');
  eq(g2.reason, 'band', '原因就叫 band');
}
{
  // crossCheck 自己能抓"多解"
  const multi = { w: 4, h: 4, clue: Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0]) };
  const r = crossCheck(4, 4, multi.clue, new Uint8Array(16), { budget: 200000 });
  is(r.status === MANY || r.status === NONE || r.status === UNIQUE, `crossCheck 报得出状态（${r.status}）`);
  const over = crossCheck(10, 10, Uint8Array.from(new Array(100).fill(0).map((_, i) => (i % 7 === 0 ? 2 : 0))), new Uint8Array(100), { budget: 200 });
  eq(over.level, 'pencil', '穷举器超预算时降级成"只剩铅笔一条腿"');
  eq(over.status, OVERBUDGET, '状态如实报 OVERBUDGET');
  eq(over.unique, false, '超预算不许自称已确认唯一');
}
{
  // TIERS 的结构与命名
  eq(TIERS.length, 5, '五个档位');
  eq(TIERS.map((t) => t.name).join(','), '初学,熟手,常规,高手,大师', '档位名');
  for (let i = 1; i < TIERS.length; i++) {
    is(TIERS[i].w * TIERS[i].h > TIERS[i - 1].w * TIERS[i - 1].h, `${TIERS[i].name} 比 ${TIERS[i - 1].name} 大`);
    is(Array.isArray(TIERS[i].band) && TIERS[i].band.length === 2, `${TIERS[i].name} 有分数区间`);
    is(TIERS[i].band[0] >= TIERS[i - 1].band[0], `${TIERS[i].name} 的区间不比下一级低`);
    is(TIERS[i].band[0] <= TIERS[i].band[1], `${TIERS[i].name} 的区间上下界没写反`);
    is(TIERS[i].maxIsland >= TIERS[i - 1].maxIsland, `${TIERS[i].name} 的岛不小于下一级（尺寸×密度两根轴都得往同一方向走）`);
  }
  eq(tierByKey('nope'), null, '不认识的档位返回 null');
}
{
  // 为什么岛那根轴只推到 4（高手/大师档从 岛≤6、岛≤7 改小的原因）：
  // 出货的第一道闸门是"**满线索盘**铅笔推得完"（generateOne 的 fullNotPencil），这道闸门对
  // maxIsland 陡得吓人。下面是配对实测：同一个 seed 序列 `tier-yield.<盘>#<i>`，每局都从头开局，
  // 只改 maxIsland，数 200 次种盘里有多少次过闸门（种盘本身每次都成功，所以瓶颈不在种盘）。
  // 实测：8×8 岛≤4 7/200、岛≤5 3/200、岛≤6（旧写法）2/200；10×10 岛≤4 2/200、岛≤5 0/200、岛≤7（旧写法）0/200。
  // 断言写的是这个**排序**，不是嘴上说"岛大了更难"：改小档位参数的理由必须能被复核。
  const yieldOf = (w, h, maxIsland, blackRatio, n, tag) => {
    let plants = 0;
    let gate = 0;
    for (let i = 0; i < n; i++) {
      const rand = makeRng(`tier-yield.${tag}#${i}`);
      const land = plant(w, h, rand, { blackRatio, maxIsland, tries: 60 });
      if (!land) continue;
      plants++;
      if (pencilRun(w, h, cluesFrom(w, h, land, (g) => rand.pick(g)))) gate++;
    }
    return { plants, gate };
  };
  const N = 200;
  const e4 = yieldOf(8, 8, 4, 0.55, N, '8x8');
  const e5 = yieldOf(8, 8, 5, 0.55, N, '8x8');
  const e6 = yieldOf(8, 8, 6, 0.55, N, '8x8');
  const m4 = yieldOf(10, 10, 4, 0.6, N, '10x10');
  const m5 = yieldOf(10, 10, 5, 0.6, N, '10x10');
  const m7 = yieldOf(10, 10, 7, 0.5, N, '10x10');
  is(e4.plants >= N - 10 && m4.plants >= N - 10, `种盘不是瓶颈（8×8 种成 ${e4.plants}/${N}、10×10 种成 ${m4.plants}/${N}）`);
  is(e4.gate > e5.gate && e5.gate >= e6.gate, `8×8 过闸门：岛≤4 ${e4.gate}/${e4.plants} > 岛≤5 ${e5.gate}/${e5.plants} ≥ 岛≤6 ${e6.gate}/${e6.plants}`);
  is(m4.gate > m5.gate && m5.gate >= m7.gate, `10×10 过闸门：岛≤4 ${m4.gate}/${m4.plants} > 岛≤5 ${m5.gate}/${m5.plants} ≥ 岛≤7 ${m7.gate}/${m7.plants}（旧的大师档一局都出不了）`);
  is(TIERS[3].maxIsland === 4 && TIERS[4].maxIsland === 4, '档位表确实把岛轴停在 4，尺寸与黑密度那两根继续往上走');
}

// =====================================================================
begin('E · 随机数与日课种子');
// =====================================================================
{
  const a = makeRng('same');
  const b = makeRng('same');
  eq(a.next(), b.next(), '同种子第一个数相同');
  eq([0, 1, 2, 3, 4].map(() => Math.floor(a.next() * 100)).join(','), [0, 1, 2, 3, 4].map(() => Math.floor(b.next() * 100)).join(','), '连着取五个也一样');
  const c = makeRng('other');
  ne(Math.floor(c.next() * 1e9), Math.floor(makeRng('same2').next() * 1e9), '换种子就该换数（偶然相同也算红）');
  const r = makeRng(12345);
  const arr = [1, 2, 3, 4, 5, 6];
  const sh = r.shuffle(arr);
  is(sh.length === 6 && new Set(sh).size === 6, 'shuffle 不重不漏');
  const ints = [];
  for (let i = 0; i < 200; i++) ints.push(r.int(7));
  is(ints.every((v) => v >= 0 && v < 7), 'int(7) 全在范围里');
  is(new Set(ints).size === 7, 'int(7) 200 次里七个数都出现过');
  is(typeof hashSeed('2026-09-27') === 'number', 'hashSeed 给数字');
  eq(hashSeed('2026-09-27'), hashSeed('2026-09-27'), 'hashSeed 稳定');
  ne(hashSeed('2026-09-27'), hashSeed('2026-09-28'), '不同日期不同种子');
  eq(dailySeed('2026-09-27'), hashSeed('nurikabe.daily.2026-09-27'), '日课种子就是那条式子');
  eq(seedFrom('a', 'b'), hashSeed('a|b'), 'seedFrom 就是拼起来再 hash');
  const br = makeRng(99).branch('x');
  is(typeof br.next() === 'number', '子种子也能取数');
  ne(br.next(), makeRng(99).next(), '子种子和父种子不是一条流');
}

// ---------- 收口 ----------
perSection.push([section, total, failures.length]);
console.log('');
for (const [name, n, f] of perSection) console.log(`  ${f ? '✗' : '✓'} ${name} — ${n} 条断言${f ? `，${f} 条红` : ''}`);
console.log('');
if (failures.length) {
  console.log(`红了 ${failures.length} 条：`);
  for (const f of failures) console.log('  ✗ ' + f);
}
console.log(`断言 ${total - failures.length}/${total} 通过`);
process.exit(failures.length ? 1 : 0);
