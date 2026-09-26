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
