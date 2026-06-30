# ワシソダ分類er / SodaCH Works Classifier

**とりあえずの記述**

## 概要 / Overview

**曽田すかい@ワシソダch** の配信・動画を作品ごとに分類するための、ルールベースの辞書（`worksMaster.json`）の提供と、その辞書でカバーできていない動画（未分類動画）を検出するツールです。<br>
[SodaCH Discord Notifier](https://github.com/xiang4ri4kui2/SodaCH-discord-notifier) が Discord 通知の Embed に表示する「作品のフルタイトル」＆「作品頁の URL」の判定元データを提供します。<br>
現在、試験運用中です。<br>
<br>
This repository maintains a rule-based dictionary (`worksMaster.json`) for classifying videos and live streams from the YouTube channel **"曽田すかい@ワシソダch"** by work/title, and a tool that detects videos not yet covered by the dictionary (unclassified videos).<br>
It provides the source data used by [SodaCH Discord Notifier](https://github.com/xiang4ri4kui2/SodaCH-discord-notifier) to display the work's full title and official page URL in Discord notification embeds.<br>
Currently under trial operation.<br>
<br>
### 対象チャンネル / Target Channel

**曽田すかい@ワシソダch**<br>
https://www.youtube.com/@BabiSodaSky

---

## 機能 / Features

本リポジトリは以下の機能を持ちます。

* `worksMaster.json` による作品分類ルールの管理（手動更新＆長期運用前提）
* チャンネルの新規動画（前回チェック以降の差分）を取得し、既存パターンに一致しない動画を検出
* 未分類動画が見つかった場合、候補文字列（タグ・タイトル括弧内文字列）付きで GitHub Issue を自動作成
* `worksMaster.json` 内の `lastCheckedAt` を自動更新（patterns 等の分類ルール自体は人間のみが編集）

This repository provides the following features:

* Maintains the classification rules in `worksMaster.json` (manually curated, intended for long-term operation)
* Fetches newly published videos since the last check and detects videos that don't match any existing pattern
* Automatically creates a GitHub Issue listing unclassified videos, along with candidate strings (tags and bracketed substrings from titles)
* Automatically updates `lastCheckedAt` in `worksMaster.json` (classification rules such as `patterns` are edited by humans only)

---

## 実行間隔 / Monitoring Schedule

負荷分散のため、GitHub Actions は **日次 1 回（JST hh:mm）** に実行しています。

To distribute system load, the workflow runs **once daily at JST hh:mm**.

---

## ステータス / Status

**現在、試験運用中**

**Currently under trial operation.**

---

## 必要要件 / Requirements

| Item / Secret Name | Version / Description |
| ------- | ------- |
| Node.js | 20.x    |
| npm     | latest  |
| `YOUTUBE_API_KEY` | YouTube Data API v3 API Key |

※ GitHub Issue 作成・`worksMaster.json` の自動コミットには `GITHUB_TOKEN`（GitHub Actions が自動付与）を使用しています。

\* `GITHUB_TOKEN` (automatically provided by GitHub Actions) is used for creating Issues and committing updates to `worksMaster.json`.

---

## ライセンス / License

This project is currently **not licensed**.

---

## 免責事項 / Disclaimer

本プロジェクトは **非公式のファンメイド** です。<br>
「曽田すかい@ワシソダch」や関係者とは一切関係ありません。<br>
但し、本ツールの運用については **「曽田すかい@ワシソダch」より公認** を得ています。<br>
本ツールは個人的な通知用途（SodaCH-discord-notifier 連携）を目的として作成されています。<br>
<br>
This project is an **unofficial fan-made project**.<br>
It is not affiliated with, endorsed by, or associated with **"曽田すかい@ワシソダch"** or its related parties.<br>
However, the operation of this tool has been **officially approved by "曽田すかい@ワシソダch"**.<br>
This tool is intended for personal notification purposes only (in conjunction with SodaCH-discord-notifier).
