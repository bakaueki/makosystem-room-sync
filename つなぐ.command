#!/bin/bash
# 相手のシステムと部屋をつなぐ（macOS）。中身は npm run room-sync と同じ。
#
# 「はじめる」とは別の窓で動かす。画面とブリッジは「はじめる」が、部屋の同期はこの窓が受け持つ。
# 両方が動いていないと、相手の投稿は写っても自分の AI が返事をしない。
#
# npm run ではなく node を直接呼ぶ。npm を挟むと Ctrl+C の時に npm 側の後始末の文が混ざり、
# 素人には「壊れた」ように見えるため。node の探し方は「はじめる」と揃えてある。

cd "$(dirname "$0")" || exit 1

# Finder からダブルクリックで起動すると PATH がほとんど空なので、定番の置き場所を足しておく
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 「はじめる」が Node を fnm で入れた人は、この窓でも同じ Node を使えるようにする
FNM="$HOME/.local/share/fnm/fnm"
if [ -x "$FNM" ]; then
  eval "$("$FNM" env --shell bash 2>/dev/null)" || true
  "$FNM" use --lts >/dev/null 2>&1 || true
fi

wait_key() {
  printf '\n  何かキーを押すと、この窓が閉じます。\n'
  read -r -n 1 -s _ || true
}

stop() {
  printf '\n✖ %s\n\n' "$1"
  [ -n "${2:-}" ] && printf '  %s\n' "$2"
  wait_key
  exit 1
}

printf '========================================\n'
printf '  部屋をつなぐ\n'
printf '========================================\n'
printf '\n'
printf '  これは相手のシステムと部屋をつなぐ窓です。閉じると同期が止まります。\n'
printf '  （止まっている間の投稿は、次につないだ時にまとめて写ります）\n'
printf '  止めたい時は、この窓を閉じるか control + C。\n'

node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }
if [ -z "$(node_major)" ] || [ "$(node_major)" -lt 20 ] 2>/dev/null; then
  stop 'Node.js が見つからない' '先に「はじめる」を一度ダブルクリックしてください。Node.js の導入まで、あちらが面倒を見ます。'
fi
# 同期は .env を Node 自身に読ませている（process.loadEnvFile）。これが無い 20.12 未満では動かない
if ! node -e 'process.exit(typeof process.loadEnvFile === "function" ? 0 : 1)' 2>/dev/null; then
  stop "Node.js が古い（$(node -v)）" 'https://nodejs.org/ja の「LTS」を入れ直してから、もう一度「つなぐ」をダブルクリック。'
fi
if [ ! -d node_modules/better-sqlite3 ]; then
  stop '部品が揃っていない' '先に「はじめる」を一度ダブルクリックしてください。'
fi

# 画面が動いていなくても同期そのものは走るが、AI が返事をしないので先に知らせる
PORT="$(grep -E '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r' | tr -d ' ')"
[ -n "$PORT" ] || PORT=3210
if ! curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/rooms" 2>/dev/null; then
  printf '\n  ! 「はじめる」がまだ動いていないようです。\n'
  printf '  ! 同期は始めますが、「はじめる」も動かさないと自分の AI が返事をしません。\n'
fi
printf '\n'

# Ctrl+C で bash ごと終わると「キーを押すと閉じます」まで辿り着かない。
# 何もしない処理を INT に付けておく（node には既定の扱いのまま渡るので、同期は普通に止まる）
trap ':' INT

node scripts/room-sync.mjs
code=$?

trap - INT
if [ "$code" -eq 0 ]; then
  printf '\n同期を止めました。\n'
else
  printf '\n✖ 同期が止まりました（上に出ている文を見てください。手順は docs/room-sync.md）\n'
fi
wait_key
exit "$code"
