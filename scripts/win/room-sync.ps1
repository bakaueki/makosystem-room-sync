# 相手のシステムと部屋をつなぐ（Windows）。つなぐ.bat から呼ばれる。中身は npm run room-sync と同じ。
#
# 「はじめる」とは別の窓で動かす。画面とブリッジは「はじめる」が、部屋の同期はこの窓が受け持つ。
# 両方が動いていないと、相手の投稿は写っても自分の AI が返事をしない。
#
# node の探し方は start.ps1 と同じ（このフォルダの tools\node → パソコンに入っている 22 以上）。
# 同梱方式の人は npm が PATH に無いので、npm run ではなく node.exe を直接呼ぶ。
# npm.cmd を挟まないのは、Ctrl+C で「バッチ ジョブを終了しますか」が余計に出るのを避けるためでもある。
#
# Windows PowerShell 5.1 で動くこと。pwsh 7 だけの書き方は使わない。

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root

$nodeDir = Join-Path (Join-Path $root 'tools') 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'

function Wait-Key {
  Write-Host ''
  Write-Host '  何かキーを押すと、この窓が閉じます。'
  try { [void][System.Console]::ReadKey($true) } catch { Read-Host | Out-Null }
}

function Fail($title, $hints) {
  Write-Host ''
  Write-Host "✖ $title" -ForegroundColor Red
  if ($hints) {
    Write-Host ''
    foreach ($h in $hints) { Write-Host "  $h" }
  }
  Wait-Key
  exit 9
}

# 思わぬところで止まった時に、窓が一瞬で消えないようにする。
# ここを通ったら終了コードは 9。つなぐ.bat 側はそれを見て、二重に止めない。
trap {
  Write-Host ''
  Write-Host "✖ 思わぬところで止まりました: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  （$($_.InvocationInfo.ScriptName) の $($_.InvocationInfo.ScriptLineNumber) 行目）"
  Write-Host ''
  Write-Host '  この黒い窓の文字の最後の 10 行をそのまま送ってください。'
  Wait-Key
  exit 9
}

function Get-Port {
  $p = '3210'
  $f = Join-Path $root '.env'
  if (Test-Path -LiteralPath $f) {
    foreach ($line in (Get-Content -LiteralPath $f)) {
      if ($line -match '^\s*PORT\s*=\s*(\d+)') { $p = $Matches[1] }
    }
  }
  return $p
}

Write-Host '========================================'
Write-Host '  部屋をつなぐ'
Write-Host '========================================'
Write-Host ''
Write-Host '  これは相手のシステムと部屋をつなぐ窓です。閉じると同期が止まります。' -ForegroundColor Yellow
Write-Host '  （止まっている間の投稿は、次につないだ時にまとめて写ります）'
Write-Host '  止めたい時は、この窓を閉じるか Ctrl + C。'

# ------------------------------------------------------------------ Node を探す
$node = ''
if (Test-Path -LiteralPath $nodeExe) {
  $node = $nodeExe
} else {
  $sysNode = Get-Command node -ErrorAction SilentlyContinue
  if ($sysNode) {
    $ver = (& node -v)
    $major = 0
    if ("$ver" -match '^v(\d+)\.') { $major = [int]$Matches[1] }
    if ($major -ge 22) { $node = $sysNode.Source }
  }
}
if (-not $node) {
  Fail 'Node.js が見つかりません' @(
    '先に「はじめる」を一度ダブルクリックしてください。',
    'Node.js の取り込みまで、あちらが面倒を見ます。'
  )
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\better-sqlite3'))) {
  Fail '部品が揃っていません' @('先に「はじめる」を一度ダブルクリックしてください。')
}

# 画面が動いていなくても同期そのものは走るが、AI が返事をしないので先に知らせる
$port = Get-Port
try {
  $null = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/rooms" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
} catch {
  Write-Host ''
  Write-Host '  ! 「はじめる」がまだ動いていないようです。' -ForegroundColor Yellow
  Write-Host '  ! 同期は始めますが、「はじめる」も動かさないと自分の AI が返事をしません。' -ForegroundColor Yellow
}
Write-Host ''

# ------------------------------------------------------------------ 同期
# Ctrl+C で止めた時もこの窓を開いたままにする。PowerShell は Ctrl+C でスクリプトを打ち切るが、
# finally だけは最後まで走らせるので、「キーを押すと閉じます」はそこに置く。
$code = 0
$stoppedByUser = $true
try {
  & $node (Join-Path $root 'scripts\room-sync.mjs')
  $code = $LASTEXITCODE
  $stoppedByUser = $false
} finally {
  Write-Host ''
  if ($stoppedByUser -or ($code -eq 0)) {
    Write-Host '同期を止めました。'
  } else {
    Write-Host '✖ 同期が止まりました（上に出ている文を見てください。手順は docs\room-sync.md）' -ForegroundColor Red
  }
  Wait-Key
}
exit 9
