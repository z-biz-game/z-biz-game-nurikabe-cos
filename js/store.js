// 存档。所有东西住在**一个 key** 里，所以"清盘"是一行；而一局进行中的局面存的是
// （原点 seed、档位、已经落下的墨、这一局已经花了多少），不是线索表也不是答案 ——
// 生成器是确定性的，盘面从来不需要穿过存储旅行，一个 10×10 的存档也就一两百字节。
//
// 数墙的墨只有三种取值（0 未定 / 1 白岛 / 2 黑墙），而且开局大半盘面都是 0，
// 所以游程编码（RLE）刚好：不用偏移，也不必担心负数。

const KEY = 'nurikabe.save.v1';

const defaults = () => ({
  settings: { sound: true, reduceMotion: false },
  best: {},
  resume: null,
  totals: { solved: 0, hints: 0, ms: 0 },
});

function rleEncode(board) {
  const out = [];
  if (!board.length) return out;
  let run = board[0];
  let n = 1;
  for (let i = 1; i < board.length; i++) {
    if (board[i] === run && n < 255) n++;
    else {
      out.push(run, n);
      run = board[i];
      n = 1;
    }
  }
  out.push(run, n);
  return out;
}

function rleDecode(pairs, len) {
  const b = new Uint8Array(len);
  let i = 0;
  for (let p = 0; p + 1 < pairs.length; p += 2) {
    const v = pairs[p];
    const n = pairs[p + 1];
    if (!Number.isInteger(v) || !Number.isInteger(n) || n <= 0 || v < 0 || v > 255) return null;
    for (let k = 0; k < n && i < len; k++) b[i++] = v;
  }
  if (i !== len) return null; // 长度对不上就是脏数据，别补一半当作能继续的局
  return b;
}

// localStorage 在 Safari 隐私模式 / 配额满的时候会**抛**，所以每次读写都各包一层。
// 读的时候抛：当作没有存档（游戏照样能玩，只是忘事）；写的时候抛：静默丢掉这一次写。
function readRaw() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRaw(text) {
  try {
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

function dropRaw() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 抛不出来才叫读不到，读不到就没有可清的 */
  }
}

// resume 的形状是外部数据，什么都可能躺在里面（旧版本、手改过的、写坏一半的）。
// 校验放在这里，而不是让 UI 去猜：任何一处不合法就 return null，界面当成没有可继续的局。
function shapeOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.seed !== 'string' && typeof raw.seed !== 'number') return null;
  if (typeof raw.tier !== 'string') return null;
  if (!Number.isInteger(raw.cells) || raw.cells <= 0 || raw.cells > 400) return null;
  if (!Array.isArray(raw.ink) || raw.ink.length % 2 !== 0) return null;
  if (!Number.isInteger(raw.moves) || raw.moves < 0 || !Number.isInteger(raw.hints) || raw.hints < 0) return null;
  if (!Number.isInteger(raw.elapsedMs) || raw.elapsedMs < 0) return null;
  const board = rleDecode(raw.ink, raw.cells);
  if (!board) return null;
  return { ...raw, board };
}

function sanitize(parsed) {
  const base = defaults();
  const settings = { ...base.settings, ...(parsed.settings || {}) };
  settings.sound = settings.sound !== false;
  settings.reduceMotion = !!settings.reduceMotion;
  const best = {};
  for (const [k, v] of Object.entries(parsed.best || {})) {
    if (v && Number.isInteger(v.ms) && Number.isInteger(v.hints) && Number.isInteger(v.moves)) best[k] = v;
  }
  const t = parsed.totals || {};
  const totals = {
    solved: Number.isInteger(t.solved) && t.solved >= 0 ? t.solved : 0,
    hints: Number.isInteger(t.hints) && t.hints >= 0 ? t.hints : 0,
    ms: Number.isInteger(t.ms) && t.ms >= 0 ? t.ms : 0,
  };
  return { settings, best, totals, resume: parsed.resume && shapeOf(parsed.resume) ? { ...parsed.resume } : null };
}

function load() {
  const raw = readRaw();
  if (!raw) return defaults();
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

export { KEY, rleEncode, rleDecode, defaults };

export const Store = {
  data: load(),

  save() {
    writeRaw(JSON.stringify(this.data));
  },

  setting(name) {
    return this.data.settings[name];
  },
  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  },

  best(tier) {
    return this.data.best[tier] || null;
  },
  // 纪录先比"求了几次人"：一条纪录的意思得是"这盘是我自己想出来的"，
  // 靠六个提示堆出来的快局不算。
  recordBest(tier, { ms, hints, moves, size }) {
    const cur = this.data.best[tier];
    const better =
      !cur ||
      hints < cur.hints ||
      (hints === cur.hints && (moves < cur.moves || (moves === cur.moves && ms < cur.ms)));
    if (better) this.data.best[tier] = { ms, hints, moves, size, at: Date.now() };
    this.save();
    return better;
  },

  recordSolve(ms, hints) {
    const t = this.data.totals;
    t.solved++;
    t.hints += hints;
    t.ms += ms;
    this.save();
  },

  totals() {
    return { ...this.data.totals };
  },

  saveResume(puzzle, state, elapsedMs, run) {
    this.data.resume = {
      // 生成器会把手上的 seed 再派生一层内部 seed，所以续档必须存**原点** seed，
      // 否则重建出来的盘面不是同一盘。
      seed: puzzle.originSeed || puzzle.seed,
      tier: puzzle.tier,
      elapsedMs,
      cells: puzzle.w * puzzle.h,
      ink: rleEncode(state),
      // 这一局的代价跟着盘面一起走：不存的话，玩家吃六个提示、关掉标签页、回来推完，
      // 就能拿一条"提示 0"的纪录 —— 而决定纪录的正是这个数。
      moves: run.moves,
      hints: run.hints,
      at: Date.now(),
    };
    this.save();
  },

  // 唯一的出口：界面拿到的 board 一定是解过码的 Uint8Array，或者整个是 null。
  // 两条读法（resume() 与 data.resume）如果各读各的，就会出现"卡片说有一局、盘面是空的"。
  resume() {
    return shapeOf(this.data.resume);
  },

  clearResume() {
    this.data.resume = null;
    this.save();
  },

  // 真清盘：内存里换回默认值，localStorage 里那个 key 也删掉。
  // 只改内存不删 key，下一次刷新就会把刚"清掉"的纪录读回来。
  reset() {
    this.data = defaults();
    dropRaw();
  },
};
