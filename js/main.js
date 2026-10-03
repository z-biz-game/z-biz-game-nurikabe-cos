// 接线层：DOM、指针、键盘、时钟、存档，以及下一轮浏览器闸要用的 window.nurikabe。
//
// 这里**一条规则都不写**。"这一格是不是撞了二二全黑""下一步线索逼得出什么""这盘赢了没有"
// 全部来自 js/engine/nurikabe.js，经 js/ui/game.js 的 state()/diag 上来；画布只复述那些结论。
// 之所以能这么绝对：complete() 是照规则原文查盘面的独立实现，提示读的是**只由线索产生**的
// 那份脚本 —— 于是"界面说赢了"和"岛都凑满、墙是一整块"不可能各说各话。
//
// 分工还有一条：颜色/间距/时长只在 js/theme.js 里，经 applyThemeVars() 落到 CSS 变量，
// 画布 import 的是同一批对象。所以"把触摸目标改成 44""减少动效"这种事只有一处可改。
//
// 存档只带（原点 seed、档位、已经落下的墨、这一局的代价、这一局走了多久）：生成器是确定性
// 的，盘面从来不穿过存储旅行，续档就用同一个 seed 把同一张盘重搭出来（见 js/store.js 头部）。

import { Game, makePuzzle, TIERS, tierByKey, UNKNOWN, WHITE, BLACK, colorName } from './ui/game.js';
import { BoardView } from './render/board.js';
import { Rules, RULE_ORDER, solve } from './engine/nurikabe.js';
import { dailySeed } from './engine/rng.js';
import { KEY, Store, rleDecode } from './store.js';
import { Sound } from './audio/synth.js';
import { Cell, Motion, Space, applyThemeVars, prefersReducedMotion, setReduceMotion } from './theme.js';

const VERSION = '1.0.0';

const $ = (sel) => document.querySelector(sel);

// 元素表：一条对一个 index.html 里的 id。写全是有意的 —— 少一条就是"那块 UI 没人负责"，
// 同组织刚因为 el.wrap 没进表而把画布尺寸算成了窗口宽（见下面 availBox 的注释）。
const el = {
  app: $('#app'),
  soundBtn: $('#btn-sound'),
  motionBtn: $('#btn-motion'),
  viewMenu: $('#view-menu'),
  tiers: $('#tier-list'),
  resumeCard: $('#resume-card'),
  resumeName: $('#resume-name'),
  resumeMeta: $('#resume-meta'),
  resumeBtn: $('#btn-resume'),
  records: $('#record-list'),
  ruleList: $('#rule-list'),
  viewGame: $('#view-game'),
  name: $('#stat-name'),
  tier: $('#stat-tier'),
  proof: $('#stat-proof'),
  time: $('#stat-time'),
  // wrap 是画布的定位父级（遮罩盖它），stage 才是量宽度该量的那个盒子：
  // #board-wrap 是 align-self:center 的 shrink-to-fit，从它自己量会跟画布尺寸互相定义。
  wrap: $('#board-wrap'),
  canvas: $('#board'),
  winVeil: $('#win-veil'),
  winMeta: $('#win-meta'),
  winRecord: $('#win-record'),
  againBtn: $('#btn-again'),
  menu2Btn: $('#btn-menu-2'),
  stateLine: $('#state-line'),
  modeWall: $('#btn-mode-wall'),
  modeLand: $('#btn-mode-land'),
  hintBtn: $('#btn-hint'),
  hintCount: $('#hint-count'),
  undoBtn: $('#btn-undo'),
  newBtn: $('#btn-new'),
  clearBtn: $('#btn-clear'),
  menuBtn: $('#btn-menu'),
  moves: $('#stat-moves'),
  hints: $('#stat-hints'),
  filled: $('#stat-filled'),
  unknown: $('#stat-unknown'),
  islands: $('#stat-islands'),
  wall: $('#stat-wall'),
  conflicts: $('#stat-conflicts'),
  score: $('#stat-score'),
  hintRule: $('#hint-rule'),
  hintLine: $('#hint-line'),
  resetBtn: $('#btn-reset'),
};

let game = null;
let view = null;
let ticker = 0;
let pulse = null; // 提示刚点名的那一格：{cell, color}。全屏唯一的"看这里"，不按时钟自己消失
let drag = null; // 还没抬起的那只手：{value, cells:Set}
let day = null; // 当前这局是不是日课（是的话记住是哪一天）
let lastBox = { w: 0, h: 0 }; // 上一次量到的可用盒：只有它变了才值得重排一次画布
let lastGeneration = null; // 上一次出题的耗时/尝试数，如实报出来，不吹成"瞬时"
let lastError = null; // 出不了题时的原话（生成器的 reason），闸和玩家读的是同一条
let seedCounter = 0;

// ---- 时钟：用时住在接线层，因为 Game 不记账时间 ----

let elapsedBase = 0;
let clockFrom = 0;

function clockReset(ms = 0) {
  elapsedBase = ms | 0;
  clockFrom = Date.now();
}

function nowMs() {
  return elapsedBase + (clockFrom ? Math.max(0, Date.now() - clockFrom) : 0);
}

// 暂停/继续的是同一个累计器：回选档、切到后台都把这段跑掉的时间结转到 base 里，
// 于是"关掉标签页十分钟"不会被算进这一局的用时。
function clockPause() {
  if (!clockFrom) return;
  elapsedBase = nowMs();
  clockFrom = 0;
}

function clockResume() {
  if (!clockFrom && game && game.status === 'playing') clockFrom = Date.now();
}

function fmtMs(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 绘制与尺寸 ------------------------------------------------------------------------------

/**
 * 布局坐标里的"上沿"。不用 getBoundingClientRect().top：.view 的入场动画 rise 带着
 * translateY(6px)， rect 值是跟着动画帧跑的 —— 实测过一次不到 0.1px 的偏移就把 10×10
 * 的格子从 59 挤成 58（可用高正好卡在 622 与 621.9 那条线上）。offsetTop 走
 * offsetParent 链是纯布局值，动画再怎么动都不碰它，加上 offsetParent 的边框就回到视口坐标。
 */
function layoutTop(node) {
  let y = 0;
  for (let n = node; n; n = n.offsetParent) {
    y += n.offsetTop;
    if (n.offsetParent) y += parseFloat(getComputedStyle(n.offsetParent).borderTopWidth) || 0;
  }
  return Math.max(0, Math.round(y - (window.scrollY || 0)));
}

/**
 * 画布能占多大：宽从 .stage 的内容盒量（它是 #board-wrap 的父级，宽度由 #view-game 的网格列
 * 决定，与画布多大无关），高从视口底往回减掉画布上方那些真正占掉的高度。
 *
 * 两条都不要猜：不要从窗口宽猜（skyscraper 就死在 el.wrap 没进元素表、于是照着 window 算），
 * 也不要从 #board-wrap 自己量 —— 它是 align-self:center 的 shrink-to-fit，画多大就多宽，
 * 拿它的宽度当输入就是让一格的大小追着自己刚画出来的结果跑。同理不看 .stage.clientHeight
 * （第一版看了，5×5 的初学盘被自己撑出来的 303px 挤成了 42px 一格）。
 */
function availBox() {
  const stage = el.viewGame.querySelector('.stage');
  const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  if (!stage) return { w: 240, h: 240, headH: 0, lineH: 0 };
  const cs = getComputedStyle(stage);
  const padX = num(cs.paddingLeft) + num(cs.paddingRight);
  const gap = num(cs.rowGap) || Space.gutter;
  const head = stage.querySelector('.stage-head');
  const headH = head ? head.offsetHeight : 0;
  const lineH = el.stateLine.offsetHeight || 0;
  const top = layoutTop(stage);
  return {
    // 取整：格子边长是 floor(可用高 / 行数) 之类的除法，输入带 0.1px 的小数就等于
    // 把"同一尺寸连开两盘必须是同一个数"这件事押在四舍五入的运气上。
    w: Math.round(Math.max(240, Math.min(stage.clientWidth - padX, 680))),
    // 数墙是一眼要看全的盘：画布上沿到视口顶是实测量出来的，剩下的高度才给盘面，
    // 宁可留白也不许逼着人往下滚着找边界。
    h: Math.round(Math.max(240, Math.min(window.innerHeight - top - num(cs.paddingTop) - headH - gap * 2 - lineH - Space.page, 680))),
    headH,
    lineH,
  };
}

function relayout(force = false) {
  if (!game || !view) return null;
  const box = availBox();
  if (!force && view.geo.cell && Math.abs(box.w - lastBox.w) < 1 && Math.abs(box.h - lastBox.h) < 1) return view.geo;
  lastBox = box;
  return view.resize(game, box.w, box.h);
}

function paint() {
  if (!view || !game) return;
  view.draw(game, {
    pulse,
    preview: drag && drag.cells.size ? { cells: [...drag.cells] } : null,
  });
}

/**
 * 圈住提示点名的那一格，而且只圈这一格：它跟着盘面活着，直到下一步落子或下一条提示把它换走。
 * 这里原来挂的是 Motion.line 的倒计时（到点就不画），减少动效时 until 直接算成 0 ——
 * 于是"减少动效也照样点名那一格"这句注释自己把它做的事说反了。
 */
function markPulse(cell, color = null) {
  if (cell == null || cell < 0) return;
  pulse = { cell, color };
  paint();
}

// ---- 读数：一个地方写，别处只读（每一句数字都是引擎重算的） ----------------------------------

/** 状态行：只复述 diagnose()/verify() 的结论，界面自己不数格子。 */
function stateMessage(st) {
  const why = game.violated.find((b) => b.why !== '还有未定的格');
  if (st.conflicts > 0) {
    const where = why && why.cell != null ? `（${game.board.cellName(why.cell)}）` : '';
    const more = st.conflicts > 1 ? `另有 ${st.conflicts - 1} 处` : '';
    return {
      kind: 'bad',
      text: `${st.conflicts} 处和规则对不上：${why ? why.why : ''}${where}${more ? '，' + more : ''}。撤销一步再想，别往下猜。`,
    };
  }
  if (st.status === 'won') {
    return {
      kind: 'good',
      text: `岛都凑满，墙是一整块，没有一个 2×2 全黑 —— 引擎按规则原文逐格查过，这一局成立了。`,
    };
  }
  const notes = [];
  if (st.white > st.whiteNeed) notes.push(`白岛已经 ${st.white} 格，可所有数字加起来只要 ${st.whiteNeed} 格`);
  if (st.black > st.blackNeed)
    notes.push(`黑墙已经 ${st.black} 格，而这一盘的墙只能是 ${st.blackNeed} 格（${st.total} 格减掉数字之和 ${st.whiteNeed}）`);
  if (st.islandsDone < st.clues && st.filled === st.total) notes.push(`${st.clues - st.islandsDone} 个岛还没凑满`);
  if (st.wallPieces > 1) notes.push(`墙断成了 ${st.wallPieces} 块，必须连成一整片`);
  if (st.stuck) notes.push('剩下的格线索已经推不动了，得自己找下一步');
  if (!notes.length) {
    return {
      kind: '',
      text: `${st.filled}/${st.total} 格已定，${st.unknown} 格未定 · 线索共 ${st.script} 步，已经走完 ${st.cursor} 步`,
    };
  }
  return { kind: 'note', text: `${notes.join('；')}。` };
}

function setClass(node, name, on) {
  if (node) node.classList.toggle(name, !!on);
}

function syncStats() {
  if (!game) return null;
  const st = game.state();
  const size = `${game.w}×${game.h}`;
  el.name.textContent = day ? `日课 ${day}` : `${st.name} ${size}`;
  el.tier.textContent = `${st.name} · ${size}`;
  el.tier.dataset.tier = String(st.tier);
  el.proof.textContent =
    st.crossLevel === 'count' ? '证明 两条：铅笔推完 + 穷举逐格对账' : `证明 一条：铅笔推完（穷举器 ${st.crossStatus}）`;
  el.proof.className = `chip proof-${st.crossLevel === 'count' ? 'count' : 'pencil'}`;
  el.time.textContent = fmtMs(nowMs());
  el.moves.textContent = st.moves;
  el.hints.textContent = st.hints;
  el.hintCount.textContent = st.hints;
  el.filled.textContent = `${st.filled}/${st.total}`;
  el.unknown.textContent = st.unknown;
  el.islands.textContent = `${st.islandsDone}/${st.clues}`;
  el.wall.textContent = st.wallPieces === 1 && st.wallDone ? '1 块·已连成' : String(st.wallPieces);
  el.conflicts.textContent = st.conflicts;
  el.score.textContent = st.score == null ? '—' : Number(st.score).toFixed(1);
  setClass(el.conflicts.closest('.stat'), 'bad', st.conflicts > 0);
  setClass(el.filled.closest('.stat'), 'bad', st.filled === st.total && st.status !== 'won');
  setClass(el.unknown.closest('.stat'), 'bad', st.unknown === 0 && st.status !== 'won');
  // 只有"没达成"才红：凑满的岛数是进展，墙连成一块是胜利条件本身。
  setClass(el.islands.closest('.stat'), 'bad', st.status !== 'won' && st.filled === st.total && st.islandsDone < st.clues);
  setClass(el.wall.closest('.stat'), 'bad', st.status !== 'won' && st.black > 0 && st.wallPieces > 1);
  const msg = stateMessage(st);
  el.stateLine.className = 'conflict-line' + (msg.kind === 'good' ? ' good' : '');
  el.stateLine.textContent = msg.text;
  return st;
}

function syncAll() {
  const st = syncStats();
  if (!st) return null;
  relayout();
  paint();
  return st;
}

// ---- 存档 ------------------------------------------------------------------------------------

function flushResume() {
  if (!game || game.status === 'won') return;
  Store.saveResume(
    { ...game.puzzle, w: game.w, h: game.h, day },
    game.st.cell,
    nowMs(),
    { moves: game.moves, hints: game.hints }
  );
}

function renderRecords() {
  el.records.innerHTML = '';
  let any = false;
  for (const t of TIERS) {
    const b = Store.best(t.key);
    if (!b) continue;
    any = true;
    const li = document.createElement('li');
    li.dataset.tier = t.key;
    li.innerHTML = `<b>${t.name} ${b.size || `${t.w}×${t.h}`}</b><span class="mono">${fmtMs(b.ms)}</span> · 提示 ${b.hints} · ${b.moves} 步`;
    el.records.appendChild(li);
  }
  const totals = Store.totals();
  const li = document.createElement('li');
  li.dataset.tier = 'totals';
  li.innerHTML = `<b>累计</b><span>${totals.solved} 局推到底 · 求了 ${totals.hints} 次提示 · ${fmtMs(totals.ms)}</span>`;
  el.records.appendChild(li);
  if (!any) {
    const empty = document.createElement('li');
    empty.dataset.tier = 'none';
    empty.innerHTML = `<b>还没有纪录</b><span>选一档开一局；纪录先比提示次数，再看步数，最后看时间。</span>`;
    el.records.insertBefore(empty, li);
  }
}

function renderRuleList() {
  el.ruleList.innerHTML = '';
  for (const key of RULE_ORDER) {
    const r = Rules[key];
    const li = document.createElement('li');
    li.dataset.rule = key;
    li.innerHTML = `${r.name} <i>第 ${r.tier} 层 · 计 ${r.weight} 分</i>`;
    el.ruleList.appendChild(li);
  }
}

function renderResumeCard() {
  const r = Store.resume();
  const decided = r ? r.board.reduce((n, v) => n + (v === UNKNOWN ? 0 : 1), 0) : 0;
  const live = game && game.status !== 'won' && !el.viewGame.hidden;
  // 全空的档不叫"没打完的一局"：它和回选档再点一次那张卡是同一张盘，
  // 挂在菜单上只是一行写着"0 步 · 提示 0 次 · 0/25 格已定"的广告。
  if (!r || !decided || (live && r.seed === game.puzzle.originSeed && r.tier === game.puzzle.tier)) {
    el.resumeCard.hidden = true;
    return null;
  }
  const t = tierByKey(r.tier) || TIERS[0];
  el.resumeCard.hidden = false;
  el.resumeName.textContent = `没打完的一局：${t.name}（${t.w}×${t.h}）`;
  el.resumeMeta.textContent = `seed ${r.seed} · 用时 ${fmtMs(r.elapsedMs)} · ${r.moves} 步 · 提示 ${r.hints} 次 · ${decided}/${r.cells} 格已定`;
  return r;
}

// ---- 视图切换与菜单 ---------------------------------------------------------------------------

function show(which) {
  el.viewMenu.hidden = which !== 'menu';
  el.viewGame.hidden = which !== 'game';
  el.app.dataset.view = which;
  if (which === 'menu') {
    stopClock();
    flushResume();
    renderMenu();
  } else if (which === 'game') {
    startClock();
    relayout(true);
    paint();
  }
  return which;
}

function renderMenu() {
  renderTiers();
  renderRecords();
  renderRuleList();
  renderResumeCard();
}

function renderTiers() {
  el.tiers.innerHTML = '';
  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.tier = t.key;
    b.innerHTML =
      `<span class="tier-name">${t.name}</span>` +
      `<span class="tier-note">${t.w}×${t.h} · 岛最大 ${t.maxIsland} 格 · 至少 ${t.minClues} 个数字</span>` +
      `<span class="tier-size">实测 ${t.band[0]}–${t.band[1]} 分</span>`;
    b.addEventListener('click', () => beginTier(t.key));
    el.tiers.appendChild(b);
  }
  const d = document.createElement('button');
  d.type = 'button';
  d.className = 'tier';
  d.dataset.tier = 'daily';
  d.innerHTML =
    `<span class="tier-name">日课</span>` +
    `<span class="tier-note">${todayKey()} · 全球同一道题（种子由日期决定）</span>` +
    `<span class="tier-size">同一 seed 永远同一张盘</span>`;
  d.addEventListener('click', () => beginDaily());
  el.tiers.appendChild(d);
}

function menuNote(text) {
  lastError = text;
  const old = el.tiers.querySelector('.gen-fail');
  if (old) old.remove();
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'rules-note gen-fail';
  p.textContent = text;
  el.tiers.appendChild(p);
}

// ---- 开局 ------------------------------------------------------------------------------------

/**
 * 出一局并把它摆上屏幕。originSeed 传字符串就得到确定的那张盘（续档、日课、验证台都靠这条）。
 * 出不了题时如实说"这一档这会儿出不了题"并带上生成器给的原因，绝不下一个没被两条证明查过的盘。
 */
function startPuzzle(originSeed, tierKey, { resume = null, dayKey = null } = {}) {
  const t0 = Date.now();
  const puzzle = makePuzzle(originSeed, tierKey);
  if (!puzzle || !puzzle.ok) {
    const why = puzzle ? `${puzzle.reason}（试了 ${puzzle.stats ? puzzle.stats.attempts : 0} 次）` : '生成器没回话';
    lastGeneration = { ms: Date.now() - t0, ok: false, reason: why, tier: tierKey };
    menuNote(`这一档这会儿出不了题：${why}。换一档试试，或者把这句话原样报上去。`);
    return null;
  }
  lastGeneration = { ms: Date.now() - t0, ok: true, tier: puzzle.tier, score: puzzle.score };
  menuNote('');
  game = new Game(puzzle);
  day = dayKey;
  pulse = null;
  drag = null;
  // 续档的墨与盘面数不上（外来档、旧版本、写坏一半的）就整份丢掉，不做"截一截还能用"：
  // 截出来是一张每格都错位半列的盘，看着像进度，接着画只会越画越无解。
  // 步数/求助/用时记的都是"那一盘"的代价 —— 盘丢了，代价也就没有归属，一起归零。
  const ink = resume ? rleDecode(resume.ink, game.w * game.h) : null;
  if (ink) {
    game.load(ink);
    game.moves = resume.moves | 0;
    game.hints = resume.hints | 0;
    clockReset(resume.elapsedMs);
  } else {
    clockReset(0);
  }
  if (!view) view = new BoardView(el.canvas);
  lastBox = { w: 0, h: 0 }; // 换了一盘，尺寸就得重新量一次：不许沿用上一盘的格子边长
  el.winVeil.hidden = true;
  el.canvas.dataset.mode = game.mode === BLACK ? 'wall' : 'land';
  syncModeButtons();
  resetHintBox();
  show('game');
  syncAll();
  flushResume();
  return game;
}

function resetHintBox() {
  el.hintRule.textContent = '提示理由';
  el.hintLine.textContent =
    '按 提示 会说出一条线索现在真的逼得出的事实（哪一格必须是什么、凭哪条推理），它不报答案。你自己已经画反了的格子，提示会拒绝落子也不计费。';
}

function randomOriginSeed(tag = 'play') {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(buf);
  else buf[0] = ((Date.now() >>> 0) ^ (++seedCounter * 0x9e3779b9)) >>> 0;
  return `${tag}.${buf[0].toString(36)}.${Date.now().toString(36)}`;
}

function beginTier(key = (game && game.puzzle.tier) || TIERS[0].key, seed = null) {
  const t = tierByKey(key) || TIERS[0];
  return startPuzzle(seed || randomOriginSeed(`t.${t.key}`), t.key);
}

/** 日课：日期 → 种子（js/engine/rng.js 的 dailySeed），档位按天序轮换，两者都确定。 */
function beginDaily(when = new Date()) {
  const key = todayKey(when);
  const dayIndex = Math.floor(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) / 86400000);
  const t = TIERS[dayIndex % TIERS.length];
  return startPuzzle(dailySeed(key), t.key, { dayKey: key });
}

function resumeSaved() {
  const r = Store.resume();
  if (!r) return false;
  return !!startPuzzle(r.seed, r.tier, { resume: r });
}

function buildAgain() {
  return beginTier(game ? game.puzzle.tier : TIERS[0].key);
}

/** 同一张盘从头再来：seed 与档位都不换，只把墨水倒掉。日课重开走的也是这条。 */
function restart() {
  if (!game) return null;
  return startPuzzle(game.puzzle.originSeed, game.puzzle.tier, { dayKey: day });
}

function onWin() {
  clockPause();
  const ms = nowMs();
  const size = `${game.w}×${game.h}`;
  const isRecord = Store.recordBest(game.puzzle.tier, { ms, hints: game.hints, moves: game.moves, size });
  Store.recordSolve(ms, game.hints);
  Store.clearResume();
  el.winVeil.hidden = false;
  const st = game.state();
  el.winMeta.textContent = `${st.name} ${size} · 用时 ${fmtMs(ms)} · ${st.moves} 步 · 提示 ${st.hints} 次 · 实测 ${st.score} 分 · ${st.script} 步线索`;
  el.winRecord.textContent = isRecord
    ? '新纪录：这一局比存档里更不求人。'
    : `未破纪录：这一档最快的是 ${fmtMs(Store.best(game.puzzle.tier).ms)}，先比提示次数。`;
  Sound.win();
  syncStats();
  paint();
}

// ---- 时钟的启停 -------------------------------------------------------------------------------

function startClock() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!game) return;
    if (game.status === 'won') return;
    clockResume();
    el.time.textContent = fmtMs(nowMs());
  }, 1000);
}

function stopClock() {
  clearInterval(ticker);
  ticker = 0;
  clockPause();
}

// ---- 动作 ------------------------------------------------------------------------------------

function setMode(value) {
  if (!game) return null;
  game.mode = value === WHITE ? WHITE : BLACK;
  el.canvas.dataset.mode = game.mode === BLACK ? 'wall' : 'land';
  syncModeButtons();
  paint();
  return game.mode;
}

function toggleMode() {
  return setMode(game && game.mode === BLACK ? WHITE : BLACK);
}

function syncModeButtons() {
  const wall = !game || game.mode === BLACK;
  el.modeWall.setAttribute('aria-pressed', String(wall));
  el.modeLand.setAttribute('aria-pressed', String(!wall));
}

function afterChange() {
  const st = syncAll();
  if (!st) return null;
  if (st.status === 'won' && el.winVeil.hidden) onWin();
  flushResume();
  return st;
}

function tap(t, mode = game && game.mode) {
  if (!game || t < 0) return null;
  const step = game.tap(t, mode === undefined ? game.mode : mode);
  if (!step) return null;
  pulse = null; // 玩家自己落了子：引擎那句"看这里"就过期了
  Sound[step.value === UNKNOWN ? 'erase' : step.value === BLACK ? 'wall' : 'land']();
  if (game.diag.conflicts > 0) Sound.conflict();
  afterChange();
  return { cell: t, value: step.value, state: game.state() };
}

/** 一整笔（一次手势）：只留一条快照，撤销撤得掉一整笔而不是一格。 */
function stroke(cells, value) {
  if (!game || !Array.isArray(cells) || !cells.length) return null;
  const step = game.stroke(cells, value);
  if (!step) return null;
  Sound[value === UNKNOWN ? 'erase' : value === BLACK ? 'wall' : 'land']();
  if (game.diag.conflicts > 0) Sound.conflict();
  afterChange();
  return { cells: step.writes.map((w) => w.cell), value, state: game.state() };
}

function hint() {
  if (!game) return null;
  const h = game.hint();
  if (!h) return null;
  if (h.conflict) {
    Sound.conflict();
    el.hintRule.textContent = '提示拒绝落子';
    el.hintLine.textContent = h.conflict;
    markPulse(h.cell);
    syncAll();
    return h;
  }
  if (h.stalled) {
    el.hintRule.textContent = '线索到这里推完了';
    el.hintLine.textContent = h.text;
    syncAll();
    return h;
  }
  Sound.hint();
  el.hintRule.textContent = `${h.rule}（第 ${Rules[h.ruleKey].tier} 层推理）`;
  el.hintLine.textContent = h.why;
  markPulse(h.cell);
  afterChange();
  return h;
}

function undo() {
  if (!game) return null;
  const step = game.undo();
  if (!step) return null;
  Sound.undo();
  pulse = null;
  afterChange();
  return step;
}

/**
 * 清空我的落子 = 一步一步撤到底，不走引擎的 resetInk 捷径：
 * 直接把 st.cell 抹平会让 steps 与 st.history 错位，撤回来的就是别的盘的格子。
 * 提示撤回来还是提示（Game.undo 有意如此），所以这一键不会把"求过几次人"洗白。
 */
function clearInk() {
  if (!game) return null;
  let n = 0;
  while (game.undo()) n++;
  Sound.erase();
  pulse = null;
  afterChange();
  return { undone: n, state: game.state() };
}

/**
 * 「帮我把这盘推完」也只认 afterChange 这一个同步点：
 * 直接返回 game 的结果会让引擎算出 won 而界面还停在开局的空盘——读数、状态行、
 * 绿环、胜利横幅全都不动，玩家看着一个"已经赢了却没赢"的盘。
 */
function solveWithLogic(cap) {
  if (!game) return null;
  const res = game.solveWithLogic({ cap });
  afterChange();
  return res;
}

function setSound(on) {
  Sound.setEnabled(on);
  Store.setSetting('sound', !!on);
  el.soundBtn.setAttribute('aria-pressed', String(!!on));
  el.soundBtn.textContent = on ? '音效 开' : '音效 关';
  return !!on;
}

function setMotionReduced(on) {
  setReduceMotion(on);
  Store.setSetting('reduceMotion', !!on);
  document.body.classList.toggle('reduce-motion', !!on);
  el.motionBtn.setAttribute('aria-pressed', String(!!on));
  el.motionBtn.textContent = on ? '动效 减' : '动效 全';
  return !!on;
}

function resetSave() {
  Store.reset();
  game = null;
  day = null;
  pulse = null;
  drag = null;
  view = null;
  stopClock();
  applySettings();
  el.winVeil.hidden = true;
  show('menu');
  menuNote('存档已清空：纪录、日课与没打完的那一局都没了。');
}

// ---- 输入：画布（拖动落子，起笔在同色上就是擦） -------------------------------------------------

function beginDrag(ev) {
  if (!game) return;
  const t = view && view.geo.cell ? view.hitCell(ev.clientX, ev.clientY) : -1;
  if (t < 0) return;
  ev.preventDefault();
  if (el.canvas.setPointerCapture && ev.pointerId != null) {
    try {
      el.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* 指针已经不属于这个手势了，预览没有也不影响落子 */
    }
  }
  // 起笔那一格已经是手里的颜色 → 这一整笔是擦；否则是涂。
  const value = game.valueOf(t) === game.mode ? UNKNOWN : game.mode;
  drag = { value, cells: new Set([t]), pointerId: ev.pointerId };
  paint();
}

function moveDrag(ev) {
  if (!drag || !view || !view.geo.cell) return;
  if (drag.pointerId != null && ev.pointerId != null && ev.pointerId !== drag.pointerId) return;
  const t = view.hitCell(ev.clientX, ev.clientY);
  if (t < 0) return;
  if (drag.cells.has(t)) return;
  ev.preventDefault();
  drag.cells.add(t);
  paint();
}

function endDrag(ev) {
  if (!drag) return;
  const cells = [...drag.cells];
  const value = drag.value;
  drag = null;
  if (ev) ev.preventDefault();
  if (!cells.length) return;
  stroke(cells, value);
}

function bindCanvas() {
  el.canvas.addEventListener('pointerdown', beginDrag);
  el.canvas.addEventListener('pointermove', moveDrag);
  el.canvas.addEventListener('pointerup', endDrag);
  el.canvas.addEventListener('pointercancel', () => {
    drag = null;
    paint();
  });
  el.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

// ---- 输入：键盘（与 .keyhint 那一行写的是同一套） ------------------------------------------------

function onKey(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
  const k = ev.key;
  if (k === '1') setMode(BLACK);
  else if (k === '2') setMode(WHITE);
  else if (k === 'm' || k === 'M') toggleMode();
  else if (k === 'h' || k === 'H') hint();
  else if (k === 'z' || k === 'Z') undo();
  else if (k === 'Escape' && !el.viewGame.hidden) show('menu');
  else return;
  ev.preventDefault();
}

// ---- 绑定 ------------------------------------------------------------------------------------

function bind() {
  el.soundBtn.addEventListener('click', () => setSound(!Sound.enabled()));
  el.motionBtn.addEventListener('click', () => setMotionReduced(!prefersReducedMotion()));
  el.modeWall.addEventListener('click', () => setMode(BLACK));
  el.modeLand.addEventListener('click', () => setMode(WHITE));
  el.hintBtn.addEventListener('click', hint);
  el.undoBtn.addEventListener('click', undo);
  el.clearBtn.addEventListener('click', clearInk);
  el.newBtn.addEventListener('click', buildAgain);
  el.againBtn.addEventListener('click', buildAgain);
  el.menuBtn.addEventListener('click', () => show('menu'));
  el.menu2Btn.addEventListener('click', () => show('menu'));
  el.resumeBtn.addEventListener('click', () => resumeSaved());
  el.resetBtn.addEventListener('click', resetSave);
  bindCanvas();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => {
    relayout();
    paint();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushResume();
      clockPause();
    } else if (document.visibilityState === 'visible') {
      clockResume();
      syncAll();
    }
  });
  window.addEventListener('pagehide', () => {
    flushResume();
    clockPause();
  });
}

function applySettings() {
  setSound(Store.setting('sound') !== false);
  setMotionReduced(Store.setting('reduceMotion') === true);
}

// ---- 起局 ------------------------------------------------------------------------------------

applyThemeVars();
document.body.classList.toggle('reduce-motion', prefersReducedMotion());
applySettings();
bind(); // 先挂监听，再渲染：菜单一出现就得能点（13 个按钮 + 画布 + 键盘 + 窗口）
renderMenu();
show('menu');

// ---- 交给验证台 -------------------------------------------------------------------------------
//
// **下面挂出来的这一面，就是浏览器闸能读到的全部范围**：想断言一个读不到、
// 或者只能靠截图像素猜的东西，就是这里少挂了一样，而不是闸该绕过去。
// 读数一律来自引擎重算（state/diag/problems/board），动作一律走玩家那条路
// （tap/stroke/hint/undo/clearInk），没有任何"闸专用"的后门。
const surface = {
  version: VERSION,
  // ---- 读数 ----
  get game() {
    return game;
  },
  get view() {
    return view;
  },
  state: () => (game ? { ...game.state(), elapsedMs: nowMs(), day, won: el.winVeil.hidden === false } : null),
  diag: () => (game ? { ...game.diag, badCells: [...game.diag.badCells], markedCells: [...game.diag.markedCells], okIslands: [...game.diag.okIslands], problems: game.diag.problems.map((p) => ({ ...p, cells: p.cells || [] })) } : null),
  problems: () => (game ? game.violated.map((p) => ({ why: p.why, cell: p.cell == null ? -1 : p.cell })) : []),
  board: () => (game ? Array.from(game.st.cell) : []), // 0 未定 / 1 岛 / 2 墙
  owners: () => (game ? Array.from(game.st.owner) : []),
  clues: () => (game ? Array.from(game.board.clue) : []),
  valueOf: (t) => (game ? game.valueOf(t) : UNKNOWN),
  ownerOf: (t) => (game ? game.ownerOf(t) : -1),
  isNumber: (t) => (game ? game.isNumber(t) : false),
  cellName: (t) => (game && t >= 0 ? game.board.cellName(t) : ''),
  hintScript: () => (game ? game.script.map((r) => ({ cell: r.cell, value: r.value, rule: r.rule.key })) : []),
  nextFact: () => (game ? game.inkConflict() || (game.script[game.cursor] ? { cell: game.script[game.cursor].cell, value: game.script[game.cursor].value, rule: game.script[game.cursor].rule.key } : null) : null),
  text: () => ({
    stateLine: el.stateLine.textContent,
    name: el.name.textContent,
    tier: el.tier.textContent,
    proof: el.proof.textContent,
    time: el.time.textContent,
    moves: el.moves.textContent,
    hints: el.hints.textContent,
    filled: el.filled.textContent,
    unknown: el.unknown.textContent,
    islands: el.islands.textContent,
    wall: el.wall.textContent,
    conflicts: el.conflicts.textContent,
    score: el.score.textContent,
    hintRule: el.hintRule.textContent,
    hintLine: el.hintLine.textContent,
    winMeta: el.winMeta.textContent,
    winRecord: el.winRecord.textContent,
    resumeName: el.resumeName.textContent,
    resumeMeta: el.resumeMeta.textContent,
    menuNote: lastError || '',
  }),
  visible: () => ({ menu: !el.viewMenu.hidden, game: !el.viewGame.hidden, won: !el.winVeil.hidden, resume: !el.resumeCard.hidden }),
  geometry: () =>
    view && view.geo.cell
      ? { ...view.geo, cssWidth: el.canvas.clientWidth, cssHeight: el.canvas.clientHeight, box: availBox(), touchMin: Cell.min }
      : null, // 菜单上盘还没开：读数给 null，而不是抛一句 TypeError 让闸以为是页面坏了
  cellRect: (t) => (view && view.geo.cell ? view.cellRect(t) : null),
  hitAt: (x, y) => (view && view.geo.cell ? view.hitCell(x, y) : -1),
  save: () => JSON.parse(JSON.stringify(Store.data)),
  // 磁盘上那一串原文（不是 Sanitize 之后的对象）：脏存档测试塞进去什么，
  // 这里就得能读回什么，否则"塞进去的坏数据到底落没落"这件事本身就没被证明。
  rawSave: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null; // localStorage 被隐私模式挡住时，"读不到"就是这里的正确答案
    }
  },
  saveKey: () => KEY,
  storedResume: () => {
    const r = Store.resume();
    return r ? { ...r, board: Array.from(r.board) } : null;
  },
  lastGeneration: () => lastGeneration,
  error: () => lastError,
  // ---- 动作 ----
  show,
  renderMenu,
  startPuzzle,
  beginTier,
  beginDaily,
  resumeSaved,
  hasResume: () => !!Store.resume(),
  buildAgain,
  restart,
  setMode,
  toggleMode,
  tap,
  stroke,
  hint,
  undo,
  clearInk,
  solveWithLogic,
  setSound,
  setMotionReduced,
  resetSave,
  flushResume,
  syncAll,
  // ---- 引擎原件：闸要自己复算一遍，而不是信我报的数 ----
  engine: { Rules, RULE_ORDER, solve, makePuzzle, Game, BoardView, TIERS, tierByKey, Store, rleDecode, UNKNOWN, WHITE, BLACK, colorName },
  constants: { VERSION, STORE_KEY: KEY, TIERS: TIERS.map((t) => ({ ...t })), colors: { UNKNOWN, WHITE, BLACK } },
  motion: Motion,
};

window.nurikabe = surface;
window.App = surface; // 同组织样板的通用别名：验证台可以不分品类地敲 window.App

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    if (supported) btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();

// ---- 静音开关（N）-----------------------------------------------------------------
// M 在本仓已被玩法占用（见 keydown 里的模式切换），所以静音走 N。
// 这里只负责把按键翻译成"点一下音效按钮"：真静音在 js/audio/synth.js 里做
// （suspend AudioContext + 静音态不再新建振荡器节点），偏好由它落盘到 localStorage。
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName || '')) return;
  if (ev.key === 'n' || ev.key === 'N') {
    ev.preventDefault();
    $('#btn-sound').click();
  }
});
