# Changelog

All notable changes to **Xiaohongshu Importer Pro** are documented here.

## [1.0.4]

### Added

- New frontmatter placeholders:
  - `{{publishDate}}` — note publish date (`YYYY-MM-DD`)
  - `{{author}}` / `{{authorId}}` — note author
  - `{{likedCount}}` / `{{collectedCount}}` / `{{commentCount}}` / `{{shareCount}}` — engagement metrics
  - `{{ipLocation}}` — author IP location
  - `{{noteType}}` — `normal` (image note) or `video`
  - `{{noteTags}}` — note hashtags
  - `{{noteId}}` — Xiaohongshu note ID
- Placeholder resolver now accepts any `{{key}}` present in the context, so new fields can be added without touching the regex.
- Settings tab shows the active placeholder list and a local-enhancement notice.

### Fixed

- The cover image was inserted twice in image notes (once as `Cover Image`, again in the trailing image list).
- Image filenames dropped emoji and non-CJK punctuation (e.g. `董姐太🐮了；…` became `董姐太了…`).
- Filename truncation could split an emoji surrogate pair, producing an invalid character.

## [1.0.3]

- Baseline inherited from **Xiaohongshu Importer Plus** by [lxl448080113](https://github.com/lxl448080113).
