// 数墙 · 确定性随机数
//
// 出题、日课、验证台全部走这里，绝不碰 Math.random —— 同一个 seed 必须永远长出同一块盘，
// 否则"日课"会在第二天变成另一道题，bake 的 --check 也无从谈起。
//
// 用的是 mulberry32：32 位状态、一步一个数，够小够快，浏览器和 Node 里逐位一致（只有 Math.imul
// 参与，没有浮点乘法，跨引擎不会漂）。

/** 字符串 → 32 位种子（FNV-1a）。日课用它把日期变成种子。 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seedFrom(...parts) {
  return hashSeed(parts.join('|'));
}

/**
 * @param {number|string} seed 数字直接当种子；字符串走 hashSeed
 * @returns {{next: () => number, int: (n: number) => number, pick: (a: any[]) => any,
 *            shuffle: <T>(a: T[]) => T[], bool: (p?: number) => boolean, seed: number}}
 */
export function makeRng(seed) {
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n) % n;
  const rng = {
    next,
    int,
    seed: s,
    pick: (arr) => arr[int(arr.length)],
    bool: (p = 0.5) => next() < p,
    // Fisher-Yates：原地打乱并返回同一个数组
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
    // 再派生一个子种子：同一棵树上的随机流互不干扰，改一处不会把别处的题面全改了
    branch(tag) {
      return makeRng(`${s}:${tag}`);
    },
  };
  return rng;
}

/** 日课那一天的种子：2026-09-27 → 固定值，全球同一道题。 */
export function dailySeed(dateKey) {
  return hashSeed(`nurikabe.daily.${dateKey}`);
}
