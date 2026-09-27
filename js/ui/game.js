// 可玩的状态机：一次落子做什么、撤销拿走什么、什么时候算通关、提示被允许说什么。
//
// 两处刻意绑到 js/engine/nurikabe.js 上：
//   * 墨水就住在引擎自己的 `st.cell` / `st.owner` 里，通关判定用的是引擎独立的 `complete()`
//     ——它是照规则原文查盘面的，不是照这个文件的记账查的，所以"界面说我赢了"跟
//       "岛都凑满、墙是一整块、没有 2×2 全黑"这两件事不可能各说各话。
//   * 提示读的是**只由线索产生**的那份脚本（`solve(puzzle.board)`，从空盘推），
//     不是从玩家自己的落子里现推的。于是一条放错的白格永远不会让提示"顺着错误附和"：
//     线索逼得出什么，提示就说那一格必须是什么。

import {
  createState,
  setCell,
  cycleCell,
  snapshot,
  undo as undoState,
  solve,
  verify,
  complete,
  reachable,
  nextFact,
  diagnose,
  createBoard,
  Rules,
  UNKNOWN,
  WHITE,
  BLACK,
  NO_OWNER,
  FREE_WHITE,
} from '../engine/nurikabe.js';
import { generateOne, TIERS, tierByKey, scoreOf } from '../engine/generate.js';

export { UNKNOWN, WHITE, BLACK };

export const colorName = (v) => (v === WHITE ? '白' : v === BLACK ? '黑' : '未定');

/**
 * 出一局：把档位的两根轴交给生成器，并把它给出的**全部验收结论**一起带出来。
 * 这里不放任何兜底逻辑：出不了局就 return null，由界面如实说"这一档这会儿出不了题"，
 * 绝不出一个没被两条独立证明检查过的盘。
 */
export function makePuzzle(originSeed, tierKey = 'novice') {
  const t = tierByKey(tierKey) || TIERS[0];
  const g = generateOne({
    w: t.w,
    h: t.h,
    maxIsland: t.maxIsland,
    blackRatio: t.blackRatio,
    minClues: t.minClues,
    band: t.band,
    attempts: t.attempts,
    seed: originSeed,
    budget: 1500000,
  });
  if (!g.ok) return { ok: false, reason: g.reason, stats: g.stats, tier: t.key };
  const board = createBoard({ w: g.w, h: g.h, clue: Uint8Array.from(g.clue) });
  return {
    ok: true,
    tier: t.key,
    tierName: t.name,
    seed: `${originSeed}`,
    originSeed: `${originSeed}`,
    w: g.w,
    h: g.h,
    board,
    clue: g.clue,
    clues: g.clues,
    score: g.score,
    perCell: g.perCell,
    steps: g.steps,
    sweeps: g.sweeps,
    breakdown: g.breakdown,
    // 两条独立证明的结论要能在界面上被读出来，不是我嘴上说唯一：
    // cross.level === 'count' 才叫"穷举器真的跑完了"。
    cross: g.cross,
  };
}

export class Game {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.board = puzzle.board;
    this.w = puzzle.board.w;
    this.h = puzzle.board.h;
    this.st = createState(puzzle.board);
    // 整份提示脚本一次算完，只读线索。用的是生成器验收这个盘时同一次 solve()，
    // 所以提示说的每一步都是线索真的逼得出来的事实。
    this.script = solve(puzzle.board).rows;
    this.cursor = 0;
    // 一步 = 一条快照 = 一次可撤销的落子。它和 st.history 严格对齐：
    // tap/hint 走 setCell（自己压一条快照），stroke 自己压一条再直接改格子。
    this.steps = [];
    this.moves = 0;
    this.hints = 0;
    this.status = 'playing';
    this.mode = BLACK; // 数墙第一只手通常是落墙
    this.lastHint = null;
    this.recompute();
  }

  recompute() {
    this.diag = diagnose(this.board, this.st.cell);
    this.violated = verify(this.board, this.st.cell);
    this.stuck = !reachable(this.board, this.st.cell, this.st.owner);
    return this.diag;
  }

  cellAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }

  valueOf(t) {
    return t >= 0 && t < this.board.n ? this.st.cell[t] : UNKNOWN;
  }

  ownerOf(t) {
    return t >= 0 && t < this.board.n ? this.st.owner[t] : NO_OWNER;
  }

  isNumber(t) {
    return this.board.clue[t] > 0;
  }

  // 笔画（drag）用的写入：一次手势只留一条快照，撤销才撤得掉一整笔而不是一格。
  paint(t, value) {
    if (t < 0 || t >= this.board.n) return false;
    if (this.board.clue[t] > 0 && value === BLACK) return false;
    if (this.st.cell[t] === value) return false;
    this.st.cell[t] = value;
    this.st.owner[t] = value === WHITE ? (this.board.islandAt[t] >= 0 ? this.board.islandAt[t] : FREE_WHITE) : NO_OWNER;
    return true;
  }

  commit(kind, info) {
    this.steps.push({ kind, ...info });
    if (kind === 'hint') this.hints++;
    else this.moves++;
    this.recompute();
    this.checkWin();
    return this.steps[this.steps.length - 1];
  }

  // 单击：这一格已经是当前模式的色就擦掉，否则落成当前模式的色。数字格涂黑会被引擎拒绝。
  tap(t, mode = this.mode) {
    if (this.status === 'won' || t < 0) return null;
    const from = this.st.cell[t];
    const want = from === mode ? UNKNOWN : mode;
    if (!setCell(this.st, t, want)) return null;
    return this.commit('tap', { writes: [{ cell: t, from, to: want }], value: want });
  }

  // 拖动只涂一种色，不来回翻转 —— 从自己的线上擦回去不该把刚涂的吃掉。
  stroke(cells, value) {
    if (this.status === 'won') return null;
    const writes = [];
    const seen = new Set();
    for (const t of cells) {
      if (t < 0 || t >= this.board.n || seen.has(t)) continue;
      seen.add(t);
      if (this.st.cell[t] === value) continue;
      if (this.board.clue[t] > 0 && value === BLACK) continue;
      writes.push({ cell: t, from: this.st.cell[t], to: value });
    }
    if (!writes.length) return null;
    snapshot(this.st);
    for (const w of writes) this.paint(w.cell, w.to);
    return this.commit('stroke', { writes, value });
  }

  load(cells) {
    for (let t = 0; t < this.board.n; t++) {
      const v = cells[t];
      this.st.cell[t] = v === WHITE || v === BLACK ? v : UNKNOWN;
      this.st.owner[t] =
        v === WHITE ? (this.board.islandAt[t] >= 0 ? this.board.islandAt[t] : FREE_WHITE) : NO_OWNER;
    }
    this.recompute();
    this.checkWin();
    return this;
  }

  undo() {
    const step = this.steps.pop();
    if (!step) return null;
    undoState(this.st);
    for (const w of step.writes || []) {
      this.st.cell[w.cell] = w.from;
      this.st.owner[w.cell] =
        w.from === WHITE ? (this.board.islandAt[w.cell] >= 0 ? this.board.islandAt[w.cell] : FREE_WHITE) : NO_OWNER;
    }
    // 撤回来的提示还是一次被用过的提示：纪录是按"求了几次人"排的，
    // 退回去就能把六个提示退成一条干净的 提示 0，那条数字就废了。
    if (step.kind !== 'hint') this.moves = Math.max(0, this.moves - 1);
    this.recompute();
    return step;
  }

  // 玩家自己的墨水已经把盘推死：这时候提示不许落子、也不计费，只指出矛盾。
  inkConflict() {
    const f = nextFact(this.board, this.st.cell, this.st.owner);
    return f && f.conflict ? f : null;
  }

  // 线索逼得出、而玩家还没画下的那一步。脚本里在它之前的每一条都已经在盘上了，
  // 所以提示永远是真进展的一步；脚本走完而盘还没满，那是"推不动了"，不是"没话说也要收钱"。
  hint() {
    if (this.status === 'won') return null;
    const dead = this.inkConflict();
    if (dead) {
      return {
        conflict: `你的落子和数字已经矛盾了：${dead.conflict}。提示不落子，也不计费。`,
        cell: dead.cell,
      };
    }
    while (this.cursor < this.script.length) {
      const row = this.script[this.cursor];
      if (this.st.cell[row.cell] === row.value) {
        this.cursor++;
        continue;
      }
      if (this.st.cell[row.cell] !== UNKNOWN) {
        // 玩家在这格上画了相反的色：说清楚是哪一格、必须是什么，不落子、不计费
        return {
          conflict: `${this.board.cellName(row.cell)} 按线索必须是${colorName(row.value)}，你这里已经画了${colorName(this.st.cell[row.cell])}：提示不落子，也不计费。`,
          cell: row.cell,
        };
      }
      const from = this.st.cell[row.cell];
      setCell(this.st, row.cell, row.value);
      this.cursor++;
      this.commit('hint', { writes: [{ cell: row.cell, from, to: row.value }], value: row.value, rule: row.rule.name });
      const info = {
        rule: row.rule.name,
        ruleKey: row.rule.key,
        cell: row.cell,
        value: row.value,
        owner: row.owner,
        why: row.rule.text(this.board, row.detail),
        charged: true,
      };
      this.lastHint = info;
      return info;
    }
    return { stalled: true, text: '线索推不出新的格子了：剩下的格得自己找下一步。' };
  }

  checkWin() {
    this.status = complete(this.board, this.st.cell) ? 'won' : 'playing';
    return this.status === 'won';
  }

  // 只给验证台和"帮我把这盘推完"用：把线索脚本一条条落到底，写的每一格都是铅笔规则逼出来的。
  solveWithLogic({ cap = 4000 } = {}) {
    let k = 0;
    while (this.status !== 'won' && k++ < cap) {
      const before = this.steps.length;
      const h = this.hint();
      if (!h || h.stalled || h.conflict) break;
      if (this.steps.length === before) break;
    }
    return { status: this.status, steps: k };
  }

  state() {
    const g = this.diag;
    return {
      tier: this.puzzle.tier,
      name: this.puzzle.tierName,
      seed: this.puzzle.seed,
      originSeed: this.puzzle.originSeed,
      moves: this.moves,
      hints: this.hints,
      status: this.status,
      filled: g.filled,
      total: g.total,
      unknown: g.unknown,
      white: g.white,
      black: g.black,
      whiteNeed: this.board.whiteTotal,
      blackNeed: this.board.blackTotal,
      clues: g.clues,
      islandsDone: g.islandsDone,
      wallPieces: g.wallPieces,
      wallDone: g.wallDone,
      conflicts: g.conflicts,
      badCells: g.badCells,
      stuck: this.stuck,
      problems: this.violated.length,
      script: this.script.length,
      cursor: this.cursor,
      score: this.puzzle.score,
      crossLevel: this.puzzle.cross ? this.puzzle.cross.level : 'none',
      crossStatus: this.puzzle.cross ? this.puzzle.cross.status : 'none',
      steps: this.steps.length,
      mode: this.mode,
    };
  }

  // 难度分解：出货的每一局都带着它自己的规则出手表（生成器量出来的，不是标签）。
  breakdown() {
    return this.puzzle.breakdown || {};
  }
}

export { Rules, TIERS, tierByKey, scoreOf, cycleCell };
