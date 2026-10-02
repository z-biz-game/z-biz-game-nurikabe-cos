// PWA 的接线：注册 service worker、接住安装提示、把"能不能装"如实报给界面。
//
// 三条实测过的边界，都写在这里而不是散进 main.js：
//   1. file://（Electron 直接开、或者把 dist 拷进 U 盘双击）下 navigator.serviceWorker
//      要么不存在要么 register 必抛 —— 整段跳过，且**不留下未捕获的 rejection**：
//      浏览器闸把 window.onerror 与 unhandledrejection 都记成失败。
//   2. 相对路径一律照 document.baseURI 解：Pages 把本仓挂在 /z-biz-game-nurikabe-cos/ 下，
//      写死 '/sw.js' 在那种形态里是 404，而 404 的 sw.js 会让整站静默地没有离线能力。
//   3. 注册失败不影响玩：这里只 console.warn 一次，界面把安装按钮收起来。

const SUPPORTED = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);

let deferred = null; // beforeinstallprompt 事件：Chrome 不给这个事件就没有"装到桌面"这条路

export const PWA = {
  version: 'nurikabe-v1.0.0',

  /** 注册 sw.js。返回 Promise<{ok, reason}> —— 任何失败都是**结果**，不是异常。 */
  async register() {
    if (typeof document === 'undefined') return { ok: false, reason: '没有 document' };
    if (!SUPPORTED()) return { ok: false, reason: `${location.protocol} 下不注册 service worker` };
    try {
      const url = new URL('sw.js', document.baseURI).href;
      const reg = await navigator.serviceWorker.register(url, { scope: new URL('./', document.baseURI).href });
      return { ok: true, scope: reg.scope, updating: false };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  },

  /** 装机提示：Chrome 只在"可安装且用户还没装"时发这个事件，所以它自己就是判据。 */
  watchPrompt() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      deferred = ev;
      if (typeof PWA.onPrompt === 'function') PWA.onPrompt(true);
    });
    window.addEventListener('appinstalled', () => {
      deferred = null;
      if (typeof PWA.onPrompt === 'function') PWA.onPrompt(false);
    });
  },

  canInstall: () => !!deferred,

  /** 用户点了"安装"：拿不到提示事件时如实回 false，界面退回普通网页态就好。 */
  async install() {
    if (!deferred) return false;
    const ev = deferred;
    deferred = null;
    ev.prompt();
    const choice = await ev.userChoice.catch(() => null);
    return !!choice && choice.outcome === 'accepted';
  },

  /** 现在是不是已经跑在独立窗口里（装完从桌面打开就是这个态）。 */
  isStandalone: () =>
    typeof matchMedia === 'function' &&
    (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches),
};
