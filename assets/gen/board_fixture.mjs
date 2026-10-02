// 图标母题的盘面来源：**用仓里出货的那台生成器**出题，而不是美术手搓一张好看的假盘。
//
// 为什么较真：图标的母题是"5×5 数墙，岛凑满、墙连成一片、没有 2×2 全黑"。手搓的图案
// 一旦违反任一条规则，就等于商品图上印着一个不成立的盘 —— 而这条承诺正是本仓的卖点。
// 所以这里的题面、逐格解、岛屿归属全部由 js/ui/game.js 的 makePuzzle() +
// js/engine/nurikabe.js 的 solve() 产出，并把两条独立证明的结论一起写进 JSON。
//
// 用法：node assets/gen/board_fixture.mjs            （写 assets/gen/board.json）
//       node assets/gen/board_fixture.mjs --print    （只打到 stdout，不落盘）
// 落盘的 JSON 是**确定的**：种子写死，生成器是纯函数，所以 make_art.py 不需要 node 也能重算图标。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makePuzzle } from '../../js/ui/game.js';
import { solve, diagnose, WHITE, BLACK, UNKNOWN } from '../../js/engine/nurikabe.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'board.json');

// SEEDS 是母题的全部输入：换图标 = 换这里的一行，且换完必须还能通过下面那道逐格复算。
const SEEDS = {
  icon: { seed: 'art|icon|novice', tier: 'novice' },
  tile5: { seed: 'art|tile|skilled', tier: 'skilled' },
};

function pick(spec) {
  const p = makePuzzle(spec.seed, spec.tier);
  if (!p || !p.ok) throw new Error(`${spec.seed} 出不了题：${p && p.reason}`);
  const solvedBoard = solve(p.board);
  const cell = Array.from(solvedBoard.cell);
  const diag = diagnose(p.board, cell);
  // 母题必须是**已解且成立**的盘：complete() 的判定住在引擎里，这里只复述它的结论。
  if (diag.conflicts !== 0) throw new Error(`${spec.seed} 解出来的盘仍有 ${diag.conflicts} 处冲突，不能当母题`);
  if (!diag.wallDone || diag.wallPieces !== 1) throw new Error(`${spec.seed} 的墙没连成一片`);
  if (diag.islandsDone !== diag.clues) throw new Error(`${spec.seed} 有岛没凑满`);
  return {
    seed: spec.seed,
    tier: p.tier,
    tierName: p.tierName,
    w: p.w,
    h: p.h,
    score: p.score,
    steps: p.steps,
    proof: p.cross ? p.cross.level : 'none',
    clue: Array.from(p.clue),
    cell,
    owner: Array.from(solvedBoard.owner),
    numbers: p.board.numbers.map((n) => ({ cell: n.cell, size: n.size, idx: n.idx })),
  };
}

const out = {
  note: '数墙图标的母题盘面：由 js/ui/game.js 的 makePuzzle 出题、js/engine/nurikabe.js 的 solve 复算，' +
    '两把尺都对上才落盘。手改这张表请连 note 一起改，别把它当装饰。',
  boards: { icon: pick(SEEDS.icon), tile: pick(SEEDS.tile5) },
};

const text = JSON.stringify(out, null, 1);
if (process.argv.includes('--print')) console.log(text);
else {
  const prev = (() => {
    try {
      return readFileSync(OUT, 'utf8');
    } catch {
      return '';
    }
  })();
  if (prev !== text) writeFileSync(OUT, text + '\n');
  const b = out.boards.icon;
  console.log(
    `board.json：${b.tierName} ${b.w}×${b.h} seed=${b.seed} 实测 ${b.score} 分 · ${b.steps} 步线索 · ` +
      `证明=${b.proof} · 墨=${b.cell.filter((v) => v === WHITE).length} 白/${b.cell.filter((v) => v === BLACK).length} 黑/` +
      `${b.cell.filter((v) => v === UNKNOWN).length} 未定`
  );
}
