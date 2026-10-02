// 数墙（Nurikabe）的离线壳。**网络优先**，缓存只是断网时的退路。
//
// 为什么不是 cache-first：本仓出货的是**未打包的 ES 模块**（index.html 直接引 js/main.js，
// 没有构建步骤）。手工 VERSION 号 + cache-first 会把 js/css 永久钉死在第一次缓存的那一版，
// 于是发新 HTML 配旧 JS —— 玩家拿到的是一个从没被任何测试跑过的组合，而且它看起来是绿的。
// 同源子资源一律"先网络、失败退缓存"；导航请求额外允许用缓存里的 index.html 兜断网。
//
// sw.js 自己不进缓存：缓存了自己的那一份，下一次更新就再也取不回来了。

const VERSION = 'nurikabe-v1.0.0';
const RUNTIME = VERSION + '-runtime';
const SHELL = ['./', './index.html', './css/game.css', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (ev) => {
  // 预取失败不算安装失败：断网装、部分文件 404，都不该把这一版 SW 卡死在 installed。
  ev.waitUntil(
    caches
      .open(RUNTIME)
      .then((cache) => Promise.allSettled(SHELL.map((rel) => cache.add(new URL(rel, self.location).href))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nurikabe-') && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // 不接管第三方：本仓零外链，出现就是被注入了
  if (url.pathname.endsWith('/sw.js')) return;
  ev.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  let netError = null;
  let res = null;
  try {
    res = await fetch(req);
  } catch (err) {
    netError = err;
  }
  if (res && res.ok) {
    const cache = await caches.open(RUNTIME);
    // 只留一份：先删同键旧条目再放新的，否则 ?source=pwa 这类变体会在缓存里堆成一座坟场。
    await cache.delete(req);
    cache.put(req, res.clone()).catch(() => {});
    return res;
  }
  const hit = await (await caches.open(RUNTIME)).match(req, { ignoreSearch: url.pathname === '/' });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const shell = await caches.match(new URL('./index.html', self.location).href);
    if (shell) return shell;
  }
  if (netError) throw netError;
  return res || Response.error();
}
