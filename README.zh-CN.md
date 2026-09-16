# Xiaohongshu Importer Pro（小红书笔记采集 · 增强版）

[English](./README.md) | **中文**

把小红书笔记导入你的 Obsidian 知识库：完整正文、全部图片、话题标签、作者信息，以及点赞 / 收藏 / 评论 / 分享数据，全部落成本地 Markdown。

---

## 功能

| 功能 | 说明 |
|---|---|
| **从分享链接导入** | 粘贴小红书分享文本或链接即可导入。支持 `xhslink.com` 短链与 App / 网页分享链接。 |
| **完整正文** | 保留笔记完整正文，并把话题标签单独抽出整理。 |
| **图片全部下载到本地** | 图片存到你的本地库，断网可看，原帖删除也不丢。 |
| **互动数据** | 点赞 / 收藏 / 评论 / 分享数写入 frontmatter —— 便于筛选出高表现的笔记。 |
| **发布时间与作者** | 笔记真实发布时间、作者昵称与作者 ID。 |
| **落点目录可配** | 笔记目录与图片目录分别可配。 |
| **Frontmatter 可配** | 字段可增删、排序、启停，字段值支持占位符。 |
| **文件名保留 emoji** | 文件名保留中文、emoji 与标点，不会丢字或截断坏字符。 |
| **视频笔记** | 视频笔记保留远程直链与封面图。 |

### 可用占位符

任意 frontmatter 字段的值里都可以使用：

| 占位符 | 取值 |
|---|---|
| `{{date}}` | 导入日期（`YYYY-MM-DD`） |
| `{{title}}` | 笔记标题 |
| `{{source}}` | 原始分享链接 |
| `{{videoUrl}}` | 视频直链（仅视频笔记） |
| `{{publishDate}}` | 笔记发布时间（`YYYY-MM-DD`） |
| `{{author}}` | 作者昵称 |
| `{{authorId}}` | 作者 ID |
| `{{likedCount}}` | 点赞数 |
| `{{collectedCount}}` | 收藏数 |
| `{{commentCount}}` | 评论数 |
| `{{shareCount}}` | 分享数 |
| `{{ipLocation}}` | 作者 IP 属地 |
| `{{noteType}}` | `normal`（图文）或 `video`（视频） |
| `{{noteTags}}` | 话题标签，空格分隔 |
| `{{noteId}}` | 小红书笔记 ID |

frontmatter 配置示例：

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

## 网络使用声明

**必需披露项。** 本插件会产生网络请求，且仅在以下两种情况：

| 触发时机 | 请求内容 | 用途 |
|---|---|---|
| 你主动发起一次导入 | 向你粘贴的分享链接对应的 `www.xiaohongshu.com` 发起 HTTP GET | 获取该笔记的公开页面，从中解析标题、正文、图片地址、话题标签与互动数据 |
| 开启「下载图片」 | 向小红书 CDN（`*.xhscdn.com`）逐张发起 HTTPS GET | 把图片保存到你的本地库 |

**本插件不做这些事：**

- 无统计分析、无遥测、无崩溃上报。
- 无服务端 —— 作者没有运营任何后端。
- **无需登录。** 插件不会索取、读取或存储你的小红书账号凭证或 Cookie。
- 除 `www.xiaohongshu.com` 及其图片 CDN 外，不向任何其他地址发送数据。

所有处理都在你本机完成。导入的笔记就是你库里的纯 Markdown 文件。

---

## 安装

### 手动安装

1. 从最新 Release 下载 `main.js`、`manifest.json`、`styles.css`。
2. 在你的库目录下创建文件夹 `<你的库>/.obsidian/plugins/xhs-importer-pro/`。
3. 把这三个文件复制进去。
4. 重新加载 Obsidian，在 *设置 → 第三方插件* 中启用 **Xiaohongshu Importer Pro**。

### 通过 BRAT 安装

把本仓库地址加入 [BRAT](https://github.com/TfTHacker/obsidian42-brat)，即可自动接收测试版更新。

---

## 使用

1. 复制一条小红书分享链接（App 内：*分享 → 复制链接*，或网页端分享按钮）。
2. 在 Obsidian 中点击侧边栏图标，或运行命令 **Import Xiaohongshu note**。
3. 粘贴分享文本或链接。
4. 选择本次导入是否下载图片。
5. 笔记会按你的配置生成在指定目录，含 frontmatter、正文与图片。

> **注意：** 必须使用**分享链接**（`xsec_source=app_share` 或 `pc_share`）。从浏览器地址栏复制的链接带有会话绑定的 token，会被拒绝。

---

## 范围与限制

- 仅支持**公开的单篇笔记**。本插件不采集博主主页全量、搜索结果，也不采集你自己的收藏 / 点赞。
- **评论无法导入。** 小红书的评论内容走独立接口且需要登录态，本插件刻意不使用登录态。
- 视频笔记仅保留远程链接，不下载视频文件本体。
- 解析依赖小红书当前的页面结构。站方若调整前端，字段提取逻辑可能需要同步更新。

---

## 致谢

本项目建立在他人的工作之上，并以同样的 MIT 许可证发布：

- **[Xiaohongshu Importer Plus](https://github.com/lxl448080113/ob-Plugin)** —— 作者 [lxl448080113](https://github.com/lxl448080113)，本插件的直接上游。
- **[xiaohongshu-importer](https://github.com/bnchiang96/xiaohongshu-importer)** —— 作者 [bnchiang96](https://github.com/bnchiang96)，上游所改编的原始插件。

两份版权声明均已在 [LICENSE](./LICENSE) 中保留。

---

## 许可证

[MIT](./LICENSE)
