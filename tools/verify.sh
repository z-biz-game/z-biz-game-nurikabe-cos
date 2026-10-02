#!/usr/bin/env bash
# One-shot browser verification: real headless Chrome, real DOM, real canvas pixels, real
# localStorage — in BOTH URL shapes this app is ever served in:
#
#   ① root    http://127.0.0.1:5311/                             (server.cjs: repo = document root)
#   ② prefix  http://127.0.0.1:5398/z-biz-game-nurikabe-cos/     (the GitHub Pages shape of
#                                                                 https://z-biz-game.github.io/z-biz-game-nurikabe-cos/)
#
#   bash tools/verify.sh                       # both shapes, all scenarios
#   SHAPES=root bash tools/verify.sh           # one shape while editing
#   SCENARIOS="first zero" bash tools/verify.sh
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-nurikabe-cos/ bash tools/verify.sh
#                                              # the deployed artifact: one shape, nothing started
#
# Why the prefix shape is a separate run and not a footnote: root is the only shape a local server
# can fake by accident. A page-level `/js/...` specifier resolves fine when the repo *is* the
# document root and 404s under /<repo>/ — and a dynamic import that throws takes the rest of the
# injected script down with it, so a deployed site silently runs a fraction of the assertions. A
# gate that only ever saw the root shape cannot tell those two apart. tools/scenarios.js:208 那句
# mod() 特意按 document.baseURI 解析，正是因为这个；只有前缀这一跑能看见它有没有解错。
#
# 端口是这一仓的，不是家族的公共汽车：5311（HTTP）/ 9361（CDP）见 tools/playtest.cjs:3-4，
# 前缀形态用 5398 —— 见 tools/playtest.cjs:17（5392 tapa、5396 kakuro、5397 kenken 已占用）。
# 换端口要同时改那里的注释，否则下一个人抄到的是一张已经被别人坐下的桌子。
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates every core and, with no CDP client attached, Chrome will not exit
# on its own. Canvas pixels are half the point of this file — a fake rasteriser makes them lie.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(basename "$HERE")                     # the Pages path segment, same as the repo slug
FEATURE=数墙                                  # this app's own word: proof the bytes are ours
CDP_WANT=${CDP_PORT:-9361}
HTTP_WANT=${HTTP_PORT:-5311}
PREF_WANT=${PREFIX_PORT:-5398}
CHROME=${CHROME_BIN:-}
# tools/scenarios.js:1226 里已注册的场景（顺序有讲究：save→resume 是跨刷新配对，narrow 用 500×780）
SCENARIOS_DONE="first zero hint conflict save resume daily layout narrow"
# narrow 那条场景逐字断言 innerWidth,innerHeight === '500,780'（tools/scenarios.js:1187），
# 靠的是 playtest.cjs 的 VIEWPORT —— 它在第一次导航**之前**下 Emulation.setDeviceMetricsOverride。
# 每一段都显式带上视口，包括默认那一档：override 是挂在 target 上的，不清就等于留给下一段，
# 于是 SCENARIOS="narrow first" 这种手工顺序会拿着一张 500px 的盘去断言 1280px 的几何。
VP_DEFAULT=${VIEWPORT_DEFAULT:-1280x1024}
VP_NARROW=${VIEWPORT_NARROW:-500x780}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
command -v python3 >/dev/null 2>&1 || { echo "需要 python3（前缀形态的静态服务器 + 结果解析）" >&2; exit 2; }
{ command -v "$CHROME" >/dev/null 2>&1 || [ -x "$CHROME" ]; } || {
  echo "no Chrome found — 试过的路径：" >&2
  echo "  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >&2
  echo "  /Applications/Chromium.app/Contents/MacOS/Chromium" >&2
  echo "  google-chrome / chromium / chromium-browser (PATH)" >&2
  echo "  或者 CHROME_BIN=/path/to/chrome bash tools/verify.sh" >&2
  exit 2; }

# 日志与夹具落点：不写 /tmp —— 这一台机器上有别的 agent 同时在跑 Chrome，/tmp 里的前缀文件名
# 会互相踩；而且工具链会在会话中途清 /tmp，一份消失的日志会被读成一次"没有断言"的假绿。
# 默认落在 $TMPDIR（macOS 上是每用户私有的 /var/folders/...，Linux runner 上退到 /tmp），
# 手工跑的时候用 VERIFY_LOG_DIR= 指到工作区里那堆 _tmp-nurikabe-* 旁边，方便逐条引用。
LOGDIR=${VERIFY_LOG_DIR:-"${TMPDIR:-/tmp}/nurikabe-verify"}
mkdir -p "$LOGDIR" || { echo "日志目录 $LOGDIR 建不起来" >&2; exit 2; }
rm -f "$LOGDIR"/root-*.tally "$LOGDIR"/prefix-*.tally "$LOGDIR"/custom-*.tally 2>/dev/null

# ---- ports ---------------------------------------------------------------------------------------
# 5311 / 5398 / 9361 belong to nurikabe and to nothing else in the family. A long-lived server on
# one of them happily serves a *different* app — or this same app out of an orphaned checkout, which
# a content pre-flight cannot always catch. So: never borrow a bound socket, take the next free one
# and say out loud which one was taken by whom. Nothing here kills a process it did not start:
# 这台机器上此刻还坐着 9353/9358/9365/9373 与 5315/5392/5396/5481 的浏览器，一个都不许碰。
occupied() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }
squatters() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' '; }
first_free() {
  local base=$1 p
  for p in "$base" $((base + 100)) $((base + 200)) $((base + 300)); do
    if occupied "$p"; then
      echo "  端口 $p 已被别的进程听着（pid: $(squatters "$p")）——不借它的 socket，换下一个" >&2
    else
      echo "$p"; return 0
    fi
  done
  return 1
}

CUSTOM=0
[ -n "${BASE_URL:-}" ] && CUSTOM=1

if [ "$CUSTOM" = 0 ]; then
  CDP=$(first_free "$CDP_WANT") || { echo "no free devtools port near $CDP_WANT" >&2; exit 2; }
  HTTP=$(first_free "$HTTP_WANT") || { echo "no free http port near $HTTP_WANT" >&2; exit 2; }
  PREF=$(first_free "$PREF_WANT") || { echo "no free http port near $PREF_WANT" >&2; exit 2; }
  echo "ports: CDP $CDP (want $CDP_WANT) · root http $HTTP (want $HTTP_WANT) · prefix http $PREF (want $PREF_WANT)"
  echo "  两种形态各用一个端口：origin 不同 → localStorage 各一套，前缀那一跑才是"换了文档目录"，不是"重装一遍""
else
  CDP=${CDP_PORT:-9361}
  echo "BASE_URL given → 只跑部署件这一种形态，本脚本不起任何服务（CDP $CDP）"
fi
echo "logs: $LOGDIR"

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP --user-data-dir=$UDD \
  --window-size=1280,1024 --no-first-run --no-default-browser-check about:blank \
  >"$LOGDIR/chrome.log" 2>&1 &
CPID=$!
SPID=0
PSPID=0
PROOT=""
cleanup() {
  # 只杀自己起的那三个 pid。别的 agent 的 Chrome / 服务器一律不动。
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$PSPID" != 0 ] && kill $PSPID 2>/dev/null
  kill -9 $CPID 2>/dev/null
  [ -n "$PROOT" ] && rm -rf "$PROOT"
  return 0
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits this script's stdout, and
# inside a pipeline it would hold the write end open long after the tests finished.
( sleep ${WD_TIMEOUT:-1500}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
for i in $(seq 1 120); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP (see $LOGDIR/chrome.log)" >&2; exit 3; }

cd "$HERE"

FAILED=0
# 该交回几段结果，是注册表决定的，不是"跑完了就算"决定的。
WANT_N=$(echo ${SCENARIOS:-$SCENARIOS_DONE} | wc -w | tr -d ' ')

# ---- the node side of the seed pin ---------------------------------------------------------------
# tools/scenarios.js 里 >>>FIXTURE…<<<FIXTURE 那 9 行是**手抄**的盘面指纹（题面 clue、逐格解 sol、
# 分数/步数/扫描轮/穷举节点数）。Chrome 那一侧逐格复现它们；但如果 node 这一侧已经不再产出同样的
# 指纹，这份"逐格一致"就是在跟自己的上一版对表。所以每次运行都从页面 import 的同一批 js/engine
# 模块把 9 行重算一遍：夹具是 node 的出货，不是 Chrome 的。
# 取最后一次 // >>>FIXTURE：文件头第 15 行的散文里也写着这个串，第一次命中的是那句话。
echo "=== node re-derives the seed fixture pinned in tools/scenarios.js ==="
node --input-type=module --no-warnings -e "$(cat <<'NODEFIX'
import { readFileSync } from 'node:fs';
import { makePuzzle, TIERS } from './js/ui/game.js';
import { solve } from './js/engine/nurikabe.js';
import { dailySeed } from './js/engine/rng.js';

const src = readFileSync('tools/scenarios.js', 'utf8');
const at = src.lastIndexOf('// >>>FIXTURE');
const end = src.indexOf('// <<<FIXTURE', at);
if (at < 0 || end < 0) {
  console.log('  scenarios.js 里没有 // >>>FIXTURE … // <<<FIXTURE 这一段：跨引擎那一钉没东西可对');
  process.exit(1);
}
const body = src.slice(at, end);
// 夹具是 JS 对象字面量（裸键名 + 单引号），不是 JSON：这一段是本仓自己的受信源码，直接 eval。
const want = eval(body.slice(body.indexOf('['), body.lastIndexOf(']') + 1));
if (!Array.isArray(want) || !want.length) {
  console.log('  FIXTURE 解析出来是空的：0 行的夹具钉不住任何东西');
  process.exit(1);
}

// 重算口径逐字抄 scenarios.js:16-18 那句注释：makePuzzle(seed, tier) 与
// makePuzzle(dailySeed(dateKey), TIERS[dayIndex % 5].key)，sol = solve(board).cell 逐格。
let bad = 0;
for (const row of want) {
  const seed = row.kind === 'daily' ? dailySeed(row.date) : row.seed;
  const tier = row.kind === 'daily' ? TIERS[row.dayIndex % TIERS.length].key : row.tier;
  const p = makePuzzle(seed, tier);
  if (!p || !p.ok) {
    bad++;
    console.log(`  FAIL ${row.seed}: node 这一侧出不了盘（${p && p.reason}）—— 浏览器里的期望值已无源可追`);
    continue;
  }
  const cell = solve(p.board).cell;
  const got = {
    tier: p.tier, w: p.w, h: p.h, clues: p.clues, score: p.score, steps: p.steps,
    sweeps: p.sweeps, nodes: p.cross.nodes,
    clue: Array.from(p.clue).join(','), sol: Array.from(cell).join(''),
  };
  const diff = Object.keys(got).filter((k) => String(got[k]) !== String(row[k]));
  if (diff.length) {
    bad++;
    console.log(`  FAIL ${row.seed} node 重算与夹具不符: ${diff.map((k) => `${k} ${row[k]}→${got[k]}`).join(' / ')}`);
  }
}
console.log(`  ${want.length - bad}/${want.length} 条 seed 指纹仍由 node 原样重算出来`);
process.exit(bad ? 1 : 0);
NODEFIX
)" || FAILED=1

# ---- the machine-readable RESULT line ------------------------------------------------------------
# playtest.cjs 把 RESULT 打在 stdout 的最后一行、console 噪音留在 stderr。这里不数行数就
# 不叫跑过：一条断言都没发生的场景（页面启动失败、import 404、场景被改名）会以"0 failed"
# 的样子绿过去，所以空 rows / 解析不出来 / 拿不到 RESULT 一律 exit 1，并把条数写进 tally
# 让上面那一层去核对"该报 9 段是不是只报了 8 段"。
PARSE=$(cat <<'PARSER'
import sys, json
shape, scn, tally, clog = sys.argv[1:5]
raw = sys.stdin.read().strip()
# playtest.cjs:185 那一行的前缀是协议的一部分，摘掉才是 JSON。
if raw.startswith('RESULT '):
    raw = raw[len('RESULT '):]
if not raw:
    print('  NO RESULT —— playtest.cjs 什么都没回（见 %s）' % clog); sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
rows = d.get('rows')
if rows is None:
    print('  NO RESULT FIELD —— 回的东西不是闸的口径:', str(d)[:300]); sys.exit(1)
if not rows:
    print('  NO CHECKS RUN —— 一条都不断言的场景没有资格是绿的'); sys.exit(1)
for r in rows:
    if not r['pass']:
        print('  FAIL %-56s %s' % (r['test'], r['detail']))
fail = int(d.get('fail', 0))
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
with open(tally, 'w') as f:
    f.write('%d %d\n' % (len(rows), fail))
print('  %d checks, %d failed  %s' % (len(rows), fail, extra if extra else ''))
sys.exit(1 if fail else 0)
PARSER
)

# ---- pre-flight: the bytes about to be tested are 数墙 itself -------------------------------------
# A server on the wrong port serving *some* index.html is the failure this gate exists to catch,
# and "the page loaded" is not enough: a static host that answers 200 with the shell for every
# path (SPA fallback, a directory listing, an orphan checkout) still lets the scenario run — it
# just lets it run against fewer files. So each module path is asserted to come back 200 *and*
# with exactly the byte count that is on disk. A missing file must be loud and early, never a
# quietly reduced assertion count.
preflight() {
  local base=$1 rel want got f
  local served
  served=$(curl -fsS -m 8 "$base" 2>/dev/null) || { echo "  首页取不到：$base" >&2; return 1; }
  case "$served" in *js/main.js*) ;; *) echo "  $base 上发的不是本仓的首页（正文里找不到 js/main.js）" >&2; return 1 ;; esac
  case "$served" in *"$FEATURE"*) ;; *) echo "  $base 在发别的应用：首页正文里找不到「$FEATURE」" >&2; return 1 ;; esac
  for rel in js/main.js js/ui/game.js js/engine/nurikabe.js js/engine/count.js css/game.css; do
    want=$(wc -c < "$HERE/$rel" | tr -d ' ')
    [ -n "$want" ] || { echo "  $rel 在磁盘上读不到，闸没有可对的基准" >&2; return 1; }
    f="$LOGDIR/preflight-$(echo "$rel" | tr '/' '_')"
    got=$(curl -sS -m 8 -o "$f" -w '%{http_code} %{size_download}' "$base$rel" 2>/dev/null) || {
      echo "  $rel 取不回来：$base$rel" >&2; return 1; }
    case "$got" in "200 $want") ;; *)
      echo "  $rel 不对味：$base$rel 回 $got，磁盘上的这份是 200 $want 字节" >&2
      echo "  前两行到手内容：$(head -c 160 "$f" | tr '\n' ' ')" >&2
      return 1 ;; esac
  done
  echo "  前缀/根 预检：首页含「$FEATURE」与 js/main.js · 5 条真实模块路径按字节对上磁盘（main / ui/game / engine/nurikabe / engine/count / css/game）"
  return 0
}

# ---- one shape -----------------------------------------------------------------------------------
run_shape() {
  local shape=$1
  local base s vp tally clog
  local n m reported=0 checks=0 fails=0 bad=0
  local t0 t1
  t0=$SECONDS
  SPID=0
  PSPID=0
  PROOT=""
  if [ "$CUSTOM" = 1 ]; then
    base=$BASE_URL
  elif [ "$shape" = root ]; then
    base="http://127.0.0.1:$HTTP/"
    node "$HERE/server.cjs" "$HTTP" >"$LOGDIR/$shape-server.log" 2>&1 &
    SPID=$!
  else
    # Pages shape: the repo lives under one path segment, served by a static file server whose root
    # is a directory that only *contains* a symlink to it. Nothing is copied or rewritten — that is
    # the point: a hard-coded `/js/...` has nowhere to hide in that shape.
    base="http://127.0.0.1:$PREF/$REPO/"
    PROOT=$(mktemp -d)
    ln -s "$HERE" "$PROOT/$REPO" || { echo "软链 $PROOT/$REPO 建不起来" >&2; return 1; }
    python3 -m http.server "$PREF" --bind 127.0.0.1 --directory "$PROOT" >"$LOGDIR/$shape-server.log" 2>&1 &
    PSPID=$!
  fi
  BASE=$base
  if [ "$CUSTOM" = 0 ]; then
    for i in $(seq 1 40); do
      curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
      sleep 0.25
    done
  fi
  echo
  echo "################ shape=$shape  base=$BASE  (CDP :$CDP)"
  preflight "$BASE" || return 2

  export CDP_PORT=$CDP
  export BASE_URL=$BASE
  VIEWPORT=$VP_DEFAULT node tools/playtest.cjs open "$BASE" | head -5

  local boot=""
  for i in $(seq 1 60); do
    boot=$(VIEWPORT=$VP_DEFAULT node tools/playtest.cjs eval "window.nurikabe?window.nurikabe.version:'nope'" nonav 2>/dev/null | tr -d '\n" ')
    case "$boot" in *nope*|"") sleep 0.5 ;; *) break ;; esac
  done
  echo "boot: nurikabe $boot at $BASE"
  if [ "$boot" = "nope" ] || [ -z "$boot" ]; then echo "window.nurikabe never appeared at $BASE" >&2; return 4; fi

  # 默认跑已注册的那一组（每往 tools/scenarios.js 里加一组场景就把名字加进来）：`npm run verify`
  # 在任何一次提交上都必须是绿的，所以还没写完的名字不放进默认列表，只放 SCENARIOS= 里手工跑。
  for s in ${SCENARIOS:-$SCENARIOS_DONE}; do
    vp=$VP_DEFAULT
    [ "$s" = narrow ] && vp=$VP_NARROW
    tally="$LOGDIR/$shape-$s.tally"
    clog="$LOGDIR/$shape-$s.console.log"
    rm -f "$tally"
    echo "=== [$shape] $s (viewport $vp) ==="
    VIEWPORT=$vp node tools/playtest.cjs scenario "$s" 2>"$clog" | tail -1 \
      | python3 -c "$PARSE" "$shape" "$s" "$tally" "$clog" || bad=1
    if [ -s "$tally" ]; then
      read -r n m < "$tally"
      reported=$((reported + 1))
      checks=$((checks + n))
      fails=$((fails + m))
    else
      bad=1
      echo "  没有 tally：$s 这一跑连条数都没交出来，不能算跑过"
    fi
    if [ -s "$clog" ]; then
      echo "  --- console (tail 12) $clog ---"
      sed 's/^/  /' "$clog" | tail -12
    fi
  done

  t1=$((SECONDS - t0))
  echo "---- shape=$shape 汇总: $reported/$WANT_N scenarios reported · $checks checks · $fails failed · ${t1}s ----"
  if [ "$reported" != "$WANT_N" ]; then
    echo "  少了一段场景交回结果：注册表要 $WANT_N 段，只收到 $reported 段 —— 悄悄少跑不能算绿" >&2
    bad=1
  fi
  [ "$bad" = 0 ] || FAILED=1
  return $bad
}

# ---- 逻辑闸（先跑、不开浏览器）：文档数字必须等于代码/现跑读数；台账刀必须逼红再复原 ----
# doctest / sabotage 与 CI 的 check job 跑的是同两条命令，本地绿 == CI 绿；任何一条红都在这里把
# 整个 verify 拉红（FAILED 汇总到结尾的 exit $FAILED）。放在浏览器循环之前，逻辑坏了不用等 Chrome。
echo "=== 逻辑闸 tools/doctest.mjs（文档 == 代码 / balance / engine-test 现跑）==="
node tools/doctest.mjs || { echo "  doctest 红：文档里有数字不等于代码或闸的现跑值" >&2; FAILED=1; }
echo "=== 逻辑闸 tools/sabotage.mjs（破坏试验台账：每一类谎都要把对应断言逼红）==="
node tools/sabotage.mjs || { echo "  sabotage 红：某一类破坏没能把对应断言逼到失败" >&2; FAILED=1; }

SHAPE_LIST="root prefix"
[ "$CUSTOM" = 1 ] && SHAPE_LIST=custom
for shape in ${SHAPES:-$SHAPE_LIST}; do
  run_shape "$shape" || FAILED=1
  # each shape gets its own servers; tear this one down before the next
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$PSPID" != 0 ] && kill $PSPID 2>/dev/null
  [ -n "$PROOT" ] && rm -rf "$PROOT"
  SPID=0
  PSPID=0
  PROOT=""
done

kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN（两种 URL 形态的全部场景）===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
