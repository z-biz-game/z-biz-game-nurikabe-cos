// 颜色、间距、动效的唯一来源：样式表通过 applyThemeVars() 读这些值，画布读的是同一批对象。
// 分成两份写迟早会变成"一条线一个颜色，四十个地方要改"，所以这里只有一份。

export const Palette = {
  bgTop: '#080B16',
  bgBottom: '#131A2E',
  surface: '#101627',
  surfaceLift: '#182036',
  line: '#243050',
  lineHeavy: '#3A4A72',
  ink: '#F2F5FB',
  inkDim: 'rgba(242,245,251,0.62)',
  inkFaint: 'rgba(242,245,251,0.34)',

  // 琥珀色是"玩家自己的手"：正在拖的那一格、提示刚点名的那一格、通关的横幅都借它，
  // 于是"这件事是你在做"读起来是同一个意思。
  accent: '#FFC85C',
  accentEdge: '#FFE3A6',
  accentSoft: 'rgba(255,200,92,0.14)',

  // 数墙的三态各占一个色相，不靠明度差别（夜里看手机时明度最不可靠）：
  // 墙是压到最暗的靛，岛是纸白，未定是面板底。
  wall: '#080C18',
  wallEdge: '#202C48',
  land: '#EDF2FA',
  landEdge: '#9BB0D2',
  landInk: '#0C1220',
  unknownCell: '#141C31',

  info: '#7BB8FF',
  pencilStrong: '#8FA6CC',
  pencil: 'rgba(242,245,251,0.30)',

  success: '#3DDC91',
  error: '#FF5C7A',
  warn: '#FFB05C',
  focus: 'rgba(123,184,255,0.16)',
  hint: '#7BB8FF',

  // 通关横幅底下那层纱。放在这里而不是样式表里：样式表一旦出现字面色号，
  // 画布和界面就会长成两个样子。
  veil: 'rgba(8,11,22,0.78)',
};

// 阴影只用这三层透明黑（组织规则 6）：出现第四层就得先把它归进某一层。
export const Shadow = {
  level1: '0 1px 2px rgba(0,0,0,0.1)',
  level2: '0 6px 16px rgba(0,0,0,0.2)',
  level3: '0 18px 44px rgba(0,0,0,0.3)',
};

export const Space = { page: 20, card: 16, inner: 12, gutter: 10 };
export const Radius = { card: 20, button: 12, chip: 8, cell: 6 };
export const Touch = { min: 44 };

export const Font = {
  title: "700 24px/1.25 -apple-system, 'SF Pro Display', system-ui, sans-serif",
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif",
};

// 时长守 150–350 ms 的纪律，再长就挡住下一次落子。
// spring 是 SwiftUI `.spring(response: 0.35, dampingFraction: 0.7)` 的等效曲线（轻微过冲）。
export const Motion = {
  tap: 150,
  base: 220,
  pop: 260,
  line: 300,
  win: 900,
  spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
  ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
};

export const Cell = { min: 26, max: 60, dotScale: 0.13, borderScale: 0.075 };

export function applyThemeVars() {
  const root = document.documentElement.style;
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  for (const [k, v] of Object.entries(Palette)) root.setProperty('--' + kebab(k), v);
  for (const [k, v] of Object.entries(Shadow)) root.setProperty('--shadow-' + k, v);
  for (const [k, v] of Object.entries(Space)) root.setProperty('--space-' + k, v + 'px');
  for (const [k, v] of Object.entries(Radius)) root.setProperty('--radius-' + k, v + 'px');
  root.setProperty('--touch-min', Touch.min + 'px');
  for (const [k, v] of Object.entries(Motion)) {
    if (typeof v === 'number') root.setProperty('--dur-' + kebab(k), v + 'ms');
    else root.setProperty('--ease-' + kebab(k), v);
  }
  root.setProperty('--font-mono', Font.mono);
  root.setProperty('--font-sans', Font.sans);
}

// 系统偏好是地板，游戏里的开关只能往上加：把"减少动效"设成关，不该被一个
// 设成"无偏好"的系统覆盖掉，反过来也不行。
let motionReduced = false;

export function setReduceMotion(v) {
  motionReduced = !!v;
}

export const systemPrefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const prefersReducedMotion = () => motionReduced || systemPrefersReducedMotion();
