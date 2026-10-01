# makosystem-room-sync

makoSystem に「部屋の同期」を後から足すためのファイルです。

makoSystem のフォルダ直下に、このリポジトリと同じ配置で置いてください。
手順は [docs/room-sync.md](docs/room-sync.md) にあります。

合言葉（`ROOM_SYNC_SECRET`）はここには含まれていません。相手から直接受け取ってください。

## 入っているファイル

- `scripts/room-sync.mjs` — 同期の本体
- `docs/room-sync.md` — 設定と使い方
- `つなぐ.command` — Mac で起動する
- `つなぐ.bat` — Windows で起動する
- `scripts/win/room-sync.ps1` — Windows 用の設定・起動処理
- `lib/room-sync-routing.mjs`・`lib/room-sync-routing.d.mts` — 複数人の部屋の宛先の見分け
- `bridge/targets.ts`・`bridge/index.ts` — 複数人の部屋で AI を起こす条件
- `app/api/messages/route.ts` — 複数人の部屋の投稿の受け取り

## 複数人の部屋（メールワイズ）に参加する・更新する

1. 部屋の同期を入れるのが初めての人は、まずこのリポジトリの全ファイルを、makoSystem のフォルダへ同じ配置で置きます
   （`つなぐ.command`・`つなぐ.bat`・`scripts/win/room-sync.ps1` を含む。これが無いと同期を起動できません）。
   すでに「つなぐ」を使っている人は、次の 6 ファイルの更新だけで足ります。
2. 次の 6 ファイルを、makoSystem のフォルダへ同じ配置でまとめて上書きします。
   `scripts/room-sync.mjs` だけを差し替えると、起動時に落ちます。
   - `scripts/room-sync.mjs`
   - `lib/room-sync-routing.mjs`
   - `lib/room-sync-routing.d.mts`
   - `bridge/targets.ts`
   - `bridge/index.ts`
   - `app/api/messages/route.ts`
3. makoSystem を自分で改修している人は、上書きせず、自分の AI に「差分を照合して取り込んで」と頼んでください（特に `bridge/index.ts` と `app/api/messages/route.ts`）。
4. `.env` に、Makoto から個別に受け取った設定を貼ります。鍵は人ごとに違います。このリポジトリには鍵を置きません。
5. 画面・ブリッジ（「はじめる」）と「つなぐ」を、両方とも起動し直します。
6. AI の呼び方（＠は半角で書く。ここでは誤って AI が起きないよう全角で書いています）。
   自分の AI は、今までどおり「＠名前」で呼べます。
   Makoto 側の AI は「＠エルヴィン」「＠ハンジ」「＠リヴァイ」で呼べます。
   ほかの参加者の AI は「＠拠点名/AI-id」（例 ＠funakichi/commander）で呼びます。
   宛先の無い投稿は人同士の会話として全員に共有され、AI は起きません。
7. 最初につないだ時、部屋の過去の投稿がまとめて届きます。
8. 2026-10-01 夜の更新: 自分の AI を名前で呼べるようにしました。
   すでに複数人の部屋につないでいる人は、`lib/room-sync-routing.mjs`・`lib/room-sync-routing.d.mts`・`app/api/messages/route.ts`・`bridge/targets.ts` の 4 ファイルを更新し、「はじめる」を起動し直してください（自分で改修している人は差分を照合して取り込む）。
   更新しなくても、拠点名付きの書き方ならこれまでどおり呼べます。
