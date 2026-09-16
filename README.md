# Xiaohongshu Importer Pro

**English** | [中文](./README.zh-CN.md)

Import Xiaohongshu (小红书) notes into your Obsidian vault as local Markdown — including the full body text, all images, hashtags, author info, and engagement metrics.

---

## Features

| Feature | Description |
|---|---|
| **Import from share link** | Paste a Xiaohongshu share text or link to import a note. Supports `xhslink.com` short links and App / web share links. |
| **Full body text** | Complete note body, with hashtags separated out and cleaned. |
| **All images downloaded** | Images are saved into your local vault, so they stay readable offline and survive note deletion. |
| **Engagement metrics** | Like / save / comment / share counts written to frontmatter — useful for filtering for high-performing notes. |
| **Publish date & author** | Real publish date, author nickname and author ID. |
| **Configurable folders** | Separate configurable destinations for notes and images. |
| **Configurable frontmatter** | Add, remove, reorder, enable or disable fields; values support placeholders. |
| **Emoji-safe filenames** | Filenames keep Chinese characters, emoji and punctuation without dropping or corrupting them. |
| **Bilingual interface** | The UI follows your Obsidian interface language — Chinese for `zh*` locales, English otherwise. |
| **Video notes** | Video notes keep a remote direct link plus cover image. |

### Placeholders

Use these in any frontmatter field value:

| Placeholder | Value |
|---|---|
| `{{date}}` | Import date (`YYYY-MM-DD`) |
| `{{title}}` | Note title |
| `{{source}}` | Original share link |
| `{{videoUrl}}` | Video direct URL (video notes only) |
| `{{publishDate}}` | Note publish date (`YYYY-MM-DD`) |
| `{{author}}` | Author nickname |
| `{{authorId}}` | Author user ID |
| `{{likedCount}}` | Like count |
| `{{collectedCount}}` | Save / collect count |
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
stats: Liked {{likedCount}} · Saved {{collectedCount}} · Comments {{commentCount}}
source: {{source}}
tags:
  - type/excerpt
  - status/to-process
---
```

---

## Network usage

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

## Installation

### Manual install

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Create a folder named `xhs-importer-pro` inside `<your-vault>/.obsidian/plugins/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Xiaohongshu Importer Pro** in *Settings → Community plugins*.

### Via BRAT

Add the repository URL to [BRAT](https://github.com/TfTHacker/obsidian42-brat) to receive beta updates automatically.

---

## Usage

1. Copy a Xiaohongshu share link (App: *Share → Copy link*, or the web share button).
2. In Obsidian, click the ribbon icon or run the command **Import Xiaohongshu note**.
3. Paste the share text or URL.
4. Choose whether to download images for this import.
5. The note is created in your configured folder with frontmatter, body text and images.

> **Note:** Use share links (`xsec_source=app_share` / `pc_share`). Links copied from your browser's address bar carry a session-bound token and will be rejected.

---

## Scope & limitations

- Only **public single notes** are supported. This plugin does not scrape a creator's full profile, search results, or your own bookmarks/likes.
- **Comments cannot be imported.** Xiaohongshu serves comment content through a separate endpoint that requires an authenticated session, which this plugin deliberately does not use.
- Video notes keep a remote URL only; the video file itself is not downloaded.
- Parsing depends on Xiaohongshu's current page structure. If the site changes its frontend, field extraction may need updating.

---

## Credits

This project is built on the work of others, and is released under the same MIT license:

- **[Xiaohongshu Importer Plus](https://github.com/lxl448080113/ob-Plugin)** by [lxl448080113](https://github.com/lxl448080113) — the direct upstream this plugin derives from.
- **[xiaohongshu-importer](https://github.com/bnchiang96/xiaohongshu-importer)** by [bnchiang96](https://github.com/bnchiang96) — the original plugin that upstream was adapted from.

Both copyright notices are preserved in the [LICENSE](./LICENSE).

---

## License

[MIT](./LICENSE)
