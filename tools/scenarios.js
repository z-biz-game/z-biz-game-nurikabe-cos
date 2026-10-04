// 浏览器闸的场景层：由 tools/playtest.cjs 注入真 Chrome，对着真 DOM、真画布像素、真
// localStorage 逐条断言 index.html:135 页脚那句话。
//
// 断言的口径（一条都不许破）：
//   * 期望值**手写死**在这里。不许从产品当前的输出反推 want —— 那等于让 bug 自己签发通行证。
//     每一段 want 边上的注释都写清了它是从哪读来的（js/engine/nurikabe.js:154-211 的规则表、
//     js/render/board.js:16 的 pad=14、js/main.js:382 的档位卡文案……）。
//   * 读 DOM 文本、读几何、读画布像素，不读内部标志位。`game.status === 'won'` 说的是代码
//     想干什么，`#win-veil` 有没有命中盒、盘面那一格是不是纸白，才是玩家拿到了什么。
//   * 每条"应当等于"都走 eq，每条都配一个反例（对照格必须**不**显示被检的那个东西），
//     否则会有一条永远为真的断言混在条数里充数。
//   * 页内不引 Math.random / Date.now：所有盘面都由显式 seed 定位（见 >>>FIXTURE），
//     同一命令连跑两次的条数与结果逐字相同。
//
// >>>FIXTURE 这一段同时被 tools/verify.sh 用 node 从**同一批 js/engine 模块**重算一遍：
// 两边对不上就是"同一种子换引擎画两张盘"（见本文件底部 daily/layout 两条场景的钉）。
// 重算口径：makePuzzle(seed, tier) 与 makePuzzle(dailySeed(dateKey), TIERS[dayIndex % 5].key)，
// sol = solve(board).cell 逐格（0 未定 / 1 岛 / 2 墙）。
// >>>FIXTURE
const FIXTURE = [
  {
    kind: 'tier', seed: 'scn|novice|0', tier: 'novice', w: 5, h: 5, clues: 5, score: 37.5, steps: 25, sweeps: 2, nodes: 38,
    clue: '1,0,0,0,1,0,0,1,0,0,0,2,0,0,0,0,0,0,2,0,0,0,0,0,0',
    sol: '1222122122212122121222222',
  },
  {
    kind: 'tier', seed: 'scn|skilled|0', tier: 'skilled', w: 6, h: 6, clues: 8, score: 53, steps: 36, sweeps: 2, nodes: 296,
    clue: '0,0,0,0,0,2,0,0,2,0,0,0,0,0,0,2,0,2,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1',
    sol: '222211211222222121212121222222212121',
  },
  {
    kind: 'tier', seed: 'scn|regular|0', tier: 'regular', w: 7, h: 7, clues: 11, score: 71.5, steps: 49, sweeps: 2, nodes: 189,
    clue: '0,0,0,1,0,1,0,0,1,0,0,0,0,0,0,0,0,1,0,1,0,1,0,1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,2,0,0,0,4',
    sol: '2221212212222222212121212222222211212122211212111',
  },
  {
    kind: 'tier', seed: 'scn|expert|0', tier: 'expert', w: 8, h: 8, clues: 15, score: 95, steps: 64, sweeps: 2, nodes: 505,
    clue: '0,0,3,0,0,0,1,0,0,0,0,2,0,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1,0,1,0,0,0,0,2,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,3,0,1,0,1,0,0,0',
    sol: '1112221222211222212222121221212222122212121212221222221212121222',
  },
  {
    kind: 'tier', seed: 'scn|master|0', tier: 'master', w: 10, h: 10, clues: 23, score: 143, steps: 100, sweeps: 2, nodes: 437,
    clue: '0,0,0,1,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,1,0,1,0,1,0,2,1,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1,0,1,0,2,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,0,4,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,1,0,0,3,0',
    sol: '2221212122212222222121212121211222222222221212121212222222221212121212222111222221222221212221212211',
  },
  {
    kind: 'daily', date: '2026-09-28', dayIndex: 20724, seed: 1130709824, tier: 'master', w: 10, h: 10, clues: 22, score: 149.5, steps: 100, sweeps: 3, nodes: 2399,
    clue: '0,0,0,0,2,0,0,0,0,0,0,1,0,2,0,0,0,2,0,2,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1,0,1,0,0,0,1,0,0,2,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,2,0,2,0,0,2,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,1,0,1,0,0,0,1,0,1,0',
    sol: '2222112222212122212122212121212122122222121222121122221222222121221212212212121222211222221212221212',
  },
  {
    kind: 'daily', date: '2025-01-01', dayIndex: 20089, seed: 3470047700, tier: 'master', w: 10, h: 10, clues: 24, score: 147, steps: 100, sweeps: 3, nodes: 702,
    clue: '1,0,1,0,0,2,0,3,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,2,0,0,0,1,0,1,0,0,0,0,0,0,2,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,0,0,1,0,1,0,2,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,2,0,2,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1',
    sol: '1212212111222121222211212221212222211222212122221212221212122212222222122211211221212222222222212121',
  },
  {
    kind: 'daily', date: '2026-12-31', dayIndex: 20818, seed: 1344091318, tier: 'expert', w: 8, h: 8, clues: 14, score: 92.5, steps: 64, sweeps: 3, nodes: 275,
    clue: '0,0,0,1,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,1,0,2,0,1,0,1,0,0,0,0,0,0,0,0,0,3,0,1,0,2,0,0',
    sol: '2221212221222221222121222122211222212222212121211222222211212112',
  },
  {
    kind: 'daily', date: '2024-02-29', dayIndex: 19782, seed: 868902418, tier: 'regular', w: 7, h: 7, clues: 10, score: 77.5, steps: 49, sweeps: 4, nodes: 441,
    clue: '0,0,1,0,0,0,0,2,0,0,0,0,0,4,0,0,3,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,3,0,1,0,2,0,0,0',
    sol: '2212111122222112112122221222212221222212212121211',
  },
];
// <<<FIXTURE

// 档位卡的「实测 X–Y 分」：手抄自 js/engine/generate.js:35-91 的 TIERS[].band。
// 这份表与引擎对不上时，**两边都会红**（balance.mjs 的入带率闸 + 这一条），改文案没用。
const BANDS = {
  novice: '实测 34–43 分',
  skilled: '实测 51–63 分',
  regular: '实测 71–82 分',
  expert: '实测 89–110 分',
  master: '实测 139–161 分',
};

// 档位名的中文写法：手抄自 js/engine/generate.js:36-91 的 TIERS[].name。
// 卡面文案、状态行、续档卡三处都读这个名字，与引擎对不上就红 —— 拿 TIERS[i].name 比没钉住任何东西。
const TIER_NAMES = { novice: '初学', skilled: '熟手', regular: '常规', expert: '高手', master: '大师' };

// 提示脚本：手抄自 js/engine/nurikabe.js 的 solve(board).rows（"<格>:<值>:<规则 key>"）。
// novice = scn|novice|0 全 25 步；skilled = scn|skilled|0 前 8 步。
const SCRIPT_NOVICE =
  '0:1:number 4:1:number 7:1:number 11:1:number 18:1:number 1:2:full 5:2:full 3:2:full 9:2:full 2:2:full 6:2:full 8:2:full 12:2:full 14:2:reach 15:2:reach 20:2:reach 21:2:reach 22:2:reach 24:2:reach 13:1:three 16:1:three 17:2:bridge 10:2:full 19:2:full 23:2:full';
const SCRIPT_SKILLED_HEAD =
  '5:1:number 8:1:number 15:1:number 17:1:number 19:1:number 31:1:number 33:1:number 35:1:number';

// 七条推理的读数：名 / 层 / 分值，手抄自 js/engine/nurikabe.js:154-211 的 Rules 表，
// 排版照 js/main.js:315-323 renderRuleList() 的那句 innerHTML（`名字 <i>第 N 层 · 计 W 分</i>`）。
const RULE_ROWS =
  'number 数字即白 第 1 层 · 计 1 分' +
  '|full 满岛圈墙 第 2 层 · 计 1.5 分' +
  '|clash 两岛相逼 第 3 层 · 计 2 分' +
  '|reach 够不着即黑 第 2 层 · 计 1.5 分' +
  '|three 三黑补白 第 2 层 · 计 1.5 分' +
  '|fill 岛地必满 第 4 层 · 计 2.5 分' +
  '|bridge 孤墙必连 第 5 层 · 计 3 分';

// 违规盘：底座是 FIXTURE[0].sol（25 格全定的正解），ink 是手写的改格结果（一格一字符）。
// 每一例的 want 都写全了：
//   problems()  逐条「why@格号」，按 js/engine/nurikabe.js:538-561 verify() 的产出顺序
//               （先「还有未定的格」逐格、再数字格涂黑、再按白块查岛、再 2×2、最后墙块数）
//   conflicts   与 js/main.js:337 那条"未定不算冲突"的口径同一条
//   badCells    diagnose() 折出来的名册（**含**未定格 —— 它报的是"这些格要跟着一块看"）
//   marks       画布该套红框的格：violations 里扣掉「还有未定的格」那些（js/render/board.js 复述的就是这份）
//   rings       凑满且封死的岛：js/engine/nurikabe.js:568-607 的 islands[i].ok 那些数字格的格号
// 统计行四项读数的口径来自 js/main.js:325-335（`1 块·已连成` 只在墙真是一整块且没有未定时才出现）。
const CONFLICTS = [
  {
    name: '正解盘（对照例：一条违规都不许报）',
    ink: '1222122122212122121222222',
    problems: '', conflicts: 0, badCells: '', marks: '', rings: '0,4,7,11,18', okIdx: '0,1,2,3,4',
    wall: '1 块·已连成', filled: '25/25', unknown: '0', islands: '5/5',
    line: /^岛都凑满，墙是一整块，没有一个 2×2 全黑/,
  },
  {
    name: '岛超编：把第1行2列画白，1 格的岛成了 2 格',
    ink: '1122122122212122121222222',
    problems: '岛超编@0', conflicts: 1, badCells: '0,1', marks: '0,1', rings: '4,7,11,18', okIdx: '1,2,3,4',
    wall: '1 块·已连成', filled: '25/25', unknown: '0', islands: '4/5',
    line: /^1 处和规则对不上：岛超编（第1行1列）。撤销一步再想，别往下猜。$/,
  },
  {
    name: '两岛相邻：把第2行2列画白，1 与 2 两个数字并成一座岛',
    ink: '1222121122212122121222222',
    problems: '一个岛里两个数字@11', conflicts: 1, badCells: '6,7,11,16', marks: '6,7,11,16', rings: '0,4,18', okIdx: '0,1,4',
    wall: '1 块·已连成', filled: '25/25', unknown: '0', islands: '3/5',
    line: /^1 处和规则对不上：一个岛里两个数字（第3行2列）。/,
  },
  {
    name: '墙断开：把第4行3列擦回未定，12 号格那片墙成了孤岛',
    ink: '1222122122212122101222222',
    problems: '还有未定的格@17|墙断开了@1', conflicts: 1, badCells: '1,17', marks: '1', rings: '0,4,7', okIdx: '0,1,2,3,4',
    wall: '2', filled: '24/25', unknown: '1', islands: '3/5',
    line: /^1 处和规则对不上：墙断开了（第1行2列）。/,
  },
  {
    name: '二二全黑：把第3行4列涂黑，8/9/13/14 凑成四格黑',
    ink: '1222122122212222120222222',
    problems: '还有未定的格@18|2×2 全黑@8', conflicts: 1, badCells: '8,9,13,14,18', marks: '8,9,13,14', rings: '0,4,7,11', okIdx: '0,1,2,3',
    wall: '1', filled: '24/25', unknown: '1', islands: '4/5',
    line: /^1 处和规则对不上：2×2 全黑（第2行4列）。/,
  },
  {
    name: '岛没有数字：把第5行1列画白，那片白岛没有自己的数字',
    ink: '1222122122212122121212222',
    problems: '岛没有数字@20', conflicts: 1, badCells: '20', marks: '20', rings: '0,4,7,11,18', okIdx: '0,1,2,3,4',
    wall: '1 块·已连成', filled: '25/25', unknown: '0', islands: '5/5',
    line: /^1 处和规则对不上：岛没有数字（第5行1列）。/,
  },
  {
    name: '数字格被涂黑（篡改存档才走得到这条路）：三连撞',
    ink: '1222122122222122121222222',
    problems: '数字格被涂黑@11|岛没有数字@16|2×2 全黑@5', conflicts: 3, badCells: '5,6,10,11,16', marks: '5,6,10,11,16', rings: '0,4,7,18', okIdx: '0,1,2,4',
    wall: '1 块·已连成', filled: '25/25', unknown: '0', islands: '4/5',
    line: /^3 处和规则对不上：数字格被涂黑（第3行2列），另有 2 处。撤销一步再想，别往下猜。$/,
  },
];

((w) => {
  // ---- 页内探针：注入脚本跑在 js/main.js 之前，所以能抓到启动期的错与 404 ----
  const PROBE = { js: [], res: [] };
  w.__probe = PROBE;
  w.addEventListener('error', (ev) => {
    if (ev && ev.target && ev.target !== w && (ev.target.tagName || ev.target.src)) {
      PROBE.res.push(`${ev.target.tagName || 'node'}:${ev.target.src || ev.target.href || ''}`);
    } else {
      PROBE.js.push(String((ev && (ev.message || ev.error)) || 'error'));
    }
  }, true);
  w.addEventListener('unhandledrejection', (ev) => PROBE.js.push('rejection: ' + String(ev.reason)));
  const realError = w.console.error;
  w.console.error = function () {
    PROBE.js.push('[console.error] ' + [].map.call(arguments, String).join(' '));
    return realError.apply(this, arguments);
  };

  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const report = (extra) => {
    // rows 要拷一份：下面就把清了，交出活引用会回一份"0 failed 的空报告"。
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const A = () => w.nurikabe;
  const EN = () => w.nurikabe.engine;
  const $ = (sel) => document.querySelector(sel);
  const text = (sel) => (($(sel) || {}).textContent || '').trim();
  const shown = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    if (!e) return false;
    return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /**
   * 动态 import 必须按 document.baseURI 解析：Pages 把本仓挂在 /z-biz-game-nurikabe-cos/ 下，
   * 斜杠开头的说明符会解到域名根上 404（本地根形态反而一切正常 —— 最坏的那种"绿"）。
   */
  const mod = (rel) => import(new URL(rel, document.baseURI).href);

  const bySeed = (seed) => FIXTURE.filter((f) => f.seed === seed)[0];

  const booted = async () => {
    for (let i = 0; i < 120 && !w.nurikabe; i++) await wait(50);
    if (!w.nurikabe) throw new Error('window.nurikabe never appeared — 页面带着测试面启动失败了');
    return w.nurikabe;
  };

  // 每个场景都从空档起：续档卡、纪录表、累计数全是从 localStorage 来的，
  // 不能让上一个场景留了半张盘把这一步"混"绿。
  const wipe = async () => {
    await booted();
    A().resetSave();
    A().show('menu');
    await wait(30);
  };

  const open = async (seed, tier) => {
    const g = A().startPuzzle(seed, tier);
    await wait(40);
    if (!g) throw new Error(`出不了题：${seed} / ${tier} → ${JSON.stringify(A().error())}`);
    return g;
  };

  // ---- 墨水：手写盘面上屏（走的是续档那条 load() 路，能表达"篡改过的存档"）----
  const inkOf = (str) => str.split('').map(Number);
  const rle = (arr) => {
    const out = [];
    let run = arr[0];
    let n = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === run && n < 255) n++;
      else { out.push(run, n); run = arr[i]; n = 1; }
    }
    out.push(run, n);
    return out;
  };
  const paintInk = async (str, run = { moves: 9, hints: 2, elapsedMs: 12000 }) => {
    const g = A().startPuzzle('scn|novice|0', 'novice', { resume: { ink: rle(inkOf(str)), ...run } });
    await wait(30);
    if (!g) throw new Error('手写墨水没上屏');
    return g;
  };

  // ---- 手势：真的走 pointerdown/move/up，于是 hitCell、预览、提交都被走过一遍 ----
  function pointer(type, x, y) {
    A().view.canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true,
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
  }
  const at = (t) => {
    const r = A().cellRect(t);
    const box = A().view.canvas.getBoundingClientRect();
    return { x: box.left + r.x + r.size / 2, y: box.top + r.y + r.size / 2, size: r.size };
  };
  const click = async (t) => {
    const p = at(t);
    pointer('pointerdown', p.x, p.y);
    pointer('pointerup', p.x, p.y);
    await wait(20);
  };
  const dragTo = async (from, to) => {
    const a = at(from);
    const b = at(to);
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (a.size / 3)));
    pointer('pointerdown', a.x, a.y);
    for (let i = 1; i <= n; i++) pointer('pointermove', a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
    pointer('pointerup', b.x, b.y);
    await wait(20);
  };

  // ---- 像素：颜色读 CSS 变量（唯一来源是 js/theme.js 的 Palette），几何读画布自己那一份 ----
  const varOf = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = (h) => {
    const m = String(h).replace('#', '');
    const k = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
    return k.length >= 6 ? [parseInt(k.slice(0, 2), 16), parseInt(k.slice(2, 4), 16), parseInt(k.slice(4, 6), 16)] : null;
  };
  const rgb = (s) => {
    const m = String(s).match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const near = (p, c, tol) => !!p && !!c && p.every((v, i) => Math.abs(v - c[i]) <= tol);
  const pixel = (x, y) => {
    const v = A().view;
    const d = v.geo.dpr;
    const p = v.ctx.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data;
    return [p[0], p[1], p[2]];
  };
  const centrePixel = (t) => {
    const r = A().cellRect(t);
    return pixel(r.x + r.size / 2, r.y + r.size / 2);
  };
  /**
   * 沿"内缩 rect 的描边路径"采一圈点：每边 n 个，每个点再沿线宽方向偏 ±0.35lw 各采一次。
   * 画布上的两条 per-cell 标记都是这么画的 —— 提示圈（roundRect(x+2,y+2,cell-4,cell-4)，
   * 线宽 max(2,cell*0.09)，js/render/board.js:208-214）与撞破规则的红框（同一批几何）。
   * roundRect 的四个圆角（--radius-cell = 6px）本来就没有墨，所以正向阈值留了 4 个点的余量。
   */
  function rectMark(t, want, { inset, lw, tol = 45, n = 8 }) {
    const r = A().cellRect(t);
    const cell = r.size;
    let hit = 0;
    for (let k = 0; k < n; k++) {
      const f = inset + ((cell - inset * 2) * k) / (n - 1);
      const pts = [
        [r.x + f, r.y + inset, 'h'],
        [r.x + f, r.y + cell - inset, 'h'],
        [r.x + inset, r.y + f, 'v'],
        [r.x + cell - inset, r.y + f, 'v'],
      ];
      for (const [x, y, dir] of pts) {
        let ok = false;
        for (const d of [-lw * 0.35, 0, lw * 0.35]) {
          if (near(pixel(x + (dir === 'v' ? d : 0), y + (dir === 'h' ? d : 0)), want, tol)) { ok = true; break; }
        }
        if (ok) hit++;
      }
    }
    return { hit, of: 4 * n };
  }
  const markOf = (t, color, kind) => {
    const cell = A().cellRect(t).size;
    const want = hex(color);
    if (kind === 'pulse') return rectMark(t, want, { inset: 2, lw: Math.max(2, cell * 0.09) });
    const ew = Math.max(2, cell * 0.08);
    return rectMark(t, want, { inset: ew / 2, lw: ew });
  };
  /** 数字外套的绿环：arc(中心, max(6,cell*0.34))，线宽 max(1.5,cell*0.045)（board.js:196-201）。 */
  function ringOf(t, color) {
    const r = A().cellRect(t);
    const cell = r.size;
    const rad = Math.max(6, cell * 0.34);
    const lw = Math.max(1.5, cell * 0.045);
    const want = hex(color);
    let hit = 0;
    const n = 24;
    for (let k = 0; k < n; k++) {
      const a = (Math.PI * 2 * k) / n;
      let ok = false;
      for (const d of [-lw * 0.35, 0, lw * 0.35]) {
        const rr = rad + d;
        if (near(pixel(r.x + cell / 2 + Math.cos(a) * rr, r.y + cell / 2 + Math.sin(a) * rr), want, 45)) { ok = true; break; }
      }
      if (ok) hit++;
    }
    return { hit, of: n };
  }
  /** 整张盘扫一遍：哪些格被画布标了"撞破规则"（红框）、哪些数字被套了绿环。 */
  function scanned() {
    const n = A().board().length;
    const badColor = varOf('--error');
    const hintColor = varOf('--hint');
    const okColor = varOf('--success');
    const red = [];
    const green = [];
    const rings = [];
    for (let t = 0; t < n; t++) {
      if (markOf(t, badColor, 'bad').hit >= 30) red.push(t);
      if (markOf(t, hintColor, 'pulse').hit >= 26) rings.push(t);
    }
    const numberCells = A().clues().map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    for (const num of numberCells) {
      if (ringOf(num, okColor).hit >= 16) green.push(num);
    }
    return { red, green, rings, colors: { bad: badColor, hint: hintColor, ok: okColor } };
  }

  const fmtMs = (ms) => {
    const s = Math.floor((ms || 0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const boardString = () => A().board().join('');
  const clueString = () => A().clues().join(',');
  const problemsString = () => A().problems().map((p) => `${p.why}@${p.cell}`).join('|');
  const badCellsString = () => [...(A().diag().badCells || [])].sort((a, b) => a - b).join(',');

  // ---------- first：页面起得来、菜单那句「实测 X–Y 分」与量出来的分位逐档相同 ----------
  const first = async () => {
    await booted();
    await wipe();
    eq('版本读数', A().version, '1.0.0');
    eq('constants 里的版本与页面同一个', A().constants.VERSION, '1.0.0');
    ck('window.App 与 window.nurikabe 是同一个对象', w.App === A(), `${!!w.App}/${!!A()}`);
    eq('存档键名', A().saveKey(), 'nurikabe.save.v1');
    eq('启动没有未捕获的异常', PROBE.js.join(' | '), '');
    eq('启动没有加载失败的资源（含 404）', PROBE.res.join(' | '), '');
    eq('动态 import 落在本仓的目录里', new URL('js/main.js', document.baseURI).href.endsWith('/z-biz-game-nurikabe-cos/js/main.js') || new URL('js/main.js', document.baseURI).href.endsWith('/js/main.js'), true);

    const vis = A().visible();
    eq('开局只亮选档屏', `${vis.menu},${vis.game},${vis.won},${vis.resume}`, 'true,false,false,false');
    eq('选档屏真的有命中盒、棋局屏没有', `${shown('#view-menu')},${shown('#view-game')}`, 'true,false');
    ck('隐藏中的区块真的不占布局（display 规则）', getComputedStyle($('#view-game')).display === 'none' && $('#view-game').getClientRects().length === 0, getComputedStyle($('#view-game')).display);
    // 相对说明符在当前 URL 形态下真解得开：这一条在 Pages 前缀下才会红
    // （斜杠开头的写法会解到域名根，本地根形态反而全绿 —— 坑 6）。
    let imported = null;
    try {
      const R0 = await mod('js/engine/rng.js');
      imported = R0.hashSeed('nurikabe');
    } catch (e) {
      imported = `抛了：${e && e.message}`;
    }
    eq('动态 import 落在本页同目录（FNV-1a 读数）', imported, 589334624);

    // 五档卡：页脚那句话的债就在这里还。band 的抄件在 BANDS，与引擎常量逐档对账。
    const cards = [...document.querySelectorAll('#tier-list .tier')];
    eq('菜单上有五档卡 + 一张日课卡', cards.length, 6);
    eq('卡的 key 顺序就是 TIERS 的顺序', cards.map((c) => c.dataset.tier).join(','), 'novice,skilled,regular,expert,master,daily');
    eq('五档卡的名字就是手抄的那五个中文档位名',
      cards.slice(0, 5).map((c) => `${c.dataset.tier}:${c.querySelector('.tier-name').textContent}`).join(' '),
      Object.keys(TIER_NAMES).map((k) => `${k}:${TIER_NAMES[k]}`).join(' '));
    const seenBands = cards.slice(0, 5).map((c) => `${c.dataset.tier}:${c.querySelector('.tier-size').textContent}`).join(' ');
    eq('五档卡的「实测 X–Y 分」逐档等于量出来的分位', seenBands,
      Object.keys(BANDS).map((k) => `${k}:${BANDS[k]}`).join(' '));
    eq('抄件与 constants.TIERS 逐档相同',
      A().constants.TIERS.map((t) => BANDS[t.key] === `实测 ${t.band[0]}–${t.band[1]} 分`).join(','),
      'true,true,true,true,true');
    eq('档位尺寸写在卡上（与 TIERS 的轴同一条链）',
      cards.slice(0, 5).map((c) => c.querySelector('.tier-note').textContent).join(' | '),
      A().constants.TIERS.map((t) => `${t.w}×${t.h} · 岛最大 ${t.maxIsland} 格 · 至少 ${t.minClues} 个数字`).join(' | '));
    eq('日课卡写着种子由日期决定', /种子由日期决定/.test(cards[5].textContent), true);
    eq('日课卡的尺寸那一栏说的是同 seed 同盘', cards[5].querySelector('.tier-size').textContent, '同一 seed 永远同一张盘');
    eq('初学卡那行字逐字如此', cards[0].querySelector('.tier-note').textContent, '5×5 · 岛最大 3 格 · 至少 5 个数字');

    // 七条推理名册：首页那一列必须和引擎的规则表一字不差。
    const lis = [...document.querySelectorAll('#rule-list li')];
    eq('推理名册七条', lis.length, 7);
    eq('名册顺序就是 RULE_ORDER', lis.map((x) => x.dataset.rule).join(','), EN().RULE_ORDER.join(','));
    eq('名册的名字/层数/分值与引擎一致',
      lis.map((x) => `${x.dataset.rule} ${x.textContent.trim().replace(/\s+/g, ' ')}`).join('|'), RULE_ROWS);
    eq('规则原文三条都在页面上', [...document.querySelectorAll('.rules li b')].map((b) => b.textContent).join(','), '数字即岛,墙是一整块,二二不全黑');
    // 页脚那句话：它承诺的事必须真存在（这条正则点名的就是本次要写的闸）。
    eq('页脚那句话逐字如此', text('.foot').replace(/\s+/g, ' '),
      '每局唯一解 · 每局可用逻辑推到底 · 提示只给推得出的一步 — 由 tools/verify.sh 在真实浏览器里逐条断言。 清空存档');
    eq('画布带着 data-mode', $('#board').dataset.mode, 'wall');

    // 触摸目标与几何：44 的地板没有豁免（css/game.css:58-99 连 button.link 都撑满）。
    eq('触摸地板写进 CSS 变量', cssVar('--touch-min'), '44px');
    const g = await open('scn|novice|0', 'novice');
    const geo = A().geometry();
    const box = $('#board').getBoundingClientRect();
    eq('开局在棋局屏', `${A().visible().game},${A().visible().menu}`, 'true,false');
    ck('画布几何量出来了', !!geo, JSON.stringify(geo));
    eq('5×5 的初学盘在宽视口下顶到 Cell.max', geo.cell, 60);
    eq('边长夹在主题的 26–60 之间（Cell.min/max）', `${geo.cell >= 26},${geo.cell <= 60}`, 'true,true');
    eq('geometry 报的地板就是 Cell.min（44 那条住在 CSS 变量里）', geo.touchMin, 26);
    eq('画布 CSS 宽就是几何宽', Math.round(box.width), geo.w);
    eq('画布 CSS 宽就是边长×5+两圈内边（pad=14）', geo.w, geo.cell * 5 + 28);
    eq('后备缓冲按 dpr 放大', $('#board').width, Math.round(geo.w * geo.dpr));
    ck('画布整个落在视口里', box.left >= 0 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
      JSON.stringify({ l: Math.round(box.left), r: Math.round(box.right), b: Math.round(box.bottom), vw: window.innerWidth, vh: window.innerHeight }));
    eq('容器宽就是画布宽（#board-wrap 是 shrink-to-fit）', Math.round($('#board-wrap').getBoundingClientRect().width), Math.round(box.width));
    ck('画布不溢出 .stage 的边框盒', box.right <= $('.stage').getBoundingClientRect().right + 1, `${Math.round(box.right)} vs ${Math.round($('.stage').getBoundingClientRect().right)}`);
    const scan0 = scanned();
    eq('开局整张盘没有一格被标成"撞破规则"（未定不是冲突）', scan0.red.join(','), '');
    eq('开局也没有一格被套绿环（岛还没凑满）', scan0.green.join(','), '');
    eq('开局没有提示圈', scan0.rings.join(','), '');
    eq('画布与统计行同一口径：一处冲突都没有', `${text('#stat-conflicts')},${A().state().conflicts}`, '0,0');
    let missed = 0;
    for (let t = 0; t < g.w * g.h; t++) {
      const p = at(t);
      if (A().hitAt(p.x, p.y) !== t) missed++;
    }
    eq('每格点中心都命中自己', missed, 0);
    eq('盘外一像素不落子', A().hitAt(box.left - 1, box.top + 4), -1);

    const live = [...document.querySelectorAll('#app button')].filter((x) => x.getClientRects().length > 0);
    eq('棋局屏上的可点名册', live.map((x) => x.id).join(','), 'btn-sound,btn-motion,btn-fullscreen,btn-mode-wall,btn-mode-land,btn-hint,btn-undo,btn-new,btn-clear,btn-menu,btn-reset');
    const small = live.filter((x) => {
      const r = x.getBoundingClientRect();
      return Math.round(r.width) < 44 || Math.round(r.height) < 44;
    }).map((x) => `${x.id} ${Math.round(x.getBoundingClientRect().width)}×${Math.round(x.getBoundingClientRect().height)}`);
    eq('棋局屏上没有到不了 44 的目标', small.join(' | '), '');
    A().show('menu');
    await wait(40);
    eq('选档屏上的可点名册', [...document.querySelectorAll('#app button')].filter((x) => x.getClientRects().length > 0).map((x) => x.id || `档位卡:${x.dataset.tier}`).join(','),
      'btn-sound,btn-motion,btn-fullscreen,档位卡:novice,档位卡:skilled,档位卡:regular,档位卡:expert,档位卡:master,档位卡:daily,btn-reset');
    eq('选档屏上没有到不了 44 的目标', [...document.querySelectorAll('#app button')].filter((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && (Math.round(r.width) < 44 || Math.round(r.height) < 44);
    }).map((x) => x.id).join(' | '), '');
    // 颜色的唯一来源：样式表与画布读同一批值（js/theme.js 的 Palette 经 applyThemeVars()）。
    // 抄件（js/theme.js:26-38）：wall #080C18 / land #EDF2FA / unknownCell #141C31 /
    // error #FF5C7A / success #3DDC91 / pencilStrong #8FA6CC。
    const swRGB = (cls) => rgb(getComputedStyle($(cls)).backgroundColor).join(',');
    eq('图例的墙色就是画布用的墙色', swRGB('.sw-wall'), '8,12,24');
    eq('图例的岛色就是画布用的岛色', swRGB('.sw-land'), '237,242,250');
    eq('图例的未定色就是画布用的未底色', swRGB('.sw-unknown'), '20,28,49');
    eq('撞破规则的图例色是 error（画布的红框读的也是它）', swRGB('.sw-bad'), '255,92,122');
    eq('凑满的岛的图例色是 success（画布的绿环读的也是它）', swRGB('.sw-done'), '61,220,145');
    eq('画布的红框与图例的撞破色同值', hex(varOf('--error')).join(','), '255,92,122');
    eq('画布的提示色与 CSS 变量同值', hex(varOf('--hint')).join(','), '123,184,255');
    ck('图例"还没连上岛的白格"点的是 pencil-strong 的内描边',
      /rgb\(143, 166, 204\)/.test(getComputedStyle($('.sw-free')).boxShadow) && /inset/.test(getComputedStyle($('.sw-free')).boxShadow),
      getComputedStyle($('.sw-free')).boxShadow);
    ck('统计行八项', document.querySelectorAll('.stats .stat').length === 8, String(document.querySelectorAll('.stats .stat').length));
    ck('图例六项', document.querySelectorAll('.legend span').length === 6, String(document.querySelectorAll('.legend span').length));
    eq('键盘说明与页面同一套（就是那六个键位）', text('.keyhint'),
      '拖动 连续落子 · 从同色上起笔 就是擦 · 1 墙 · 2 岛 · M 换 · H 提示 · Z 撤销');
    eq('场景收工前页面仍然活着', A().state().originSeed, 'scn|novice|0');
    return report({ version: A().version, cell: geo.cell, dpr: geo.dpr, cards: cards.length });
  };

  // ---------- zero：每档现场出一局，纯逻辑推到底，第二套穷举在同一张盘上判唯一 ----------
  const zero = async () => {
    await wipe();
    const C = await mod('js/engine/count.js');
    const N = await mod('js/engine/nurikabe.js');
    for (const f of FIXTURE.filter((x) => x.kind === 'tier')) {
      const g = await open(f.seed, f.tier);
      const st = A().state();
      eq(`${f.tier}：题目就是夹具那张盘`, clueString(), f.clue);
      eq(`${f.tier}：夹具尺寸与 TIERS 一致`, `${g.w}×${g.h}`, `${f.w}×${f.h}`);
      eq(`${f.tier}：线索数`, st.clues, f.clues);
      eq(`${f.tier}：难度实测分（统计行与 state 同口径）`, `${st.score}|${text('#stat-score')}`, `${f.score}|${f.score.toFixed(1)}`);
      eq(`${f.tier}：推导步数`, st.script, f.steps);
      eq(`${f.tier}：回扫轮数`, g.puzzle.sweeps, f.sweeps);
      eq(`${f.tier}：两条证明里的穷举器跑完了（level 与节点数）`, `${st.crossLevel}|${g.puzzle.cross.nodes}`, `count|${f.nodes}`);
      eq(`${f.tier}：证明条数写在界面上`, text('#stat-proof'), '证明 两条：铅笔推完 + 穷举逐格对账');
      eq(`${f.tier}：开局一格未定都没有`, `${st.filled},${st.unknown},${st.conflicts}`, `0,${f.w * f.h},0`);
      const scan0 = scanned();
      eq(`${f.tier}：开局画布上没有被标红的格`, scan0.red.join(','), '');
      const res = A().solveWithLogic(4000);
      await wait(30);
      eq(`${f.tier}：纯逻辑推到胜利`, `${res.status},${A().state().status}`, 'won,won');
      eq(`${f.tier}：每一步都是线索逼出来的`, A().state().hints, f.steps);
      eq(`${f.tier}：终局一条违规都没有`, problemsString(), '');
      eq(`${f.tier}：终局棋盘与夹具的解逐格相同`, boardString(), f.sol);
      eq(`${f.tier}：冲突数读数是 0`, `${text('#stat-conflicts')},${text('#stat-unknown')},${text('#stat-islands')}`, `0,0,${f.clues}/${f.clues}`);
      eq(`${f.tier}：状态行说的是这一局成立了`, /^岛都凑满，墙是一整块，没有一个 2×2 全黑/.test(text('#state-line')), true);
      ck(`${f.tier}：胜利横幅可见且真占位`, shown('#win-veil') && $('#win-veil').getClientRects().length > 0,
        `${getComputedStyle($('#win-veil')).display}/${$('#win-veil').getClientRects().length}`);
      const st2 = A().state();
      eq(`${f.tier}：横幅里的数与重算一致`, text('#win-meta'),
        `${st2.name} ${f.w}×${f.h} · 用时 ${fmtMs(st2.elapsedMs)} · ${st2.moves} 步 · 提示 ${st2.hints} 次 · 实测 ${st2.score} 分 · ${st2.script} 步线索`);
      // 画布复述的必须是同一份结论：一格红框都不许有，每个数字都得套上绿环。
      const scan = scanned();
      eq(`${f.tier}：终局画布上没有被标红的格`, scan.red.join(','), '');
      eq(`${f.tier}：终局每个数字都套上绿环`, scan.green.join(','), A().clues().map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0).join(','));
      // 第二套实现（js/engine/count.js，不 import 铅笔那七条）在同一张盘上判唯一
      const cs = C.countSolutions({ w: f.w, h: f.h, clue: Uint8Array.from(A().clues()) }, { cap: 2, budget: 1500000 });
      eq(`${f.tier}：穷举器判唯一`, `${cs.status},${cs.solutions}`, 'UNIQUE,1');
      eq(`${f.tier}：穷举器那个解与铅笔解逐格相同`, C.asNurikabe(cs.first).join(''), f.sol);
      // 第三条独立验收：verify()/complete() 只读盘面与线索，不读 derived、也不读提示脚本
      const cells = Uint8Array.from(A().board());
      eq(`${f.tier}：独立验收 verify() 一条都不报`, N.verify(g.board, cells).length, 0);
      eq(`${f.tier}：独立验收 complete() 判成立`, N.complete(g.board, cells), true);
      A().show('menu');
      await wait(20);
    }
    return report({ tiers: 5, steps: FIXTURE.filter((f) => f.kind === 'tier').reduce((n, f) => n + f.steps, 0) });
  };

  // ---------- hint：每一步都必须点名一条规则，且第三条不许回头念前两条 ----------
  const hint = async () => {
    await wipe();
    const g = await open('scn|novice|0', 'novice');
    const U = EN().UNKNOWN;
    const rules = EN().Rules;
    eq('开局没提示', `${text('#stat-hints')},${text('#hint-count')},${A().state().hints}`, '0,0,0');
    eq('开局提示框还是那句说明书', text('#hint-rule'), '提示理由');
    const seen = [];
    const cells = [];
    for (let k = 1; k <= 25; k++) {
      const h = A().hint();
      await wait(8);
      if (!h || h.stalled || h.conflict) {
        ck(`第 ${k} 次提示给出了事实而不是空回`, false, JSON.stringify(h));
        break;
      }
      const [wantCell, wantValue, wantKey] = SCRIPT_NOVICE.split(' ')[k - 1].split(':');
      seen.push(`${h.cell}:${h.value}:${h.ruleKey}`);
      cells.push(h.cell);
      eq(`第 ${k} 次提示就是脚本的第 ${k} 条`, `${h.cell}:${h.value}:${h.ruleKey}`, `${wantCell}:${wantValue}:${wantKey}`);
      eq(`第 ${k} 次提示落了子也计了费`, `${h.charged},${A().state().hints},${A().state().cursor}`, `true,${k},${k}`);
      eq(`第 ${k} 次提示的读数三处一致`, `${text('#stat-hints')},${text('#hint-count')},${A().state().hints}`, `${k},${k},${k}`);
      eq(`第 ${k} 次提示点名的格真的变成了那一色`, `${A().valueOf(h.cell)},${A().board()[h.cell]}`, `${h.value},${h.value}`);
      eq(`第 ${k} 次提示的标题就是那条规则的名字与层数`, text('#hint-rule'), `${rules[h.ruleKey].name}（第 ${rules[h.ruleKey].tier} 层推理）`);
      eq(`第 ${k} 次提示的理由就是引擎那句话`, text('#hint-line'), h.why);
      ck(`第 ${k} 次提示的理由点了格号`, /第\d+行\d+列/.test(h.why), h.why);
      if (h.ruleKey !== 'full' && h.ruleKey !== 'fill') {
        ck(`第 ${k} 次提示（${h.ruleKey}）点的就是它画下的那一格`, h.why.includes(A().cellName(h.cell)), `${h.why} vs ${A().cellName(h.cell)}`);
      } else {
        ck(`第 ${k} 次提示（${h.ruleKey}）点的是那座凑满的岛的号`, h.why.includes('岛已经凑满') || h.why.includes('恰好只剩'), h.why);
      }
      if (k <= 3) {
        eq(`第三条不许回头念第 ${k} 格之前的账`, cells.slice(0, k - 1).indexOf(h.cell), -1);
      }
    }
    eq('25 步里没有回头重念的（格号）', cells.filter((t, i) => cells.indexOf(t) !== i).length, 0);
    eq('25 步里没有回头重念的（规则+格）', seen.filter((s, i) => seen.indexOf(s) !== i).length, 0);
    eq('七条推理这一盘用上了五条', [...new Set(seen.map((s) => s.split(':')[2]))].sort().join(','), 'bridge,full,number,reach,three');
    eq('脚本长度就是提示次数', A().state().script, 25);
    eq('提示推到底就是胜利', A().state().status, 'won');
    eq('胜利之后再要提示不给', A().hint(), null);

    // 提示计费与"撤销不退提示"：这是纪录那条数字的地基
    A().clearInk();
    await wait(30);
    eq('清空我的落子把墨抹平但不洗白求助', `${A().state().hints},${A().board().every((v) => v === U)}`, '25,true');
    eq('清空后统计行仍然如实报 25 次', `${text('#stat-hints')},${text('#stat-filled')}`, '25,0/25');

    // 玩家把盘推死了：提示拒绝落子，也拒绝计费
    await open('scn|novice|0', 'novice');
    A().stroke([13], EN().BLACK);
    await wait(20);
    const before = A().state();
    const refused = A().hint();
    await wait(20);
    ck('墨水与线索矛盾时提示不落子', refused && !!refused.conflict, JSON.stringify(refused));
    eq('拒绝落子的提示不计费', A().state().hints, before.hints);
    eq('拒绝落子写在标题上', text('#hint-rule'), '提示拒绝落子');
    ck('拒绝落子说清了是哪一格', /第\d+行\d+列/.test(text('#hint-line')), text('#hint-line'));
    eq('被拒绝的格没有被改写', A().valueOf(13), EN().BLACK);

    // 高亮：提示点名的那一格必须在画布上被圈出来（琥珀蓝的那圈描边是全屏唯一的"看这里"）。
    await wipe();
    await open('scn|novice|0', 'novice');
    const hintColor = varOf('--hint');
    const h2 = A().hint();
    const pulse2 = markOf(h2.cell, hintColor, 'pulse');
    ck('提示在画布上圈出了它点名的那一格', pulse2.hit >= 26, `采样命中 ${pulse2.hit}/${pulse2.of} @${A().cellName(h2.cell)} 色 ${hintColor}`);
    eq('整张盘只有那一格被圈', scanned().rings.join(','), String(h2.cell));
    const control = markOf(Number(SCRIPT_NOVICE.split(' ')[5].split(':')[0]), hintColor, 'pulse');
    eq('对照格没有被圈（高亮不是满屏贴）', control.hit, 0);
    const h3 = A().hint();
    const scan3 = scanned();
    eq('下一次提示把圈移到新格（旧格的圈收了）', scan3.rings.join(','), String(h3.cell));
    ck('新格确实被圈住了', markOf(h3.cell, hintColor, 'pulse').hit >= 26, JSON.stringify(markOf(h3.cell, hintColor, 'pulse')));

    // 减少动效时那一格仍然要被圈出来（js/main.js:199-201 的那句注释写死了这条承诺）
    A().setMotionReduced(true);
    await wait(20);
    const h4 = A().hint();
    const still = markOf(h4.cell, hintColor, 'pulse');
    ck('减少动效下提示照样点名那一格', scanned().rings.join(',') === String(h4.cell) && still.hit >= 26,
      `圈中的格 ${scanned().rings.join(',')} 采样 ${still.hit}/${still.of}`);
    await wait(420);
    const later = scanned();
    eq('减少动效时圈不会自己淡掉（它只在下一步落子时被换走）', later.rings.join(','), String(h4.cell));
    A().setMotionReduced(false);
    A().show('menu');
    await wait(40);
    eq('设置读回来了：动效开关写进了存档', A().save().settings.reduceMotion, false);

    // 熟手档：脚本前 8 条同一条路（换一盘不是换一套期望）
    await open('scn|skilled|0', 'skilled');
    const sk = [];
    for (let k = 0; k < 8; k++) {
      const x = A().hint();
      sk.push(`${x.cell}:${x.value}:${x.ruleKey}`);
    }
    eq('熟手档前八步与夹具脚本一致', sk.join(' '), SCRIPT_SKILLED_HEAD);
    eq('熟手档的提示计数与统计行同数', `${text('#stat-hints')},${text('#hint-count')},8`, '8,8,8');
    eq('熟手档八步之后八格已定', A().state().filled, 8);
    return report({ steps: 25, rules: [...new Set(seen.map((s) => s.split(':')[2]))].length });
  };

  // ---------- conflict：手写违规盘，引擎结论 / 画布标记 / 统计行同一口径 ----------
  const conflict = async () => {
    await wipe();
    for (const c of CONFLICTS) {
      await paintInk(c.ink);
      await wait(30);
      const d = A().diag();
      const st = A().state();
      eq(`problems() 逐条：${c.name}`, problemsString(), c.problems);
      eq(`diag.conflicts：${c.name}`, d.conflicts, c.conflicts);
      eq(`state.conflicts 与 diag 同数：${c.name}`, st.conflicts, c.conflicts);
      eq(`统计行「冲突」与 problems 同口径：${c.name}`, text('#stat-conflicts'), String(c.conflicts));
      eq(`撞破的格名册：${c.name}`, badCellsString(), c.badCells);
      eq(`已定/未定读数：${c.name}`, `${text('#stat-filled')},${text('#stat-unknown')}`, `${c.filled},${c.unknown}`);
      eq(`凑满的岛读数：${c.name}`, text('#stat-islands'), c.islands);
      eq(`墙块数读数：${c.name}`, text('#stat-wall'), c.wall);
      ck(`状态行说的是这一类违规：${c.name}`, c.line.test(text('#state-line')), text('#state-line'));
      eq(`墨水与盘面同一条链：${c.name}`, boardString(), c.ink);
      // 画布复述的必须是同一批结论：被标红的格、套绿环的数字，一格不多一格不少。
      const scan = scanned();
      eq(`画布标红的格就是 violations 里那些：${c.name}`, scan.red.join(','), c.marks);
      eq(`画布套绿环的数字格：${c.name}`, scan.green.join(','), c.rings);
      // 两条统计口径必须**不同**：okIslands 只问"格数对不对"，绿环还要问"封死没有"。
      eq(`引擎 okIslands（只看格数）的名册：${c.name}`, [...d.okIslands].sort((a, b) => a - b).join(','), c.okIdx);
      // 三条读数同一口径的交叉点：被标红的格与统计行的冲突数同时有无。
      eq(`冲突数与红框名册同时非空/同时为空：${c.name}`, `${c.conflicts > 0},${scan.red.length > 0}`, `${c.conflicts > 0},${c.conflicts > 0}`);
    }
    // 数字格不许涂黑：玩家这条路被引擎堵死（上一例只有篡改存档才走得到）
    await open('scn|novice|0', 'novice');
    const fresh = '0000000000000000000000000';
    eq('开局整张盘未定（手写墨水收了回去）', boardString(), fresh);
    eq('起笔在数字格上的那一笔被拒绝', A().stroke([11], EN().BLACK), null);
    eq('被拒绝的落子没有改盘面', boardString(), fresh);
    eq('被拒绝的落子也不计步数', A().state().moves, 0);
    await dragTo(10, 11);
    eq('一笔里的数字格被跳过、旁边的格照常画', boardString(), '0000000000200000000000000');
    eq('同一笔只记一条撤销', A().state().moves, 1);
    await click(11);
    eq('落墙模式下单击数字格什么也不改', `${A().valueOf(11)},${A().state().moves}`, '0,1');
    A().setMode(EN().WHITE);
    await click(11);
    eq('换到落岛模式才画得上去', `${A().valueOf(11)},${A().board()[11]},${A().state().moves}`, '1,1,2');
    await click(11);
    eq('同色起笔就是擦：数字格擦回未定', `${A().valueOf(11)},${A().state().moves}`, '0,3');
    A().setMode(EN().BLACK);
    await dragTo(20, 24);
    eq('一整笔只记一条撤销', A().state().moves, 4);
    eq('一整笔画了五个格', A().board().slice(20, 25).join(''), '22222');
    A().undo();
    await wait(20);
    eq('撤销一次拿走整笔', A().board().slice(20, 25).join(''), '00000');
    eq('撤销把步数也退回去', A().state().moves, 3);
    return report({ cases: CONFLICTS.length });
  };

  // ---------- save：真 localStorage，坏数据整份丢弃 ----------
  const save = async () => {
    await wipe();
    const KEY = A().saveKey();
    // 手写这一局的墨：两笔（1、2 号格涂黑；13、16 画白）+ 一次求助（线索第 1 条把 0 号格画白）。
    // 收工时磁盘上留的就是这一局 —— 下一个场景（resume）在**新的一次导航**里把它读回来。
    const INKED = '1220000000000100100000000';
    await open('scn|novice|0', 'novice');
    A().stroke([1, 2], EN().BLACK);
    A().stroke([13, 16], EN().WHITE);
    A().hint();
    await wait(40);
    eq('存档只有一个键', Object.keys(localStorage).filter((k) => k.startsWith('nurikabe')).join(','), KEY);
    const raw = JSON.parse(localStorage.getItem(KEY));
    eq('存档只有这四块', Object.keys(raw).sort().join(','), 'best,resume,settings,totals');
    ck('续档躺在磁盘上', !!raw.resume, Object.keys(raw).join(','));
    eq('存的是原点 seed（不是派生后的内部 seed）', raw.resume.seed, 'scn|novice|0');
    eq('存的是档位 key', raw.resume.tier, 'novice');
    eq('存的是格数', raw.resume.cells, 25);
    eq('存的是步数', raw.resume.moves, 2);
    eq('存的是提示次数（不然洗白求助）', raw.resume.hints, 1);
    ck('存的是用时', Number.isInteger(raw.resume.elapsedMs) && raw.resume.elapsedMs >= 0, String(raw.resume.elapsedMs));
    eq('游程编码比一格一值省', raw.resume.ink.length < 25, true);
    eq('游程编码是整数对', raw.resume.ink.length % 2, 0);
    eq('游程编码存的正是那三笔', raw.resume.ink.join(','), '1,1,2,2,0,10,1,1,0,2,1,1,0,8');
    eq('解码回来的墨与盘面逐格相同', EN().rleDecode(raw.resume.ink, 25).join(''), boardString());
    eq('盘面就是开局（全未定）加上手写的三笔', boardString(), INKED);
    eq('默认设置：音效开', raw.settings.sound, true);
    eq('默认设置：动效不减少', raw.settings.reduceMotion, false);
    eq('累计数开局是零', `${raw.totals.solved},${raw.totals.hints},${raw.totals.ms}`, '0,0,0');
    const bytes = JSON.stringify(raw.resume).length;
    ck('25 格的续档不过两百字节', bytes < 200, `${bytes} bytes`);
    eq('rawSave 读的就是磁盘那串原文', A().rawSave() === localStorage.getItem(KEY), true);
    eq('storedResume 与磁盘一致', A().storedResume().seed, 'scn|novice|0');
    eq('hasResume 说有人等着继续', A().hasResume(), true);

    // 坏存档：任何一处不合法就整份丢弃，绝不半信半疑地摆上屏
    const keep = localStorage.getItem(KEY);
    const hostile = [
      ['截断的 JSON', '{'],
      ['顶层是数组', '[]'],
      ['顶层是 null', 'null'],
      ['顶层是字符串', '"x"'],
      ['顶层是 0', '0'],
      ['续档不是对象', JSON.stringify({ resume: 7 })],
      ['越界格号（cells 999）', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 999, ink: [1, 25], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['越界格号（cells 0）', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 0, ink: [1, 25], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['错长度（25 格盘塞 24 格墨）', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 25, ink: [1, 24], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['RLE 炸串（奇数长）', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 25, ink: [1, 2, 1], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['RLE 炸串（游程 0）', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 25, ink: [1, 0, 2, 25], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['墨不是数组', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 25, ink: '1,25', moves: 0, hints: 0, elapsedMs: 0 } })],
      ['负数步数', JSON.stringify({ resume: { seed: 'a', tier: 'novice', cells: 25, ink: [1, 25], moves: -3, hints: 0, elapsedMs: 0 } })],
      ['档位不是字符串', JSON.stringify({ resume: { seed: 'a', tier: 7, cells: 25, ink: [1, 25], moves: 0, hints: 0, elapsedMs: 0 } })],
      ['纪录里 ms 是字符串', JSON.stringify({ best: { novice: { ms: 'soon', hints: 1, moves: 2 } }, settings: 7, totals: 7 })],
      ['totals 是负数', JSON.stringify({ totals: { solved: -2, hints: -1, ms: -1 } })],
    ];
    let swallowed = 0;
    const notes = [];
    for (let k = 0; k < hostile.length; k++) {
      localStorage.setItem(KEY, hostile[k][1]);
      const S = (await mod(`js/store.js?hostile=${k}&n=${FIXTURE.length}`)).Store;
      const ok = S.resume() === null
        && Object.keys(S.data.best).length === 0
        && S.setting('sound') === true
        && S.setting('reduceMotion') === false
        && S.data.totals.solved === 0 && S.data.totals.hints === 0 && S.data.totals.ms === 0;
      if (ok) swallowed++;
      else notes.push(`${hostile[k][0]} → resume=${JSON.stringify(S.resume())} best=${Object.keys(S.data.best).join(',')} totals=${JSON.stringify(S.data.totals)}`);
    }
    eq(`${hostile.length} 种坏存档一律整份丢弃`, swallowed, hostile.length);
    eq('丢弃清单为空', notes.join(' | '), '');
    // 页面本体也不能被坏存档带跑：读回来是默认值，续档卡不出现
    localStorage.setItem(KEY, hostile[6][1]);
    const S2 = (await mod('js/store.js?reload=1')).Store;
    eq('内存里的 Store 仍然认这一局（脏盘不覆盖活局）', A().storedResume().seed, 'scn|novice|0');
    eq('而重读的 Store 什么都不认', S2.resume(), null);
    localStorage.setItem(KEY, keep);
    eq('试完坏存档还能取回原局', JSON.parse(localStorage.getItem(KEY)).resume.seed, 'scn|novice|0');
    eq('游程解码：长度对不上就是 null', EN().rleDecode([1, 24], 25), null);
    // 长的那一侧同样要 return null：早先只防了"短"，长的墨被横着截齐 —— 36 格的档摆到 5×5 上
    // 得到的是一张每格错位半列的盘，比空盘更坏，因为它看着像进度。
    eq('游程解码：墨比盘面长也是 null（不许截齐）', EN().rleDecode([1, 25, 2, 11], 25), null);
    eq('游程解码：游程 0 就是 null', EN().rleDecode([1, 0, 2, 25], 25), null);
    eq('游程解码：字节都解得开（3 也解得开，脏的是语义不是形状）', EN().rleDecode([3, 25], 25).join(','), new Array(25).fill(3).join(','));
    eq('游程编码：255 一段封顶（300 格拆成两段）', (await mod('js/store.js?rle=1')).rleEncode(new Uint8Array(300).fill(1)).join(','), '1,255,1,45');
    {
      const RC = await mod('js/store.js?rle=2');
      eq('游程编解码来回一趟不改盘面', RC.rleDecode(RC.rleEncode(Uint8Array.from(INKED.split('').map(Number))), 25).join(''), INKED);
    }

    // localStorage 整个抛异常（Safari 隐私模式）：页面只是忘事，不是崩
    const realLS = w.localStorage;
    let survived = false;
    try {
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        get() { throw new Error('Safari 隐私模式'); },
      });
      const S3 = (await mod('js/store.js?throwing=1')).Store;
      survived = S3.resume() === null && S3.setting('sound') === true;
      S3.save();
      S3.saveResume({ originSeed: 'x', tier: 'novice', w: 5, h: 5 }, Uint8Array.from(A().board()), 1000, { moves: 1, hints: 1 });
      S3.clearResume();
      survived = survived && S3.resume() === null && A().rawSave() === null;
      A().flushResume();
      A().syncAll();
      survived = survived && A().state().status === 'playing';
    } finally {
      delete w.localStorage;
      Object.defineProperty(w, 'localStorage', { value: realLS, configurable: true, writable: true });
    }
    ck('localStorage 取值就抛时也只是忘记', survived);
    eq('抛过一轮之后页面还活着', A().version, '1.0.0');
    eq('磁盘上那一串还在', JSON.parse(localStorage.getItem(KEY)).resume.hints, 1);

    // 纪录的排序口径：先比求助次数，再比步数，最后比时间
    eq('首个纪录直接成立', EN().Store.recordBest('novice', { ms: 50000, hints: 1, moves: 20, size: '5×5' }), true);
    eq('更快但更靠提示的不算破纪录', EN().Store.recordBest('novice', { ms: 1000, hints: 2, moves: 5, size: '5×5' }), false);
    eq('同求助次数下省步算破纪录', EN().Store.recordBest('novice', { ms: 60000, hints: 1, moves: 12, size: '5×5' }), true);
    eq('步数也相同时才比时间', EN().Store.recordBest('novice', { ms: 90000, hints: 1, moves: 12, size: '5×5' }), false);
    eq('纪录留的是最好的那次', EN().Store.best('novice').moves, 12);
    // 真清盘：内存与磁盘一起清（只改内存的话下一次刷新又把纪录读回来了）
    EN().Store.reset();
    eq('清完档磁盘上那个键也没了', localStorage.getItem(KEY), null);
    eq('清完档内存里也回到默认', EN().Store.data.totals.solved, 0);
    A().renderMenu();
    await wait(20);
    eq('纪录清空后页面说还没有纪录', [...document.querySelectorAll('#record-list li')].map((x) => x.dataset.tier).join(','), 'none,totals');
    eq('清档之后续档卡不许多出来', `${A().visible().resume},${shown('#resume-card')}`, 'false,false');
    // 收工：把这一局（两笔 + 一次求助）留在磁盘上 —— 下一个场景在**新的一次导航**里读它。
    A().show('menu');
    await wait(60);
    const left = JSON.parse(localStorage.getItem(KEY));
    eq('收工时磁盘上留了一档', left.resume.seed, 'scn|novice|0');
    eq('留下的墨正是手写的那三笔', EN().rleDecode(left.resume.ink, 25).join(''), INKED);
    eq('留下的代价是 2 步 1 次求助', `${left.resume.moves},${left.resume.hints}`, '2,1');
    eq('页面到收工仍然没有未捕获的异常', PROBE.js.join(' | '), '');
    return report({ bytes, runs: raw.resume.ink.length, hostile: hostile.length });
  };

  // ---------- resume：上一段 save 留在磁盘上的档，这一次是在**新的一次导航**里读回来的 ----------
  // 期望值全部来自 save 手写在盘上的那三笔（INKED）：2 步 + 1 次求助 + 5 格已定。
  const RESUMED = '1220000000000100100000000';
  const fillAt = (t, fx, fy) => {
    const r = A().cellRect(t);
    return pixel(r.x + r.size * fx, r.y + r.size * fy);
  };
  const resume = async () => {
    await booted();
    const KEY = A().saveKey();
    eq('启动后没有未捕获的异常（坏档不许把页面带跑）', PROBE.js.join(' | '), '');
    eq('启动后没有加载失败的资源', PROBE.res.join(' | '), '');
    // 这一段**不写任何东西**：磁盘上的档必须是上一个场景留下的，否则"刷新之后还在"没被证明。
    const r = A().storedResume();
    ck('刷新之后 Store 还认这一档', !!r, String(localStorage.getItem(KEY)));
    eq('档里带回来的就是那三笔', EN().rleDecode(r.ink || A().save().resume.ink, 25).join(''), RESUMED);
    eq('档的代价跟着一起回来（不洗白求助）', `${r.moves},${r.hints},${r.cells}`, '2,1,25');
    eq('开局页面自己就把续档卡摆出来了', `${A().visible().resume},${shown('#resume-card')}`, 'true,true');
    eq('续档卡写的是初学档（档位名与尺寸来自 TIERS）', text('#resume-name'), '没打完的一局：初学（5×5）');
    eq('续档卡的数就是磁盘那一档的数', text('#resume-meta'),
      `seed scn|novice|0 · 用时 ${fmtMs(r.elapsedMs)} · 2 步 · 提示 1 次 · 5/25 格已定`);
    eq('纪录表这时候还是空的（save 场景清过档）', [...document.querySelectorAll('#record-list li')].map((x) => x.dataset.tier).join(','), 'none,totals');
    const rr = $('#btn-resume').getBoundingClientRect();
    ck('继续按钮够点（≥44）', Math.round(rr.width) >= 44 && Math.round(rr.height) >= 44, `${Math.round(rr.width)}×${Math.round(rr.height)}`);
    eq('命中盒真的落在这个按钮上', document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2).id, 'btn-resume');
    const savedElapsed = r.elapsedMs;
    $('#btn-resume').click();
    await wait(120);
    eq('继续回到棋局屏', `${A().visible().game},${A().visible().menu}`, 'true,false');
    eq('续档重绘出同一张盘（夹具的初学局）', clueString(), bySeed('scn|novice|0').clue);
    eq('续档把墨一格不差地摆回来', boardString(), RESUMED);
    eq('续档把步数摆回来', A().state().moves, 2);
    eq('续档把提示次数摆回来', A().state().hints, 1);
    eq('面板的两处读数跟着续档刷新', `${text('#stat-moves')},${text('#stat-hints')},${text('#stat-filled')}`, '2,1,5/25');
    eq('时间条上的文本就是 mm:ss', /^\d{2}:\d{2}$/.test(text('#stat-time')), true);
    ck('续档接着上一档的用时往下计', A().state().elapsedMs >= savedElapsed, `${A().state().elapsedMs} vs ${savedElapsed}`);
    // 墨水是真的画上了屏：白格是纸白、未定是面板底（不是只改了个内部数组）
    const whites = [0, 13, 16].map((t) => near(fillAt(t, 0.5, 0.18), [237, 242, 250], 8));
    eq('续档的白格真的画成了纸白', whites.join(','), 'true,true,true');
    const unknowns = [3, 8, 12, 14, 20].map((t) => near(fillAt(t, 0.5, 0.18), [20, 28, 49], 8));
    eq('没落子的格仍是未定的面板底（对照）', unknowns.join(','), unknowns.map(() => 'true').join(','));
    eq('落黑的那两格不是纸白', [1, 2].map((t) => near(fillAt(t, 0.5, 0.18), [237, 242, 250], 8)).join(','), 'false,false');
    eq('续档之后撤销不能退到重开之前', A().undo(), null);
    eq('撤销失败也不动墨', boardString(), RESUMED);
    eq('续档的盘也是纯逻辑推得完的', A().state().script, 25);
    const res = A().solveWithLogic(4000);
    await wait(40);
    eq('续档可以一路推到胜利', `${res.status},${A().state().status}`, 'won,won');
    eq('终局一条违规都没有', problemsString(), '');
    eq('胜利后续档被清掉', A().hasResume(), false);
    eq('磁盘上的那一档也清掉了', JSON.parse(localStorage.getItem(KEY)).resume, null);
    eq('胜利横幅有命中盒', shown('#win-veil'), true);
    eq('纪录按这一局的代价记进档', EN().Store.best('novice').hints, A().state().hints);
    eq('累计加了这一局', `${EN().Store.totals().solved},${EN().Store.totals().hints}`, `1,${A().state().hints}`);
    A().show('menu');
    await wait(40);
    eq('胜利后回选档不再给继续', A().visible().resume, false);
    eq('续档卡收了回去：display 与命中盒都是零', (() => {
      const c = $('#resume-card');
      return `${getComputedStyle(c).display},${c.getClientRects().length},${c.offsetHeight},${c.getBoundingClientRect().height}`;
    })(), 'none,0,0,0');
    const col = document.querySelectorAll('.col')[0];
    const gapTo = Math.round(col.getBoundingClientRect().bottom - $('#tier-list').getBoundingClientRect().bottom);
    eq('隐藏的续档卡不占布局（列尾就是档位卡列表的尾）', gapTo, 0);
    eq('纪录表这时只有一档加累计', [...document.querySelectorAll('#record-list li')].map((x) => x.dataset.tier).join(','), 'novice,totals');
    // 对照例：真有一档的时候，卡片必须把列撑高（不然"隐藏"是假的）
    await open('scn|novice|0', 'novice');
    A().stroke([7], EN().WHITE);
    A().show('menu');
    await wait(40);
    const gapOn = Math.round(col.getBoundingClientRect().bottom - $('#tier-list').getBoundingClientRect().bottom);
    ck('有档时续档卡真的占位（对照例）', gapOn >= 40, `${gapOn}px`);
    eq('有档时卡片与列表之间隔着列的 gap', gapOn >= 12, true);
    // 外来的、格子数对不上的档：整份丢掉，绝不把 36 格的墨横着摆到 5×5 上。
    // 这串游程必须凑得满 36 格且成对 —— shapeOf 判的是"自洽"，
    // 拿一份连解码都过不了的墨去测"形状过关但几何错位"，测到的只是校验器没瞎。
    // seed 用初学档自己那颗：这一档只有"墨的格数"在说谎，盘面重建出来还是那张 5×5，
    // 于是"没画歪盘"与"换了一颗 seed 重新出了一盘"两件事能被分开看（换成外来 seed 就分不开了）。
    // 先清一次盘把当前那一局带走：show('menu') 会 flushResume，留着一局没打完的活盘，
    // 它会在重画之前把内存里这份外来档冲掉，测的就不是外来档了。
    A().resetSave();
    await wait(30);
    EN().Store.data.resume = {
      seed: 'scn|novice|0', tier: 'novice', cells: 36,
      ink: [2, 4, 1, 2, 2, 1, 1, 2, 2, 3, 1, 1, 2, 2, 1, 1, 2, 1, 1, 2, 2, 6, 1, 2, 2, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 3],
      moves: 9, hints: 9, elapsedMs: 3000, at: 1,
    };
    A().show('menu');
    await wait(30);
    eq('36 格的墨在"形状"这一层是自洽的（校验只保证自洽）', A().storedResume().cells, 36);
    ck('续档卡照磁盘上那份说 36 格（它报的是档，能不能落子由 resumeSaved 判）', /36 格已定/.test(text('#resume-meta')), text('#resume-meta'));
    A().resumeSaved();
    await wait(60);
    eq('格子数对不上就整份丢掉（不画歪盘）', boardString(), '0000000000000000000000000');
    eq('丢掉的墨不许假装是进度：步数也不带过来', `${A().state().moves},${A().state().hints}`, '0,0');
    eq('丢掉的墨也不许改用时', A().state().elapsedMs < 1000, true);
    eq('同一 seed 重建出来还是那张初学盘', clueString(), bySeed('scn|novice|0').clue);
    // 篡改 seed：任何字符串都换得出题（生成器是确定性的），所以这条路只能断"别自相矛盾"
    EN().Store.data.resume = { seed: 'no-such-seed', tier: 'novice', cells: 25, ink: [0, 25], moves: 4, hints: 3, elapsedMs: 1, at: 1 };
    A().resumeSaved();
    await wait(60);
    eq('换 seed 之后页面照样活着', A().state().originSeed, 'no-such-seed');
    eq('读数是自洽的：步数/求助/已定都跟着盘面走',
      `${A().state().moves},${A().state().hints},${text('#stat-moves')},${text('#stat-hints')},${text('#stat-filled')}`, '4,3,4,3,0/25');
    eq('换过 seed 之后画布上没有一格被标红', scanned().red.join(','), '');
    ck('这一盘仍然是那七条规则推得完的（生成器不出货就没这一局）', A().state().script > 0 && A().state().crossLevel === 'count',
      JSON.stringify({ script: A().state().script, cross: A().state().crossLevel }));
    // 真点一次「清空存档」：页脚那颗按钮也得经得住点
    A().show('menu');
    await wait(30);
    $('#btn-reset').click();
    await wait(60);
    eq('清空存档清掉纪录', EN().Store.best('novice'), null);
    ck('清空存档回到选档', A().visible().menu);
    eq('清空后续档也没了', `${A().hasResume()},${localStorage.getItem(KEY)}`, 'false,null');
    eq('清空存档时页面上留了一句话说清了代价', text('#tier-list .gen-fail'), '存档已清空：纪录、日课与没打完的那一局都没了。');
    eq('那句话所在的区块真的占位（不是写了字没显示）', shown('#tier-list .gen-fail'), true);
    eq('清完之后续档卡收回', shown('#resume-card'), false);
    return report({ restored: RESUMED.replace(/0/g, '').length, hints: 1, moves: 2 });
  };

  // ---------- daily：日课按日期定种子，同一种子跨 node/Chrome 画同一张盘 ----------
  const daily = async () => {
    await wipe();
    const R = await mod('js/engine/rng.js');
    const T = A().engine.TIERS;
    // rng 的钉：FNV-1a + mulberry32 只有 Math.imul，跨引擎逐位一致
    eq('hashSeed 是 FNV-1a', R.hashSeed('nurikabe'), 589334624);
    for (const f of FIXTURE.filter((x) => x.kind === 'daily')) {
      eq(`日课种子 ${f.date}`, R.dailySeed(f.date), f.seed);
    }
    eq('日课种子不是 Math.random 也不是 Date.now', /^\d+$/.test(String(R.dailySeed('2026-09-28'))), true);

    // 界面那条路：beginDaily(定死的日期)
    for (const f of FIXTURE.filter((x) => x.kind === 'daily')) {
      const [y, m, d] = f.date.split('-').map(Number);
      const g = A().beginDaily(new Date(y, m - 1, d));
      await wait(60);
      if (!g) { ck(`日课 ${f.date} 出得了题`, false, JSON.stringify(A().error())); continue; }
      eq(`日课 ${f.date} 的档位按天序轮换`, `${g.puzzle.tier},${T[f.dayIndex % T.length].key}`, `${f.tier},${f.tier}`);
      eq(`日课 ${f.date} 就是夹具那张盘`, clueString(), f.clue);
      eq(`日课 ${f.date} 的种子进了 state`, A().state().originSeed, String(f.seed));
      eq(`日课 ${f.date} 的状态行标题`, text('#stat-name'), `日课 ${f.date}`);
      eq(`日课 ${f.date} 的档位标签（档位名 · 尺寸）`, text('#stat-tier'), `${TIER_NAMES[f.tier]} · ${f.w}×${f.h}`);
      eq(`日课 ${f.date} 的档位标签带着 data-tier`, $('#stat-tier').dataset.tier, f.tier);
      eq(`日课 ${f.date} 再进一次还是同一张盘`, (() => {
        A().restart();
        return clueString();
      })(), f.clue);
    }
    // 换一局不许按日期出种（否则界面在说"换一局"而实际给的是今天这道题）
    await open('scn|novice|0', 'novice');
    const s0 = A().state().originSeed;
    A().buildAgain();
    await wait(60);
    const s1 = A().state().originSeed;
    A().buildAgain();
    await wait(60);
    const s2 = A().state().originSeed;
    ck('换一局真的换了一局', s0 !== s1 && s1 !== s2, `${s0} → ${s1} → ${s2}`);
    eq('换局的种子是 play 标签 + 随机量', /^t\.novice\.[0-9a-z]+\.[0-9a-z]+$/.test(s1), true);
    eq('种子里没有日期形状的东西', /\d{4}-\d{2}-\d{2}/.test(s1), false);
    // 同种子同盘 —— 这条要成立，先得证明两颗不同种子给的是两张不同的盘，
    // 否则"同一颗种子还是这一张"可以由"生成器永远只出一张盘"蒙过去。
    const clueAt = (seed) => (A().startPuzzle(seed, 'novice') ? clueString() : null);
    const c1 = clueAt(s1);
    const c2 = clueAt(s2);
    const c1again = clueAt(s1);
    ck('两颗不同的种子出得了题', !!c1 && !!c2, `${s1} / ${s2}`);
    ck('两颗不同的种子给出两张不同的盘', c1 !== c2, `${s1} 与 ${s2} 都是 ${c1}`);
    eq('按第一颗种子还能拿回第一张盘', c1again, c1);
    eq('按种子重建之后 state 里的账是自洽的',
      `${A().state().originSeed},${A().state().seed},${A().state().moves},${A().state().hints},${text('#stat-filled')}`,
      `${s1},${s1},0,0,0/25`);
    // 菜单那张日课卡的文案与真实日期同口径
    A().show('menu');
    await wait(40);
    const card = [...document.querySelectorAll('#tier-list .tier')].filter((c) => c.dataset.tier === 'daily')[0];
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    eq('日课卡写的是今天（本地日）', card.querySelector('.tier-note').textContent, `${key} · 全球同一道题（种子由日期决定）`);
    card.click();
    await wait(80);
    eq('点日课卡真的进了棋局屏', A().visible().game, true);
    eq('日课把当天记进了 state', A().state().day, key);
    eq('日课的名字条说的是日课', /^日课 \d{4}-\d{2}-\d{2}$/.test(text('#stat-name')), true);
    const dailySeedUsed = A().state().originSeed;
    eq('日课用的种子就是 rng 算出来的那颗', dailySeedUsed, String(R.dailySeed(key)));
    ck('日课这一局照样纯逻辑推得完', (() => {
      A().solveWithLogic(4000);
      return A().state().status === 'won' && A().problems().length === 0;
    })(), true);
    return report({ dailyRows: FIXTURE.filter((x) => x.kind === 'daily').length, today: key });
  };

  // ---------- layout：缩容器就重算，窄到夹 Cell.min 时把账算清楚 ----------
  const layout = async () => {
    await wipe();
    const MIN = 26; // js/theme.js:74 Cell.min
    const MAX = 60; // 同一行 Cell.max
    const PAD = 14; // js/render/board.js:16
    const app = $('#app');
    const geoAt = async (maxWidth) => {
      app.style.maxWidth = maxWidth === 0 ? '' : `${maxWidth}px`;
      w.dispatchEvent(new Event('resize'));
      await wait(30);
      const geo = A().geometry();
      const box = $('#board').getBoundingClientRect();
      const st = $('.stage');
      const cs = getComputedStyle(st);
      const stBox = st.getBoundingClientRect();
      return {
        cell: geo.cell,
        canvasW: Math.round(box.width),
        canvasH: Math.round(box.height),
        stageW: Math.round(stBox.width),
        // 溢出该全落到右边：往左溢的那一条是横向滚动够不着的死角，玩家只看到第一列被切半格
        canvasLeft: Math.round(box.left),
        contentLeft: Math.round(stBox.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)),
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        geo,
      };
    };
    const g = await open('scn|master|0', 'master');
    const n = 10;
    eq('大师档是 10×10', `${g.w}×${g.h}`, '10×10');
    const wide = await geoAt(0);
    eq('默认容器下画布宽就是格数×边长+两圈内边', wide.canvasW, wide.cell * n + PAD * 2);
    ck('默认容器下格子边长在 26–60 之间', wide.cell >= MIN && wide.cell <= MAX, String(wide.cell));
    eq('默认容器下不出现横向滚动条', wide.scroll, 0);
    ck('画布底边不逼着人往下滚', wide.canvasH + $('#board').getBoundingClientRect().top <= window.innerHeight + 1, `${Math.round($('#board').getBoundingClientRect().bottom)} vs ${window.innerHeight}`);
    const steps = [700, 560, 460, 380];
    const seen = [wide.cell];
    for (const px of steps) {
      const s = await geoAt(px);
      seen.push(s.cell);
      eq(`${px}px 容器下画布宽 = 边长×10+28`, s.canvasW, s.cell * n + PAD * 2);
      eq(`${px}px 容器没有横向滚动条`, s.scroll, 0);
      ck(`${px}px 容器下画布不溢出 .stage`, s.canvasW <= s.stageW + 1, `${s.canvasW} vs ${s.stageW}`);
      ck(`${px}px 容器下格子还在地板之上`, s.cell >= MIN, String(s.cell));
    }
    eq('容器一级级缩，边长一级级不增', seen.filter((v, i) => i && v > seen[i - 1]).length, 0);
    eq('缩容器真的改变了边长（不是把同一张画布摆来摆去）', new Set(seen).size > 1, true);
    // 每档尺寸都照容器重算：换盘必须换边长（lastBox 在 startPuzzle 里被清零）
    const back = await geoAt(0);
    eq('放开容器就回到原来的边长（没有迟滞）', back.cell, wide.cell);
    await open('scn|novice|0', 'novice');
    const noviceWide = await geoAt(0);
    eq('同一容器下 5×5 顶到 Cell.max', noviceWide.cell, MAX);
    eq('5×5 的画布就是 5 格 + 两圈内边', noviceWide.canvasW, MAX * 5 + PAD * 2);
    // 夹到地板：300px 容器装不下 10×10 的 26px 地板，这时候账要摊开
    await open('scn|master|0', 'master');
    const tight = await geoAt(300);
    eq('窄到夹不住时格子夹在 Cell.min', tight.cell, MIN);
    eq('夹住之后画布宽就是 26×10+28', tight.canvasW, MIN * n + PAD * 2);
    // #app 的 300px 是 border-box，所以 .stage 在单列下该拿到 300-2×Space.page=260。
    // 这条钉的是"侧栏真收了"：它还赖在 minmax(268px,…) 上时 .stage 只有 34px，
    // 画布溢出的就不是 28 而是 254 —— 上一版把 34 当成容器给不出的量，正好把这件事看反。
    const PAGE = 20; // js/theme.js Space.page
    eq('窄到夹不住时 .stage 拿到容器的整个内容盒（侧栏收了）', tight.stageW, 300 - PAGE * 2);
    eq('夹不住时宁可让画布超出容器也不许把格子切一半', tight.canvasW - tight.stageW, MIN * n + PAD * 2 - (300 - PAGE * 2));
    ck('溢出全落在右边：画布左边缘不越过 .stage 的内容盒（往左溢的那条是滚不回去的死角）',
      tight.canvasLeft >= tight.contentLeft, `${tight.canvasLeft} vs ${tight.contentLeft}`);
    // 换盘必须换边长。宽容器上取不到这件事的证：5×5 和 10×10 那时都顶在 Cell.max，
    // 60 vs 60 既是"重算了"的样子也是"没重算"的样子。夹不住的这一档才有分辨力：
    // 同一只 300px 容器，10×10 被地板按住 26，5×5 装得下就该重算回 42。
    await open('scn|novice|0', 'novice');
    const tightSmall = await geoAt(300);
    ck('同一只窄容器里换 5×5 就重算边长（不是把 10×10 的画布搬过来）', tightSmall.cell > tight.cell, `${tightSmall.cell} vs ${tight.cell}`);
    eq('重算后的画布还是 5 格 + 两圈内边', tightSmall.canvasW, tightSmall.cell * 5 + PAD * 2);
    // 这里不断言横向滚动条：300px 的 #app 摆在 1280 视口里，画布再怎么溢也出不了视口，
    // 量到的"没滚动"是构造出来的假绿。真窄视口那一档在 narrow 场景里按每个量级量。
    await open('scn|master|0', 'master');
    // 命中盒在两种尺寸下都跟得上画面
    for (const px of [0, 460]) {
      const s = await geoAt(px);
      let missed = 0;
      for (let t = 0; t < n * n; t++) {
        const p = at(t);
        if (A().hitAt(p.x, p.y) !== t) missed++;
      }
      eq(`${px || 'default'}px 容器下每一格仍点得中自己`, missed, 0);
      const last = at(n * n - 1);
      const cbox = $('#board').getBoundingClientRect();
      // 边长为奇数时格子的正中心落在半像素上：两边都取整再比，比的还是"同一个坐标"，
      // 而不是拿画布的整数像素去对一个 .5 的算式（460px 那一档 35 的边长就是这么红的）。
      const c = (v) => Math.round(v);
      eq(`${px || 'default'}px 容器下最后一格的中心就是它的画布坐标`, `${c(last.x - cbox.left)},${c(last.y - cbox.top)}`,
        `${c((n - 1) * s.cell + PAD + s.cell / 2)},${c((n - 1) * s.cell + PAD + s.cell / 2)}`);
    }
    // 换视口高度也要重算：把 innerHeight 夹小，格子要跟着缩。
    // 基线得取同一只容器、真实视口高下的那一份：tight 那一档已经被 Cell.min 按在 26 上，
    // 拿它当基线等于要求格子缩到地板以下 —— 而数墙的地板恰恰是不许穿过去的。
    // 实测：460px 容器 × 1024 视口是 35，同一容器夹到 420 视口是 26（顶到地板）。
    const tall = await geoAt(460);
    const realH = Object.getOwnPropertyDescriptor(w, 'innerHeight');
    try {
      Object.defineProperty(w, 'innerHeight', { configurable: true, get: () => 420 });
      w.dispatchEvent(new Event('resize'));
      await wait(30);
      const low = await geoAt(460);
      ck('同一容器下视口变矮，格子跟着变小', low.cell < tall.cell, `${low.cell} vs ${tall.cell}`);
      // 视口矮到连"上方那一圈固定高度 + 一格 26 的十行"都摆不下时（实测 420 高时画布底边到 469），
      // 账是这么摊的：地板守住、格子保持整块，多出来的一段交给竖向滚动。
      eq('缩到地板就停：视口再矮也不把格子切半', low.cell, MIN);
      eq('视口变矮也不出横向滚动条', low.scroll, tall.scroll);
    } finally {
      if (realH) Object.defineProperty(w, 'innerHeight', realH);
      else delete w.innerHeight;
      w.dispatchEvent(new Event('resize'));
      await wait(30);
    }
    app.style.maxWidth = '';
    w.dispatchEvent(new Event('resize'));
    await wait(30);
    eq('收工：容器放开之后回到默认边长', A().geometry().cell, wide.cell);
    eq('收工：盘面还是夹具那张盘', clueString(), bySeed('scn|master|0').clue);
    return report({ cell: wide.cell, tightCell: tight.cell, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
  };

  // ---------- narrow：Pages 上真会遇到的窄视口（容器查询单列），两种形态都要过 ----------
  const narrow = async () => {
    await wipe();
    eq('视口真的换成了 500×780', `${window.innerWidth},${window.innerHeight}`, '500,780');
    for (const f of FIXTURE.filter((x) => x.kind === 'tier')) {
      await open(f.seed, f.tier);
      // 单列这一条必须在摆开的棋局屏上量：#view-game 藏着的时候容器查询算不出轨宽，
      // getComputedStyle 回的是写死的那两轨（换成照 #app 判之前，它在菜单上"碰巧"答对过）。
      eq(`${f.tier}：窄视口下棋局页收成单列（门槛跟着容器走）`, getComputedStyle($('#view-game')).gridTemplateColumns.split(' ').length, 1);
      const geo = A().geometry();
      const box = $('#board').getBoundingClientRect();
      const scroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      eq(`${f.tier}：${f.w}×${f.h} 在 500px 视口里没有横向滚动条`, scroll, 0);
      ck(`${f.tier}：画布整个落在视口里`, box.left >= 19 && box.right <= window.innerWidth - 19 && box.bottom <= window.innerHeight + 1,
        JSON.stringify({ l: Math.round(box.left), r: Math.round(box.right), b: Math.round(box.bottom), vh: window.innerHeight }));
      ck(`${f.tier}：格子边长在地板之上`, geo.cell >= 26, String(geo.cell));
      eq(`${f.tier}：画布宽 = 边长×${f.w}+28`, Math.round(box.width), geo.cell * f.w + 28);
      let missed = 0;
      for (let t = 0; t < f.w * f.h; t++) {
        const p = at(t);
        if (A().hitAt(p.x, p.y) !== t) missed++;
      }
      eq(`${f.tier}：每一格仍点得中自己`, missed, 0);
      const panel = $('.panel').getBoundingClientRect();
      ck(`${f.tier}：面板落在棋盘之下（单列不叠）`, panel.top >= box.bottom - 1, `${Math.round(panel.top)} vs ${Math.round(box.bottom)}`);
      const small = [...document.querySelectorAll('#app button')].filter((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && (Math.round(r.width) < 44 || Math.round(r.height) < 44);
      }).map((x) => x.id);
      eq(`${f.tier}：窄视口下仍然没有到不了 44 的目标`, small.join(' | '), '');
    }
    // 提示与冲突在这条视口里同样要说得清（面板被压到下面，文本不许截断）
    await open('scn|novice|0', 'novice');
    const h = A().hint();
    await wait(30);
    eq('窄视口里提示标题仍然写对', text('#hint-rule'), `${EN().Rules[h.ruleKey].name}（第 ${EN().Rules[h.ruleKey].tier} 层推理）`);
    const hb = $('.hint-box');
    ck('提示框没有把句子截掉', hb.scrollWidth <= hb.clientWidth + 1, `${hb.scrollWidth} vs ${hb.clientWidth}`);
    eq('窄视口里状态行仍然在文档流里', $('#state-line').getClientRects().length > 0, true);
    return report({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, tiers: 5 });
  };

  w.__scn = { first, zero, hint, conflict, save, resume, daily, layout, narrow };
})(window);
