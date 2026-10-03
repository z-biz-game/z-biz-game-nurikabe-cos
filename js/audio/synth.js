// 合成音，不带任何采样文件。益智游戏的音效是一种**状态读数**——
// "墙落下了"、"这一格和数字撞了"、"这个岛凑满了"——每一种都只是一条短包络，
// 所以用合成器既让产物零音频文件，也让词汇表诚实：说不出名字的声音就不该存在。

let ctx = null;
let master = null;
let enabled = true;
// 静音偏好：读回存档。放在模块顶层，这样每次 init（首屏、开局、重开）都拿到同一个答案，
// 重开一局不会把玩家的静音选择洗掉。
try {
  if (localStorage.getItem('cos.mute') === '1') enabled = false;
} catch { /* 读不到就沿用默认开声 */ }


function audio() {
  // 静音态第一行就返回：既不把已挂起的 ctx 拉起来，也不新建节点。
  // 这条比 "gain 设 0" 强一档——静音时这个 AudioContext 根本没有在跑。
  if (!enabled) return null;
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return null;
  if (!ctx) {
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 一个振荡器 + 两点音高滑移 + 指数衰减。下面所有声音都是对它的一次调用：
// 加第二种"声部形状"就是这么让一个游戏长出不属于同一件乐器的声音的。
function tone({ f0, f1 = f0, dur = 0.12, type = 'sine', gain = 0.22, delay = 0 }) {
  const ac = audio();
  if (!ac || !enabled) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(vol).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const Sound = {
  setEnabled(v) {
    const on = !!v;
    if (on === enabled) return;
    enabled = on;
    // 真静音：停掉 AudioContext 本身（时钟停、图不跑），不是把音量拧到 0。
    if (ctx) {
      if (on) {
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      } else if (ctx.state === 'running' && ctx.suspend) {
        ctx.suspend().catch(() => {});
      }
    }
    // 偏好落盘：刷新页面后 init 要能读回静音态，不能自己弹回来。
    try {
      localStorage.setItem('cos.mute', on ? '1' : '0');
    } catch { /* 隐私模式下写不进去也不该炸游戏 */ }
  },
  enabled: () => enabled,

  // 墙落下去：低、闷，像把一块石板按平。
  wall() {
    tone({ f0: 300, f1: 190, dur: 0.13, type: 'triangle', gain: 0.19 });
  },
  // 岛落下去：高、轻，和墙是两个方向的反馈，玩家不看屏幕也知道落的哪一种。
  land() {
    tone({ f0: 640, f1: 900, dur: 0.12, type: 'sine', gain: 0.17 });
  },
  erase() {
    tone({ f0: 240, f1: 180, dur: 0.08, type: 'sine', gain: 0.1 });
  },
  undo() {
    tone({ f0: 420, f1: 300, dur: 0.11, type: 'triangle', gain: 0.13 });
  },
  // 两个失谐的声部：一个故意不好听的音程，留给唯一需要"不看屏幕也要注意到"的事。
  conflict() {
    tone({ f0: 200, f1: 150, dur: 0.16, type: 'sawtooth', gain: 0.11 });
    tone({ f0: 214, f1: 158, dur: 0.16, type: 'sawtooth', gain: 0.09, delay: 0.01 });
  },
  hint() {
    tone({ f0: 760, f1: 1020, dur: 0.16, type: 'sine', gain: 0.16 });
    tone({ f0: 1140, dur: 0.1, type: 'sine', gain: 0.07, delay: 0.06 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 0.26, type: 'triangle', gain: 0.17, delay: i * 0.09 }));
  },
};
