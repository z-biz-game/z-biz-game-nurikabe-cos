// BRIEF_COS §3/§6 要求的自建对拍台。官方 cos_frame_probe.js 对本仓报
// `结论：无法比对（SyntaxError: Cannot use import statement outside a module）`——
// 它只会 vm 加载经典脚本，而本仓是零构建 ESM（58/98 个 cos 仓都是）。
// "无法比对"不是通过，所以这里自己造时钟：沙箱起点 1000ms，30/60/120Hz 各跑同一段
// 虚拟时长，按仿真刻度对齐，逐字段比；再跑两条阴性对照，它们必须变红。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

// 仓库根就从本文件的位置推：搬到别人机器上、CI 里，这条命令都还在量同一个东西。
const REPO = decodeURIComponent(new URL('..', import.meta.url).pathname);
const ANIM = `${REPO}/js/render/anim.js`;
const THEME = `${REPO}/js/theme.js`;
const GEO = { cell: 40, x: 14, y: 14, w: 214, h: 214, dpr: 2, cellsW: 200, cellsH: 200 };
const TOTAL = 410; // 同一段虚拟时长（ms）：投递给仿真的时间对每一档都精确相等
const ALIGN = 20; // 对齐到第 20 个仿真刻度取像：同一刻度必须是同一串像素
const CLOCK0 = 1000; // 沙箱时钟起点：不从 0 起，避开"首帧 dt=0"那种假通过
const STEP_PX = 0.9;
const ONE_STEP = 1000 / 60; // 一个刻度里粒子约走 0.9px：用它把偏差换算成"漂了几格"
const RATIO_MAX = 3.6; // 判据给的阈值

let pending = [];
globalThis.requestAnimationFrame = (cb) => pending.push(cb);
globalThis.cancelAnimationFrame = () => {};

// 粒子位置不对外开，但 draw() 就是它们的唯一出口：假画布把 fillRect 收下来，
// 得到的是"玩家看到的那一串数"，比读内部数组更接近真相。
function fingerprint(A) {
  const rec = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    fillRect(x, y, w) {
      rec.push([+this.globalAlpha.toFixed(4), +x.toFixed(4), +y.toFixed(4), +w.toFixed(4)]);
    },
  };
  A.draw(ctx, GEO);
  rec.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  return rec;
}

async function loadAnim(mut) {
  let src = fs.readFileSync(ANIM, 'utf8').replace("'../theme.js'", JSON.stringify(THEME));
  if (mut) {
    const hit = src.split(mut.from).length - 1;
    if (hit !== 1) throw new Error(`阴性对照没钉中：${mut.from} 命中 ${hit} 处`);
    src = src.replace(mut.from, mut.to);
  }
  const tmp = `/tmp/nurikabe_anim_${mut ? mut.name : 'real'}.mjs`;
  fs.writeFileSync(tmp, src);
  return import(`${pathToFileURL(tmp).href}?v=${mut ? mut.name : 'real'}${process.pid}`);
}

async function runAt(mod, hz, jitterSeed) {
  const A = mod.Anim;
  A.stop(); // 上一轮留在 pending 里的那条 ring 要先摘掉，否则 start() 看见 raf 还在就不重排
  pending = [];
  A.reset();
  A.setReduced(false); // 内部走 Anim.start()，这一条才真正把 ring 挂回 pending
  A.start(() => {});
  const spawned = A.splash(GEO, 120, 90, 7); // 一笔落子的水花：固定格心、固定 7 颗
  const base = 1000 / hz;
  let t = CLOCK0;
  let lcg = (jitterSeed || 1) >>> 0;
  const rnd = () => ((lcg = (lcg * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  let frames = 0;
  let atAlign = null;
  // 时间戳一路走到 CLOCK0+TOTAL：第一帧的 dt 恒为 0（lastTs 还没建立），所以真正投递给
  // 仿真的时间对 30/60/120Hz 都是同一个 TOTAL —— 不拿帧数当投递量，才不会把泵环的
  // 舍入误差误读成"动画跟着帧率跑"。
  while (t - CLOCK0 <= TOTAL && frames++ < 100000) {
    const cbs = pending;
    pending = [];
    for (const cb of cbs) cb(t);
    if (!atAlign && A.state().ticks >= ALIGN) atAlign = fingerprint(A);
    t += base * (jitterSeed ? 1 + 0.4 * rnd() : 1); // 抖动那一档模拟真实掉帧
  }
  const s = A.state();
  return { ticks: s.ticks, simMs: s.simMs, alive: s.alive, spawned, frames, fp: atAlign || fingerprint(A), stepPx: (atAlign ? 0 : 1) };
}

function diff(a, b) {
  let worst = 0;
  const n = Math.max(a.fp.length, b.fp.length);
  for (let i = 0; i < n; i++) {
    const p = a.fp[i] || [0, 0, 0, 0];
    const q = b.fp[i] || [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs((p[k] || 0) - (q[k] || 0)));
  }
  return { worst, count: `${a.fp.length}/${b.fp.length}`, steps: `${a.ticks}vs${b.ticks}`, sim: `${a.simMs}vs${b.simMs}` };
}

const rows = [];
const line = (name, ok, detail) => {
  console.log(`${ok ? '绿' : '红'} ${name}\n    ${detail}`);
  rows.push(ok);
  return ok;
};

const real = await loadAnim();
const c60 = await runAt(real, 60, 0);
const c30 = await runAt(real, 30, 0);
const c120 = await runAt(real, 120, 0);
const cj60 = await runAt(real, 60, 20261002); // 同频，每帧 ±20% 抖动

const d30 = diff(c60, c30);
const d120 = diff(c60, c120);
const dj = diff(c60, cj60);
const ratio = Math.max(d30.worst, d120.worst, dj.worst) / STEP_PX;
const simErr = Math.max(...[c60, c30, c120, cj60].map((r) => Math.abs(r.simMs - TOTAL)));
line('M1 同一仿真刻度 = 同一串像素：第 20 个刻度上 30/60/120Hz（含 ±20% 抖动档）逐字段比对',
  ratio <= RATIO_MAX && d30.count === '7/7' && d120.count === '7/7' && dj.count === '7/7',
  `最大偏差 30Hz=${d30.worst} 120Hz=${d120.worst} 抖动=${dj.worst}px ⇒ ratio ${ratio.toFixed(4)} ≤ ${RATIO_MAX}（阈值 3.6 格）`);
const tickSpread = Math.max(c60.ticks, c30.ticks, c120.ticks, cj60.ticks) - Math.min(c60.ticks, c30.ticks, c120.ticks, cj60.ticks);
line('M2 仿真时钟跟着投递的时间走，不跟帧数走',
  simErr <= 2 * ONE_STEP && tickSpread <= 1,
  `投递 ${TOTAL}ms ⇒ simMs ${c60.simMs}/${c30.simMs}/${c120.simMs}/${cj60.simMs}（最大误差 ${simErr.toFixed(2)} ≤ 两刻度 ${(2 * ONE_STEP).toFixed(2)}）· ticks ${c60.ticks}/${c30.ticks}/${c120.ticks}/${cj60.ticks} 极差 ${tickSpread} ≤1（粗帧率下投递量只能是帧长的整数倍，这 1 格是量化而非动画追帧）· 帧数 ${c60.frames}/${c30.frames}/${c120.frames}`);

const mutA = { name: 'A', from: '    step(SIM_STEP);', to: '    step(dt);' };
const mutB = { name: 'B', from: '  accum += dt;', to: '  accum += SIM_STEP;' };
const badA = await loadAnim(mutA);
const a60 = await runAt(badA, 60, 0);
const a120 = await runAt(badA, 120, 0);
const dA = diff(a60, a120);
line('阴性对照 A：把定步长换成按帧 dt 直接推进 —— 必须被 M1 抓到',
  dA.worst / STEP_PX > RATIO_MAX,
  `同一刻度上偏差 ${dA.worst}px ⇒ ratio ${(dA.worst / STEP_PX).toFixed(3)}（要求 >${RATIO_MAX}）；刻度 ${dA.steps} simMs ${dA.sim}`);

const badB = await loadAnim(mutB);
const b60 = await runAt(badB, 60, 0);
const b120 = await runAt(badB, 120, 0);
const dB = diff(b60, b120);
const bErr = Math.max(Math.abs(b60.simMs - TOTAL), Math.abs(b120.simMs - TOTAL));
line('阴性对照 B：累加器改吃固定一格（每帧都推进刻度，无视真实时间）—— 必须被 M2 抓到',
  bErr > ONE_STEP,
  `投递 ${TOTAL}ms 之后 simMs：60Hz=${b60.simMs} 120Hz=${b120.simMs}（误差 ${bErr.toFixed(0)}ms ≫ 一刻度 ${ONE_STEP.toFixed(1)}ms）· 同一刻度像素 ${dB.worst.toFixed(2)}px 偏差 —— 这正是 M1 单独看不见的另一半`);

// ---- 存档两段式解码：脏样本喂进 js/store.js 原件，一条坏记录不许把整份档带跑 ----
const samples = [
  ['原文不是 JSON', '{not json'],
  ['空对象', '{}'],
  ['整个档是 null', 'null'],
  ['settings 是数字、totals 是数组、best 是字符串', '{"settings":5,"totals":[1,2],"best":"nope"}'],
  ['好坏记录混在一张表里', '{"best":{"novice":{"ms":"快","hints":-3},"skilled":{"ms":1200,"hints":0,"moves":2,"size":"7×7"}},"totals":{"solved":-9,"hints":3,"ms":4000}}'],
  ['resume 缺 ink', '{"resume":{"seed":"s","tier":"novice","cells":25,"moves":1,"hints":0,"elapsedMs":900}}'],
  ['resume 的 ink 长度对不上盘面', '{"resume":{"seed":"s","tier":"novice","cells":25,"ink":[1,4,2,3],"moves":1,"hints":0,"elapsedMs":900}}'],
  ['resume 的格值出界（3 不是数墙的颜色）', '{"resume":{"seed":"s","tier":"novice","cells":4,"ink":[3,4],"moves":1,"hints":0,"elapsedMs":900}}'],
  ['resume 字段类型错（cells 是字符串）', '{"resume":{"seed":"s","tier":"novice","cells":"25","ink":[0,25],"moves":1,"hints":0,"elapsedMs":900}}'],
  ['resume 的用时是负数', '{"resume":{"seed":"s","tier":"novice","cells":25,"ink":[0,25],"moves":1,"hints":0,"elapsedMs":-900}}'],
];
const putRaw = (raw) => {
  globalThis.localStorage = {
    _m: { 'nurikabe.save.v1': raw },
    getItem(k) { return k in this._m ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
  };
};
for (const [name, raw] of samples) {
  putRaw(raw);
  let err = null, sound = null, resume = null, solved = null, settings = null;
  try {
    const m = await import(`${pathToFileURL(`${REPO}/js/store.js`).href}?s=${encodeURIComponent(name)}`);
    sound = m.Store.setting('sound');
    resume = m.Store.resume();
    solved = m.Store.data.totals.solved;
    settings = typeof m.Store.data.settings;
  } catch (e) {
    err = e.message;
  }
  line(`脏档样本：${name}`, !err && settings === 'object' && sound === true && resume === null && solved === 0,
    err ? `抛了 ${err}` : `settings.sound=${sound} resume=${JSON.stringify(resume)} totals.solved=${solved}`);
}
putRaw(samples[4][1]);
const keep = await import(`${pathToFileURL(`${REPO}/js/store.js`).href}?s=keep`);
line('坏记录里的好记录活下来了（两段式：先 parse 整份，再逐条查形状）',
  keep.Store.best('skilled').ms === 1200 && keep.Store.data.best.novice === undefined && keep.Store.data.totals.hints === 3,
  `skilled.ms=${keep.Store.best('skilled').ms} · novice=${JSON.stringify(keep.Store.data.best.novice)} · totals.hints=${keep.Store.data.totals.hints}（solved 出界归 0）`);

console.log(`\n结论：${rows.every(Boolean) ? '全绿' : '有红'} · ${rows.length} 条读数 · M1 ratio ${ratio.toFixed(4)}（阈值 ${RATIO_MAX}）· M2 误差 ${simErr.toFixed(2)}ms · 阴性对照 A ratio ${(dA.worst / STEP_PX).toFixed(2)}（红）· B 时间误差 ${bErr.toFixed(0)}ms（红）`);
