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

1. 次の 6 ファイルを、makoSystem のフォルダへ同じ配置でまとめて上書きします。
   `scripts/room-sync.mjs` だけを差し替えると、起動時に落ちます。
   - `scripts/room-sync.mjs`
   - `lib/room-sync-routing.mjs`
   - `lib/room-sync-routing.d.mts`
   - `bridge/targets.ts`
   - `bridge/index.ts`
   - `app/api/messages/route.ts`
2. makoSystem を自分で改修している人は、上書きせず、自分の AI に「差分を照合して取り込んで」と頼んでください（特に `bridge/index.ts` と `app/api/messages/route.ts`）。
3. `.env` に、Makoto から個別に受け取った設定を貼ります。鍵は人ごとに違います。このリポジトリには鍵を置きません。
4. 画面・ブリッジ（「はじめる」）と「つなぐ」を、両方とも起動し直します。
5. 複数人の部屋では、AI を「＠拠点名/AI-id」の形で呼びます（＠は半角で書く。ここでは誤って AI が起きないよう全角で書いています）。
   宛先の無い投稿は人同士の会話として全員に共有され、AI は起きません。
6. 最初につないだ時、部屋の過去の投稿がまとめて届きます。
