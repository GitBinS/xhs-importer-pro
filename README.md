# Xiaohongshu Importer Pro

Import Xiaohongshu (小红书) notes into your Obsidian vault as local Markdown — including the full body text, all images, hashtags, author info, and engagement metrics.

把小红书笔记导入你的 Obsidian 知识库：正文、全部图片、话题标签、作者信息，以及**点赞 / 收藏 / 评论 / 分享**数据。

---

## Features / 功能

| Feature | 说明 |
|---|---|
| **Import from share link** | 粘贴小红书分享文本或链接即可导入（支持 `xhslink.com` 短链与 App / 网页分享链接） |
| **Full body text** | 完整正文，自动剥离话题标签并单独整理 |
| **All images downloaded** | 图片全部下载到本地 vault，离线可看、原帖删除也不丢 |
| **Engagement metrics** | 点赞数 / 收藏数 / 评论数 / 分享数，写入 frontmatter，便于筛选爆款 |
| **Publish date & author** | 笔记真实发布时间、作者昵称与主页 ID |
| **Configurable folders** | 笔记落点目录、图片落点目录均可配置 |
| **Configurable frontmatter** | 字段可增删、排序、启停，值支持占位符 |
| **Emoji-safe filenames** | 文件名保留中文、emoji 与标点，不会丢字或截断坏字符 |
| **Video notes** | 视频笔记保留远程直链 + 封面图 |

### Placeholders / 可用占位符

Use these in any frontmatter field value:

| Placeholder | Value |
|---|---|
| `{{date}}` | Import date (`YYYY-MM-DD`) |
| `{{title}}` | Note title |
| `{{source}}` | Original share link |
| `{{videoUrl}}` | Video direct URL (video notes only) |
| `{{publishDate}}` | **Note publish date** (`YYYY-MM-DD`) |
| `{{author}}` | Author nickname |
| `{{authorId}}` | Author user ID |
| `{{likedCount}}` | Like count |
| `{{collectedCount}}` | Save/collect count |
| `{{commentCount}}` | Comment count |
| `{{shareCount}}` | Share count |
| `{{ipLocation}}` | Author IP location |
| `{{noteType}}` | `normal` or `video` |
| `{{noteTags}}` | Hashtags, space-separated |
| `{{noteId}}` | Xiaohongshu note ID |

Example frontmatter setup:

```yaml
---
aliases:
created: {{date}}
published: {{publishDate}}
author: {{author}}
stats: 赞{{likedCount}} 藏{{collectedCount}} 评{{commentCount}}
source: {{source}}
tags:
  - 类型/摘录
  - 状态/待加工
---
```

---

## Network usage / 网络使用声明

**Required disclosure.** This plugin makes network requests, and only in the following situations:

| When | What is requested | Why |
|---|---|---|
| You trigger an import | An HTTP GET to `www.xiaohongshu.com` for the share link you pasted | To fetch the public note page, from which the title, body text, image URLs, hashtags and engagement counts are parsed |
| "Download images" is enabled | HTTPS GET to Xiaohongshu's CDN (`*.xhscdn.com`) for each image | To save the images into your local vault |

**What this plugin does NOT do:**

- No analytics, no telemetry, no crash reporting.
- No server component — there is no backend operated by the author.
- **No login required.** The plugin never asks for, reads, or stores your Xiaohongshu account credentials or cookies.
- No data is sent anywhere other than `www.xiaohongshu.com` and its image CDN.

Everything is processed locally on your machine. Imported notes are plain Markdown files in your own vault.

---

## Installation / 安装

### Manual install

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Create a folder named `xhs-importer-pro` inside `<your-vault>/.obsidian/plugins/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Xiaohongshu Importer Pro** in *Settings → Community plugins*.

### Via BRAT

Add the repository URL to [BRAT](https://github.com/TfTHacker/obsidian42-brat) to receive beta updates automatically.

---

## Usage / 使用

1. Copy a Xiaohongshu share link (App: *Share → Copy link*, or the web share button).
2. In Obsidian, click the ribbon icon or run the command **Import Xiaohongshu note**.
3. Paste the share text or URL.
4. Choose whether to download images for this import.
5. The note is created in your configured folder with frontmatter, body text and images.

> **Note:** Use share links (`xsec_source=app_share` / `pc_share`). Links copied from your browser's address bar carry a session-bound token and will be rejected.

---

## Scope & limitations / 范围与限制

- Only **public single notes** are supported. This plugin does not scrape a creator's full profile, search results, or your own bookmarks/likes.
- **Comments cannot be imported.** Xiaohongshu serves comment content through a separate endpoint that requires an authenticated session, which this plugin deliberately does not use.
- Video notes keep a remote URL only; the video file itself is not downloaded.
- Parsing depends on Xiaohongshu's current page structure. If the site changes its frontend, field extraction may need updating.

---

## Credits / 致谢

This project is built on the work of others, and is released under the same MIT license:

- **[Xiaohongshu Importer Plus](https://github.com/lxl448080113/ob-Plugin)** by [lxl448080113](https://github.com/lxl448080113) — the direct upstream this plugin derives from.
- **[xiaohongshu-importer](https://github.com/bnchiang96/xiaohongshu-importer)** by [bnchiang96](https://github.com/bnchiang96) — the original plugin that upstream was adapted from.

Both copyright notices are preserved in the [LICENSE](./LICENSE).

---

## License

[MIT](./LICENSE)
