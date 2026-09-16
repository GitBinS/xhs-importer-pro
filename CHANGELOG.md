# Changelog / 更新日志

All notable changes to **Xiaohongshu Importer Pro** are documented here.
本文件记录 **Xiaohongshu Importer Pro** 的所有重要变更。

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
