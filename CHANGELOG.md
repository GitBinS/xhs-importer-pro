# Changelog / 更新日志

All notable changes to **Xiaohongshu Importer Pro** are documented here.
本文件记录 **Xiaohongshu Importer Pro** 的所有重要变更。

---

## [Unreleased] / 未发布

> Accumulating changes. Per the project convention, tags and releases are created in batches — not once per fix.
> 改动累积中。按项目约定，tag 与 release 攒批发布，不做「一修一版」。

### Changed / 变更

- **Recommended frontmatter config now writes `type: raw` as the first field**, so imported notes are visible to the vault's Bases views. This vault uses `type` to filter every board, so a note without `type` is invisible to all of them.
  推荐的 frontmatter 配置现在把 **`type: raw` 写在首行** —— 这样导入的笔记才能进 Obsidian Bases 看板。本库的所有看板都靠 `type` 过滤，没有 `type` 的文件不进任何看板。
- **Recommended frontmatter config now writes engagement counts as separate numeric fields** (`likes` / `saves` / `comments` / `shares`) instead of one merged `stats` string. A merged string cannot be sorted or aggregated by Bases/Dataview.
  推荐的 frontmatter 配置改为把互动数据写成**独立的数字字段**（`likes` / `saves` / `comments` / `shares`），不再合并成一串 `stats` 文本 —— 合并文本无法被 Bases / Dataview 排序或聚合。
- **Recommended config: the remaining English keys are renamed to Chinese** — `created` → `创建日期`, `published` → `发布日期`, `author` → `博主`, `source` → `笔记链接`, so an imported note reads in Chinese throughout. Only `type` (the Bases filter anchor), `aliases` and `tags` (Obsidian built-ins) stay English — all three for technical reasons, not style.
  推荐的配置把**其余英文键改为中文** —— `created` → `创建日期`、`published` → `发布日期`、`author` → `博主`、`source` → `笔记链接`，导入的笔记通篇可读。只保留 `type`（Bases 过滤锚点）、`aliases`、`tags`（Obsidian 内置属性）三个英文键，三者都是技术必需，不是风格取舍。
- **Settings tab: the placeholder list is now a labelled list.** Previously three dense lines of `{{...}}` with no explanation — you could not tell that `{{collectedCount}}` means "collect count". Each placeholder now gets its own row with a short description, plus a line clarifying field name (written into the note) vs placeholder (data-source identifier only used inside a default value).
  设置页的**占位符列表改为逐条带说明**。原先只是三行 `{{...}}` 堆砌，看不出 `{{collectedCount}}` 是"收藏数"。现在每个占位符单独一行并附中文说明，并加一句讲清「字段名（写进笔记）」与「占位符（只在默认值里用）」的区别。

### Fixed / 修复

- **Missing interaction counts are no longer rendered as `0`.** `normalizeCount()` used to coerce `undefined` / `""` to `"0"`, which — once counts became sortable fields — made notes with unknown data look like notes with zero engagement and would skew averages. Missing values now render as an empty key, matching the convention used by hand-written cards.
  互动数据缺失时**不再渲染成 `0`**。`normalizeCount()` 原先把 `undefined` / `""` 强转成 `"0"`；在计数变成可排序字段之后，这会让"数据未知"的笔记被当成 0 赞参与排序并拉低均值。现在缺失一律渲染为空键，与手写卡片的写法一致。

### Internal / 内部

- `dev/verify.mjs` now calls the **real plugin methods** for the frontmatter rendering test instead of a hand-copied duplicate of the logic, runs fully offline, and exits non-zero on failure. Coverage grew from 9 to 38 assertions, including a guard that every placeholder has a settings-tab description (so adding a placeholder without documenting it fails the test), and an assertion that pins the ASCII-only placeholder limitation.
  `dev/verify.mjs` 的 frontmatter 渲染测试改为调用**真实插件方法**（原先手抄了一份逻辑副本，等于在测自己），全程离线可跑，失败时返回非零退出码。断言数 9 → 38，其中包含**「新增占位符但忘了写设置页说明」会直接测试失败**的守门断言，以及把「占位符只能是 ASCII」这条限制固化下来的断言。

---

## [1.0.12]

### Removed / 移除

- **Author-profile fetching and the "Backfill missing author info" command.**
  作者主页抓取功能，以及「补抓作者的缺失信息」命令。

### Why / 原因

The author's Xiaohongshu ID (小红书号) **is not present in the note page data** — it only exists on the author's profile page, and that endpoint is aggressively rate limited. Back-to-back requests get redirected to a login page, so during a batch import most notes lost the ID, and retrying rarely helped. Shipping a feature that only works occasionally is worse than not shipping it.

小红书号**不在笔记页数据里**，只存在于作者主页；而该接口限流严格 —— 连发请求会被重定向到登录页，批量导入时多数笔记都拿不到，重试也收效甚微。与其留一个时灵时不灵的功能，不如移除。

### Kept / 保留

- `{{authorUrl}}` — the author's profile link, derived from `userId` directly. **This needs no extra request**, so it stays. Open it to see the Xiaohongshu ID on the profile page.
  `{{authorUrl}}` 保留 —— 由 `userId` 直接拼出，**不需要额外请求**。点开即可在主页看到小红书号。

---

## [1.0.11]

### Fixed / 修复

- **Author-profile fetches failed silently and were cached as failures.** The profile endpoint is rate limited — sending several requests back to back gets them redirected to a login page. Two problems followed:
  1) a failed fetch was written to the cache, so the same author could never be retried within the session;
  2) there was no throttling between profile requests, so batch imports regularly lost author IDs.
  **作者主页抓取会静默失败，且失败结果被写进缓存。** 该接口有限流 —— 连续请求会被重定向到登录页。由此带来两个问题：① 抓取失败会写入缓存，导致同一作者在本次会话内再也不会重试；② 主页请求之间没有节流，批量导入时常丢小红书号。
  - Failed fetches are **no longer cached**.
    抓取失败**不再写入缓存**。
  - Profile requests are retried up to 3 times with backoff and jitter.
    主页请求会**重试最多 3 次**，带退避与随机抖动。
  - A minimum 5 s gap is enforced between profile requests.
    主页请求之间强制**至少 5 秒间隔**。

### Added / 新增

- **New command: Backfill missing author info.** Scans your note folder for notes whose `authorRedId` is empty and re-fetches it from the note's `source` link, then writes the value back into the frontmatter. Useful when a rate limit caused the ID to be missed on import (re-importing would be treated as a duplicate).
  **新增命令「补抓作者的缺失信息」**：扫描笔记目录里 `authorRedId` 为空的笔记，按其 `source` 链接重新抓取并回填 frontmatter。用于首页限流漏抓后的补救（重导会被判重复，故单独提供入口）。

---

## [1.0.10]

### Fixed / 修复

- **Duplicate detection could not tell "imported" from "still in the vault."** If you deleted an imported note and then imported the same link again, the plugin wrongly reported it as a duplicate and refused to import. Deduplication now requires the note file to **actually still exist** in the vault — deleting a note makes it importable again.
  **去重此前分不清「导入过」和「仓库里还在」**：删掉已导入的笔记后重新导入同一链接，会被误判为重复而拒绝导入。现在去重要求笔记文件**确实仍在库中**才跳过 —— 删掉笔记后即可重新导入。
  - The index now stores the note's file path, and validity is checked against the vault.
    索引新增记录笔记文件路径，并据此到库中校验。
  - Entries written by older versions (no path) fall back to a vault-wide lookup by note title, so existing indexes are handled correctly too.
    旧版本写入的索引项（无路径）会退化为**按标题全库反查**，因此现有索引同样能被正确处理。
- **Re-importing re-downloaded all images as `-1`, `-2` copies.** If a note was deleted but its images remained, re-importing created duplicate image files. Images are now reused when a file of the same name already exists.
  **重新导入会把图片重复下载成 `-1`、`-2` 副本**：笔记被删但图片还在时，重导会产生重复图片文件。现在同名图片已存在则**直接复用**。

---

## [1.0.9]

### Fixed / 修复

- **Body normalization was only applied to video notes.** Image notes still kept the pseudo-blank lines made of tabs/spaces from the source. Both branches now go through the same cleaner.
  正文清理此前**只作用于视频笔记**，图文笔记仍会保留源文本里的 tab/空格伪空行。现在两条分支统一走同一套清理逻辑。

---

## [1.0.8]

### Added / 新增

**Batch import / 批量导入**

- Paste **multiple share links at once** (one per line, or a whole block of text) — all links in the text are detected and imported in order.
  可**一次粘贴多条分享链接**（一行一条，或直接糊一大段文本），插件会按顺序识别并逐条导入。
- **Duplicate detection by note ID**, with a persistent index (`imported-notes.json` in the plugin folder). Already-imported notes are skipped instead of being written twice. Deduplication is independent of your frontmatter configuration.
  **按笔记 ID 去重**，索引持久化在插件目录的 `imported-notes.json`。已导入过的笔记会跳过而不是重复落盘，且不依赖你的 frontmatter 配置。
- **Random throttling** between requests (1.5–3.5 s) to reduce the risk of rate limiting.
  请求之间加入**随机节流**（1.5–3.5 秒），降低被限流的风险。
- Per-run limit of **20 links**; exceeding it disables the submit button with an explanatory hint.
  单次上限 **20 条**，超出会禁用提交按钮并给出提示。
- Failure of one link does not abort the batch; failed links are listed at the end.
  单条失败**不中断**整批，失败的链接会在末尾列出。

### Changed / 变更

**Import modal / 导入弹窗**

- Live link counter under the textarea ("3 link(s) detected").
  textarea 下方新增**实时链接计数**。
- Submit button now shows the count ("Import 3 note(s)") and is disabled when no link is detected.
  提交按钮显示条数（"导入 3 条"），未识别到链接时禁用。
- Deduplication notice added; textarea is taller and resizable.
  新增去重说明；textarea 加高并支持拖拽调整。
- `Enter` now inserts a newline (needed for multi-line pasting); submit with `Ctrl/Cmd + Enter`.
  `Enter` 改为换行（批量粘贴需要），提交用 `Ctrl/Cmd + Enter`。

---

## [1.0.7]

### Added / 新增

**Author profile fields / 作者主页信息**

- New placeholders populated from the author's profile page:
  新增从作者主页获取的占位符：
  - `{{authorRedId}}` — **Xiaohongshu ID (小红书号)**, e.g. `63513864442`
  - `{{authorDesc}}` — author bio / 作者简介
  - `{{authorUrl}}` — author profile link / 作者主页链接
  - `{{authorFans}}` — follower count / 粉丝数
  - `{{authorIpLocation}}` — author IP location / 作者 IP 属地
- New setting **Fetch author profile** (on by default) with a per-author cache, so each author is requested at most once per session.
  新增设置项「抓取作者小红书号」（默认开启），并按作者缓存，同一作者每次会话最多请求一次。

### Notes / 说明

- The Xiaohongshu ID is **not present in the note page data** — it only exists on the author's profile page, so one extra request is required. The profile URL is accessible without login or tokens.
  小红书号**不在笔记页数据中**，只存在于作者主页，因此需要额外一次请求。主页 URL 无需登录、无需 token 即可访问。
- Profile-page initial state contains `new Set([...])`, which is not valid JSON; the resolver rewrites it before parsing.
  作者主页的初始状态里含 `new Set([...])`（非合法 JSON），解析前会做替换处理。

---

## [1.0.6]

### Fixed / 修复

- **Image links were written as relative paths**, so they resolved against the note's own folder and could not be found. Image and cover links are now always written as vault-root absolute paths (`/folder/image.jpg`).
  图片链接此前写成**相对路径**（`附件/XHS/xxx.jpg`），会被当作相对当前笔记目录解析而找不到图片。现在统一写成**库根绝对路径**（`/附件/XHS/xxx.jpg`）。
- **Body text kept pseudo-blank lines made of tabs/spaces** from the Xiaohongshu source. Such lines are now normalized to true blank lines, trailing whitespace is stripped, and runs of 3+ newlines are collapsed to 2.
  正文里来自小红书原文的**纯 tab/空格伪空行**现在会被归一成真正的空行，行尾空白被清除，连续 3 个以上换行压缩为 2 个。

### Changed / 变更

- Plugin `name` in `manifest.json` is now `xhs-importer-pro`, matching the plugin id.
  `manifest.json` 里的插件名改为 `xhs-importer-pro`，与 id 一致。

---

## [1.0.5]

### Added / 新增

**Bilingual interface / 界面双语化**

- The plugin interface (settings tab, import modal, ribbon tooltip, command name and all notifications) now follows the Obsidian interface language: Chinese for `zh*` locales, English otherwise.
  插件界面（设置页、导入弹窗、侧边栏提示、命令名与全部通知）现在**跟随 Obsidian 界面语言**：`zh*` 环境显示中文，其余显示英文。
- Language detection reads Obsidian's stored language, then falls back to the moment locale, then defaults to Chinese.
  语言检测依次读取 Obsidian 存储的语言、moment 的 locale，最后回退中文。

### Changed / 变更

- All previously hard-coded English UI strings were moved into a single i18n table in `main.js` for easier maintenance and future translations.
  原先硬编码的英文界面文案已集中到 `main.js` 的 i18n 表中，便于维护与后续扩展语种。

---

## [1.0.4]

### Added / 新增

**New frontmatter placeholders / 新增 frontmatter 占位符**

- `{{publishDate}}` — note publish date (`YYYY-MM-DD`) / 笔记发布时间
- `{{author}}` / `{{authorId}}` — note author / 作者昵称与作者 ID
- `{{likedCount}}` / `{{collectedCount}}` / `{{commentCount}}` / `{{shareCount}}` — engagement metrics / 点赞·收藏·评论·分享数
- `{{ipLocation}}` — author IP location / 作者 IP 属地
- `{{noteType}}` — `normal` (image note) or `video` / 图文或视频
- `{{noteTags}}` — note hashtags / 话题标签
- `{{noteId}}` — Xiaohongshu note ID / 小红书笔记 ID

**Other / 其他**

- The placeholder resolver now accepts any `{{key}}` present in the context, so new fields can be added without touching the regex.
  占位符解析改为通配 `{{key}}`，以后新增字段无需改动代码。
- The settings tab now shows the active placeholder list and a local-enhancement notice.
  设置页现在会显示可用占位符清单与增强版标识。

### Fixed / 修复

- **Cover image was inserted twice** in image notes (once as `Cover Image`, again in the trailing image list).
  图文笔记的**封面图被插入两次**（一次作封面，一次又在末尾图片列表里）。
- **Image filenames dropped emoji and non-CJK punctuation** (e.g. `董姐太🐮了；…` became `董姐太了…`).
  **图片文件名丢失 emoji 与非中日韩标点**（例如 `董姐太🐮了；…` 变成 `董姐太了…`）。
- **Filename truncation could split an emoji surrogate pair**, producing an invalid character. Truncation now counts by code point.
  **文件名截断可能切断 emoji 代理对**、产生非法字符。现改为按码点截断。

---

## [1.0.3]

- Baseline inherited from **Xiaohongshu Importer Plus** by [lxl448080113](https://github.com/lxl448080113).
  基线源自 [lxl448080113](https://github.com/lxl448080113) 的 **Xiaohongshu Importer Plus**。
