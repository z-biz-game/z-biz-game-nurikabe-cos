// 动效层：盘面上唯一按帧跑的东西。
//
// 为什么要单独一层，而不是在 paint() 里读一下 Date.now()：
// 后者让"这一帧画成什么样"取决于浏览器多久给一次帧 —— 60Hz、120Hz、被降频到 30Hz
// 的省电模式，同一句"落一笔"就跑出不一样的粒子位置，动画的时长就不再是玩家看到的时长。
// 所以这里跑**定步长累加器**：真实经过的时间先攒进 accum，攒够一个 SIM_STEP 才推进一格仿真，
// 剩下的零头留在 accum 里下一帧接着攒。于是仿真时间只由"过了多久"决定，与帧数无关，
// 而 30/60/120Hz 下同一笔落子落在同一个仿真刻度上。

import { Motion, Palette } from '../theme.js';

// 一秒 60 个刻度：这是仿真的刻度，不是屏幕的刷新率。
export const SIM_STEP = 1000 / 60;
// 单帧最多补这几步：标签页被冻了半分钟回来，粒子不许一口气穿屏。
const MAX_CATCHUP = 5;
const LIFE = 520; // 一记墨点的寿命（ms，仿真时间）
const WIN_LIFE = Motion.win; // 胜利那圈的粒子跟着主题里那条 900ms 走

let lastTs = -1; // 上一帧的时间戳：rAF 给的是 DOMHighResTimeStamp，同一坐标系才能相减当 dt
let accum = 0; // 还没攒够一个刻度的零头
let simMs = 0; // 仿真时钟：只有 step() 会推它，暂停/降频都改不了它的刻度
let ticks = 0;
let raf = 0;
let halted = false; // 暂停：帧照样来，但时间不进累加器
let reduced = false; // 减少动效：不建粒子，也不挂 rAF
let particles = [];
let dirty = false;
let repaints = 0; // 真被要求重绘了几次（闸读它，确认动画不是每帧无脑重画）
let onFrame = null;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 一格墨落进海里：粒子只在画布四周那条 pad 带里跑（盘面内部一格都不碰）。
 * 这不是偷懒 —— 像素断言取的是格心，落子动画要是漫进格子里，"墨水是真的画成了这个颜色"
 * 就从断言变成看运气。带内的水花同样能传达"落下了"，而且不会把格心改掉。
 */
function bandFor(geo, cy) {
  const boardBottom = geo.y + geo.cellsH;
  const useTop = cy - geo.y < boardBottom - cy;
  return useTop ? { lo: 1, hi: Math.max(1, geo.y - 2) } : { lo: boardBottom + 2, hi: Math.max(boardBottom + 3, geo.h - 1) };
}

export const Anim = {
  stepMs: SIM_STEP,

  start(cb) {
    onFrame = cb || onFrame;
    if (reduced || raf || typeof requestAnimationFrame !== 'function') return Anim.state();
    lastTs = -1;
    raf = requestAnimationFrame(ring);
    return Anim.state();
  },

  stop() {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    lastTs = -1;
    return Anim.state();
  },

  /** 换一盘/重开：粒子、仿真时钟、累加零头一起归零，不留上一盘的残影。 */
  reset() {
    particles = [];
    accum = 0;
    simMs = 0;
    ticks = 0;
    repaints = 0;
    lastTs = -1;
    dirty = false;
    return Anim.state();
  },

  setHalted(on) {
    halted = !!on;
    lastTs = -1; // 暂停这期间的墙上时间不该补进仿真：回来从下一帧重新起算
    return halted;
  },

  setReduced(on) {
    reduced = !!on;
    if (reduced) {
      Anim.stop();
      particles = [];
      dirty = false;
    } else {
      Anim.start();
    }
    return reduced;
  },

  reduced: () => reduced,

  /**
   * 落一笔的水花。geo 需要 { x, y, w, h, cell } 与 cellsH（盘面高，由 BoardView 填好）。
   * 返回生成几颗 —— 0 就是"减少动效时真的没建粒子"，不是建了不画。
   */
  splash(geo, cx, cy, n = 7, opts = {}) {
    if (reduced || !geo || !geo.cellsH) return 0;
    const band = bandFor(geo, cy);
    const color = opts.color || Palette.wallEdge;
    const speed = opts.speed || 0.055; // px/ms：定步长下每刻度约 0.9px
    for (let i = 0; i < n; i++) {
      // 用序号而不是 Math.random()：同一笔落下必须得到同一串粒子，否则"重绘一次就换个样"
      const a = ((i * 2654435761) >>> 0) / 4294967296;
      const dir = i % 2 === 0 ? -1 : 1;
      particles.push({
        x: clamp(cx + (a - 0.5) * geo.cell * 0.8, 1, geo.w - 1),
        y: clamp(cy > geo.y + geo.cellsH / 2 ? band.lo + 2 : band.hi - 2, band.lo, band.hi),
        vx: (a - 0.5) * speed * 1.6,
        vy: dir * speed * (0.7 + a * 0.6),
        life: opts.life || LIFE,
        age: 0,
        size: Math.max(1.5, geo.cell * 0.06 * (0.6 + a)),
        color,
        band,
      });
    }
    dirty = true;
    return n;
  },

  /** 胜利：沿四条 pad 带各来一串，寿命是主题里那条 win。 */
  celebrate(geo) {
    if (reduced || !geo || !geo.cellsH) return 0;
    let n = 0;
    const midY = geo.y + geo.cellsH / 2;
    const midX = geo.x + geo.cellsW / 2;
    for (let i = 0; i < 6; i++) {
      n += Anim.splash(geo, geo.cellsW * (i + 0.5) / 6 + geo.x, midY, 1, { color: Palette.success, life: WIN_LIFE });
      n += Anim.splash(geo, midX, geo.cellsH * (i + 0.5) / 6 + geo.y, 1, { color: Palette.success, life: WIN_LIFE });
    }
    return n;
  },

  state: () => ({
    running: !!raf,
    halted,
    reduced,
    simMs: Math.round(simMs),
    ticks,
    alive: particles.length,
    repaints,
    stepMs: SIM_STEP,
  }),

  // 画布上的粒子：只用仿真时间算透明度，帧率不进这里。
  draw(ctx, geo) {
    if (!particles.length) return 0;
    let drawn = 0;
    for (const p of particles) {
      const k = 1 - p.age / p.life; // 寿命归零就是 0，与 dt 无关
      if (k <= 0) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, k));
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * k);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  },
};

function step(dt) {
  simMs += dt;
  ticks++;
  if (!particles.length) return;
  for (const p of particles) {
    p.x += p.vx * dt; // 定步长：每刻度的位移只由 dt（=SIM_STEP）决定
    p.y += p.vy * dt;
    p.vy += 0.00025 * dt * (p.vy < 0 ? 1 : -1); // 水花到顶/到底就往回收，像落回海面
    p.age += dt;
    p.y = clamp(p.y, p.band.lo, p.band.hi); // 粒子被关在带里，盘面内部一个像素都不许染上
  }
  particles = particles.filter((p) => p.age < p.life);
}

function ring(ts) {
  raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(ring) : 0;
  // dt = 这一帧真实经过了多少毫秒。它只进累加器，绝不直接进粒子的位移。
  const dt = lastTs < 0 ? 0 : Math.max(0, ts - lastTs);
  lastTs = ts;
  if (halted) {
    dirty = false;
    return;
  }
  const aliveBefore = particles.length;
  accum += dt; // 真实经过的时间只进累加器，一帧跑多少步由攒够几个刻度决定
  let guard = 0;
  let advanced = 0;
  while (accum >= SIM_STEP && guard++ < MAX_CATCHUP) {
    accum -= SIM_STEP;
    step(SIM_STEP);
    advanced++;
  }
  if (accum > SIM_STEP * MAX_CATCHUP) accum = 0; // 补不完的零头直接放掉，不许欠着一大笔慢慢还
  // 推进过、或者屏幕上还留着上一帧的粒子，就必须重绘一次 —— 否则最后那一颗死在带里，
  // 而画布上留着一个没人负责擦掉的点。
  if (advanced && (particles.length || aliveBefore)) dirty = true;
  if (dirty && onFrame) {
    dirty = particles.length > 0;
    repaints++;
    onFrame();
  }
}
