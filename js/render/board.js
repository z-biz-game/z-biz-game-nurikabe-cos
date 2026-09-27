// 画布渲染器：它只读 Game 里的引擎状态并把它画出来，自己不做任何判断 ——
// 这里不算"这个岛凑满没有"、也不判"这一格是不是撞了规则"，那些都是 js/engine/nurikabe.js
// 的 diagnose() 给的结论。于是"屏幕上好看"和"引擎认为这盘成立"不可能各说各话。
//
// 版面算术（格子边长、原点、DPR）也住在这个文件里，因为 hitCell 必须用 draw 用过的**同一批**
// 数字回答"你点的是哪一格"。两边各算各的，就会出现"画对了、点歪一格"那种最耗人的毛病。

import { Palette, Cell, Radius, Font } from '../theme.js';
import { WHITE, BLACK } from '../engine/nurikabe.js';

/**
 * 一格多大的唯一决定处。数墙的数字住在格子里（不像五寸钉住在交叉点上），
 * 所以留白只需要一圈画布内边。
 */
export function layoutFor(w, h, availW, availH) {
  const pad = 14;
  const size = Math.max(0, Math.min((availW - pad * 2) / w, (availH - pad * 2) / h));
  const cell = Math.max(Cell.min, Math.min(Cell.max, Math.floor(size)));
  return { cell, boardW: cell * w, boardH: cell * h, pad };
}

// 云点的位置由格子编号自己决定（不是随机数）：同一块盘重画多少次都长一个样，
// 撤销/重做也就不会带着一片"每帧换位置"的雪花。
function cloudOf(t, cell) {
  const k = (t * 2654435761) >>> 0;
  const r = (shift, mod) => ((k >>> shift) % mod) / mod;
  return [
    { x: (0.18 + r(3, 22) / 100) * cell, y: (0.24 + r(9, 26) / 100) * cell, s: 0.155 },
    { x: (0.56 + r(15, 20) / 100) * cell, y: (0.6 + r(21, 22) / 100) * cell, s: 0.13 },
    { x: (0.66 + r(6, 14) / 100) * cell, y: (0.28 + r(12, 16) / 100) * cell, s: 0.095 },
  ];
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1 };
    this.game = null;
  }

  // 后备缓冲按设备像素开，绘制代码全程只用 CSS 像素：顶部一次 ctx.scale，
  // 数字在视网膜屏上是利的，而不用把这份文件里每个常数都乘两遍。
  resize(game, availW, availH) {
    const l = layoutFor(game.w, game.h, availW, availH);
    const dpr = Math.max(1, Math.round((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    const size = { w: l.boardW + l.pad * 2, h: l.boardH + l.pad * 2 };
    this.canvas.style.width = `${size.w}px`;
    this.canvas.style.height = `${size.h}px`;
    this.canvas.width = Math.round(size.w * dpr);
    this.canvas.height = Math.round(size.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w: size.w, h: size.h, dpr };
    this.game = game;
    return this.geo;
  }

  cellRect(t) {
    const { cell, x, y } = this.geo;
    const w = this.game.w;
    return { x: (t % w) * cell + x, y: (((t / w) | 0) * cell) + y, size: cell };
  }

  // 屏幕坐标 → 格子编号。用的是 resize() 存下来的那一份几何。
  hitCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, x, y } = this.geo;
    const game = this.game;
    if (!cell || !game) return -1;
    const px = clientX - rect.left - x;
    const py = clientY - rect.top - y;
    if (px < 0 || py < 0) return -1;
    const gx = Math.floor(px / cell);
    const gy = Math.floor(py / cell);
    if (gx < 0 || gy < 0 || gx >= game.w || gy >= game.h) return -1;
    return gy * game.w + gx;
  }

  draw(game, { pulse = null, preview = null } = {}) {
    this.game = game;
    const { ctx, geo } = this;
    const { cell } = geo;
    const b = game.board;
    const st = game.st;
    const diag = game.diag;
    const bad = diag.markedCells;
    const won = game.status === 'won';
    ctx.clearRect(0, 0, geo.w, geo.h);

    roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
    ctx.fillStyle = Palette.surface;
    ctx.fill();

    // ---- 底：未定是面板底，墙是最暗的那层。白岛最后盖上来，所以"海"不需要闭合形状。
    for (let t = 0; t < b.n; t++) {
      const r = this.cellRect(t);
      ctx.fillStyle = st.cell[t] === BLACK ? Palette.wall : Palette.unknownCell;
      ctx.fillRect(r.x, r.y, cell, cell);
    }

    // 云点：数墙的老传统（海上的云），也让一整片黑不至于糊成一块死色。
    const dotR = Math.max(1.5, cell * Cell.dotScale);
    ctx.fillStyle = Palette.wallEdge;
    for (let t = 0; t < b.n; t++) {
      if (st.cell[t] !== BLACK) continue;
      const r = this.cellRect(t);
      for (const c of cloudOf(t, cell)) {
        ctx.beginPath();
        ctx.arc(r.x + c.x, r.y + c.y, dotR * (c.s / Cell.dotScale), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 细网格只画在未定与墙上：岛的轮廓本身就是分隔线，两边都画就成了两套线打架。
    ctx.strokeStyle = Palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= b.w; i++) seg(ctx, geo.x + i * cell, geo.y, geo.x + i * cell, geo.y + b.h * cell);
    for (let j = 0; j <= b.h; j++) seg(ctx, geo.x, geo.y + j * cell, geo.x + b.w * cell, geo.y + j * cell);
    ctx.stroke();

    // ---- 岛：一整块纸白的连通区域画成一个轮廓（一格一条边的那种画法会让岛看起来是拼的）。
    const landBorder = [];
    const bw = Math.max(1.5, cell * Cell.borderScale);
    ctx.fillStyle = Palette.land;
    for (let t = 0; t < b.n; t++) {
      if (st.cell[t] !== WHITE) continue;
      const r = this.cellRect(t);
      ctx.fillRect(r.x, r.y, cell, cell);
      // 四条边：邻格不是白格（或者根本没有邻格）才要描
      const x = t % b.w;
      const y = (t / b.w) | 0;
      const own = st.owner[t];
      const done = own >= 0 && diag.islands[own] && diag.islands[own].ok;
      if (y === 0 || st.cell[t - b.w] !== WHITE) landBorder.push([r.x, r.y, r.x + cell, r.y, done]);
      if (y === b.h - 1 || st.cell[t + b.w] !== WHITE) landBorder.push([r.x, r.y + cell, r.x + cell, r.y + cell, done]);
      if (x === 0 || st.cell[t - 1] !== WHITE) landBorder.push([r.x, r.y, r.x, r.y + cell, done]);
      if (x === b.w - 1 || st.cell[t + 1] !== WHITE) landBorder.push([r.x + cell, r.y, r.x + cell, r.y + cell, done]);
    }
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2, done] of landBorder) {
      ctx.strokeStyle = done ? Palette.success : Palette.landEdge;
      ctx.lineWidth = bw;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // ---- 还没归属的白格（孤立的一块岛料）：点一条虚线，意思是"它得跟哪个岛连上才算数"。
    ctx.strokeStyle = Palette.pencilStrong;
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.setLineDash([Math.max(3, cell * 0.12), Math.max(3, cell * 0.12)]);
    for (let t = 0; t < b.n; t++) {
      if (st.cell[t] !== WHITE || st.owner[t] >= 0) continue;
      const r = this.cellRect(t);
      ctx.strokeRect(r.x + cell * 0.3, r.y + cell * 0.3, cell * 0.4, cell * 0.4);
    }
    ctx.setLineDash([]);

    // ---- 撞破规则的格：一方红框。画在岛之后是因为岛的纸白会把先画的底色整个盖掉
    // （原先这里是 22% 的透底染色，落在岛上等于没画 —— 而白格的超编/并岛恰恰是最常见的撞法）。
    if (bad.size) {
      for (const t of bad) markRect(ctx, this.cellRect(t), cell, Palette.error);
    }

    // ---- 数字：SF Mono，压在岛上/未定格上。颜色跟着底色走，保证永远读得清。
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = Math.round(cell * 0.5);
    ctx.font = `700 ${fs}px ${Font.mono}`;
    for (const num of b.numbers) {
      const r = this.cellRect(num.cell);
      const v = st.cell[num.cell];
      ctx.fillStyle = v === BLACK ? Palette.error : v === WHITE ? Palette.landInk : Palette.ink;
      ctx.fillText(String(num.size), r.x + cell / 2, r.y + cell / 2 + 1);
      // 岛凑满了就在数字外面套一个环 —— "这块的账平了"要能在不数格子的时候看出来。
      if (diag.islands[num.idx] && diag.islands[num.idx].ok) {
        ctx.beginPath();
        ctx.arc(r.x + cell / 2, r.y + cell / 2, Math.max(6, cell * 0.34), 0, Math.PI * 2);
        ctx.strokeStyle = Palette.success;
        ctx.lineWidth = Math.max(1.5, cell * 0.045);
        ctx.stroke();
      }
    }

    // ---- 手指还没抬起的那几格：预览只是画，不是墨水。
    if (preview && preview.cells && preview.cells.length) {
      ctx.strokeStyle = Palette.accent;
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.setLineDash([Math.max(4, cell * 0.2), Math.max(3, cell * 0.14)]);
      for (const t of preview.cells) {
        if (t < 0 || t >= b.n) continue;
        const r = this.cellRect(t);
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, cell - 3, cell - 3);
      }
      ctx.setLineDash([]);
    }

    // ---- 提示刚点名的那一格：整个界面只有这一处被允许说"看这里"。
    if (pulse && pulse.cell != null) {
      markRect(ctx, this.cellRect(pulse.cell), cell, pulse.color || Palette.hint);
    }

    // ---- 通关：外框转绿，横幅由样式表负责。
    if (won) {
      ctx.strokeStyle = Palette.success;
      ctx.lineWidth = 2;
      roundRect(ctx, 1, 1, geo.w - 2, geo.h - 2, Radius.card - 1);
      ctx.stroke();
    }
  }
}

function seg(ctx, x1, y1, x2, y2) {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

/**
 * 一格上的标记框：红框（这里错了）与提示圈（看这里）共用这一条几何，只有颜色分开。
 * 内缩到半线宽之外（再让出 0.5px 给抗锯齿）不是审美：压在格边上的描边会把颜色漏进邻格，
 * 邻格没被求过却带着一圈提示色的毛边 —— 满屏的"看这里"就是这么来的。
 * 直角而不是圆角：小盘上圆角会让四个角没墨，一格框只认得出一半。
 */
function markRect(ctx, r, cell, color) {
  const lw = Math.max(2, cell * 0.09);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(r.x + lw / 2 + 0.5, r.y + lw / 2 + 0.5, cell - lw - 1, cell - lw - 1);
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
