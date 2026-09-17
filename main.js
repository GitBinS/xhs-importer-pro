/*
 * Xiaohongshu Importer plugin
 * Customized for local vault workflow
 */

const {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} = require("obsidian");

const DEFAULT_SETTINGS = {
  noteFolder: "00.收集箱",
  imageFolder: "附件/XHS",
  downloadMedia: true,
  frontmatterFields: [],
};

const XHS_SHORT_LINK_HOSTS = new Set(["xhslink.com", "xhslink.cn"]);
const XHS_NOTE_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com"]);
const XHS_REQUEST_HEADERS = Object.freeze({
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
});

function cleanURLCandidate(candidate) {
  return candidate
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/[.,，。;；!！?？、)\]}>）】》」』]+$/u, "");
}

function normalizeXHSURL(candidate) {
  try {
    const parsed = new URL(cleanURLCandidate(candidate));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    if (parsed.username || parsed.password || parsed.port) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (XHS_SHORT_LINK_HOSTS.has(hostname)) {
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      if (pathSegments.length < 2) {
        return null;
      }

      parsed.protocol = "https:";
      parsed.hostname = hostname;
      parsed.hash = "";
      return parsed.toString();
    }

    if (!XHS_NOTE_HOSTS.has(hostname)) {
      return null;
    }

    const notePathMatch = parsed.pathname.match(
      /^\/(discovery\/item|explore|search_result)\/([a-zA-Z0-9]+)\/?$/,
    );
    if (!notePathMatch) {
      return null;
    }

    parsed.protocol = "https:";
    parsed.hostname = "www.xiaohongshu.com";
    parsed.hash = "";
    if (notePathMatch[1] === "explore") {
      parsed.pathname = `/discovery/item/${notePathMatch[2]}`;
    }

    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function extractXHSURL(text) {
  const candidates =
    String(text || "").match(
      /https?:\/\/[^\s\u200B-\u200D\u2060\uFEFF<>"'`,，。；！？？、)\]}>）】》」』]+/giu,
    ) || [];
  for (const candidate of candidates) {
    const normalized = normalizeXHSURL(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

// [本地增强] 笔记发布时间戳（ms）→ YYYY-MM-DD
function formatPublishDate(timestamp) {
  const value = Number(timestamp);
  if (!value || Number.isNaN(value)) {
    return "";
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

// [本地增强] 互动数：小红书返回的是字符串，空值统一成 "0"
function normalizeCount(value) {
  if (value === undefined || value === null || value === "") {
    return "0";
  }

  return String(value);
}

// [本地增强] 文件名安全化：保留中文 / 英文 / 数字 / emoji，仅剔除文件系统不安全字符
function sanitizeFilenamePreserveEmoji(text) {
  let sanitized = String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .trim();

  sanitized = sanitized.length > 0 ? sanitized : "Untitled";

  // 按码点截断，避免把 emoji 的代理对切断
  return Array.from(sanitized).slice(0, 50).join("");
}

// [本地增强] 轻量国际化：跟随 Obsidian 界面语言，中文环境用中文，其余回退英文
function detectLangIsZh() {
  try {
    const stored = window.localStorage?.getItem("language") || "";
    if (stored) {
      return /^zh/i.test(stored);
    }
    const momentLocale = window.moment?.locale?.() || "";
    if (momentLocale) {
      return /^zh/i.test(momentLocale);
    }
  } catch (_error) {
    // 读不到就按中文处理（本插件的主要使用环境）
  }
  return true;
}

const IS_ZH = detectLangIsZh();

const I18N = {
  zh: {
    noticeNoUrl: "没在文本里找到有效的小红书链接。",
    noticeImported: (path) => `已导入小红书笔记：${path}`,
    noticeImportFailed: (msg) => `导入失败：${msg}`,
    noticeNoNoteData: "小红书没有返回笔记数据。可能是分享链接已过期，或页面结构有变化。",
    noticeMediaFailed: (msg) => `图片下载失败：${msg}`,
    noticeNoVideoUrl: "没找到视频直链，只导入了封面图。",
    modalTitle: "导入小红书笔记",
    modalPasteLabel: "粘贴分享文本或链接：",
    modalPlaceholder: "例如：64 不叫小黄了发布了一篇小红书笔记……",
    modalDownloadLabel: "本次导入同时下载图片到本地",
    modalImportButton: "导入",
    setNoteFolderName: "笔记保存目录",
    setNoteFolderDesc: "导入的笔记默认保存到这个目录。",
    setImageFolderName: "图片保存目录",
    setImageFolderDesc: "下载的图片默认保存到这个目录。",
    setDownloadName: "下载图片",
    setDownloadDesc: "开启后，笔记图片会下载到本地库。视频仍保留远程链接。",
    setFrontmatterHeading: "Frontmatter 字段",
    setPlaceholdersHint: "可用占位符：",
    setFieldName: (n) => `字段 ${n}`,
    setFieldDesc: "可编辑字段名、启用状态与排序。",
    setFieldKeyPlaceholder: "字段名",
    setEnableFieldTooltip: "启用此字段",
    setMoveUpTooltip: "上移",
    setMoveDownTooltip: "下移",
    setRemoveButton: "删除",
    setValueLabel: "默认值（YAML 原始写法，支持多行）",
    setAddFieldButton: "添加字段",
    ribbonTooltip: "导入小红书笔记",
    commandName: "导入小红书笔记",
  },
  en: {
    noticeNoUrl: "No valid Xiaohongshu URL found in the text.",
    noticeImported: (path) => `Imported Xiaohongshu note as ${path}`,
    noticeImportFailed: (msg) => `Failed to import note: ${msg}`,
    noticeNoNoteData:
      "Xiaohongshu returned no note data. The share link may have expired or the page format may have changed.",
    noticeMediaFailed: (msg) => `Failed to download media: ${msg}`,
    noticeNoVideoUrl: "Video URL not found; imported note with cover image only.",
    modalTitle: "Import Xiaohongshu note",
    modalPasteLabel: "Paste the share text below:",
    modalPlaceholder: "e.g., 64 不叫小黄了发布了一篇小红书笔记...",
    modalDownloadLabel: "Download images locally for this import",
    modalImportButton: "Import",
    setNoteFolderName: "Default note folder",
    setNoteFolderDesc: "Imported notes will use this folder by default.",
    setImageFolderName: "Default image folder",
    setImageFolderDesc: "Downloaded images will use this folder by default.",
    setDownloadName: "Download images",
    setDownloadDesc:
      "If enabled, note images are downloaded to the local vault. Videos remain remote links.",
    setFrontmatterHeading: "Frontmatter Fields",
    setPlaceholdersHint: "Supported placeholders:",
    setFieldName: (n) => `Field ${n}`,
    setFieldDesc: "Edit the field key, enable state, and order.",
    setFieldKeyPlaceholder: "Field key",
    setEnableFieldTooltip: "Enable field",
    setMoveUpTooltip: "Move up",
    setMoveDownTooltip: "Move down",
    setRemoveButton: "Remove",
    setValueLabel: "Default value (raw YAML value, multiline supported)",
    setAddFieldButton: "Add field",
    ribbonTooltip: "Import Xiaohongshu note",
    commandName: "Import Xiaohongshu note",
  },
};

const t = (key, ...args) => {
  const table = IS_ZH ? I18N.zh : I18N.en;
  const value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : I18N.en[key];
  if (typeof value === "function") {
    return value(...args);
  }
  return value !== undefined ? value : key;
};

// [本地增强] 正文行整理：小红书正文里常带「只有 tab / 空格」的伪空行与行尾空白。
// 纯空白行归一成空行，连续 3 个以上换行压成 2 个，避免脏数据进入笔记。
function normalizeContentLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => (/^\s+$/.test(line) ? "" : line.replace(/\s+$/g, "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createFieldId() {
  return `field-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createDefaultFrontmatterFields() {
  return [
    {
      id: createFieldId(),
      key: "aliases",
      value: "",
      enabled: true,
      order: 0,
    },
    {
      id: createFieldId(),
      key: "created",
      value: "{{date}}",
      enabled: true,
      order: 1,
    },
    {
      id: createFieldId(),
      key: "tags",
      value: "- 类型/摘录\n- 状态/待加工",
      enabled: true,
      order: 2,
    },
    {
      id: createFieldId(),
      key: "上级概念",
      value: "",
      enabled: true,
      order: 3,
    },
  ];
}

function splitVaultPath(vaultPath) {
  if (!vaultPath || vaultPath === ".") {
    return [];
  }

  return vaultPath.split("/").filter(Boolean);
}

function getVaultDirname(vaultPath) {
  const parts = splitVaultPath(vaultPath);
  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(0, -1).join("/");
}

function getVaultBasename(vaultPath) {
  const parts = splitVaultPath(vaultPath);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function getRelativeVaultPath(fromDirectory, toPath) {
  const fromParts = splitVaultPath(fromDirectory);
  const toParts = splitVaultPath(toPath);

  let sharedIndex = 0;
  while (
    sharedIndex < fromParts.length &&
    sharedIndex < toParts.length &&
    fromParts[sharedIndex] === toParts[sharedIndex]
  ) {
    sharedIndex += 1;
  }

  const upSegments = new Array(fromParts.length - sharedIndex).fill("..");
  const downSegments = toParts.slice(sharedIndex);
  const segments = upSegments.concat(downSegments);

  return segments.length > 0 ? segments.join("/") : getVaultBasename(toPath);
}

class XiaohongshuImporterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("book", t("ribbonTooltip"), async () => {
      const result = await this.promptForShareText();
      if (!result || !result.text) {
        return;
      }

      const url = this.extractURL(result.text);
      if (!url) {
        new Notice(t("noticeNoUrl"));
        return;
      }

      await this.importXHSNote(url, result.downloadMedia);
    });

    this.addCommand({
      id: "import",
      name: t("commandName"),
      callback: async () => {
        const result = await this.promptForShareText();
        if (!result || !result.text) {
          return;
        }

        const url = this.extractURL(result.text);
        if (!url) {
          new Notice(t("noticeNoUrl"));
          return;
        }

        await this.importXHSNote(url, result.downloadMedia);
      },
    });

    this.addSettingTab(new XiaohongshuSettingTab(this.app, this));
  }

  normalizeFrontmatterFields(fields) {
    const safeFields = Array.isArray(fields) && fields.length > 0 ? fields : createDefaultFrontmatterFields();

    return safeFields
      .map((field, index) => ({
        id: field?.id || createFieldId(),
        key: typeof field?.key === "string" ? field.key : "",
        value: typeof field?.value === "string" ? field.value : "",
        enabled: field?.enabled !== false,
        order: Number.isInteger(field?.order) ? field.order : index,
      }))
      .sort((left, right) => left.order - right.order)
      .map((field, index) => ({
        ...field,
        order: index,
      }));
  }

  async loadSettings() {
    const loadedSettings = (await this.loadData()) || {};
    let shouldSave = false;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);

    if (!Array.isArray(loadedSettings.frontmatterFields) || loadedSettings.frontmatterFields.length === 0) {
      this.settings.frontmatterFields = createDefaultFrontmatterFields();
      shouldSave = true;
    } else {
      const normalizedFields = this.normalizeFrontmatterFields(loadedSettings.frontmatterFields);
      this.settings.frontmatterFields = normalizedFields;

      const needsNormalization = normalizedFields.some((field, index) => {
        const originalField = loadedSettings.frontmatterFields[index] || {};
        return (
          field.id !== originalField.id ||
          field.order !== originalField.order ||
          field.key !== originalField.key ||
          field.value !== originalField.value ||
          field.enabled !== originalField.enabled
        );
      });

      shouldSave = shouldSave || needsNormalization;
    }

    if (typeof this.settings.noteFolder !== "string") {
      this.settings.noteFolder = DEFAULT_SETTINGS.noteFolder;
      shouldSave = true;
    }

    if (typeof this.settings.imageFolder !== "string") {
      this.settings.imageFolder = DEFAULT_SETTINGS.imageFolder;
      shouldSave = true;
    }

    if (typeof this.settings.downloadMedia !== "boolean") {
      this.settings.downloadMedia = DEFAULT_SETTINGS.downloadMedia;
      shouldSave = true;
    }

    if (shouldSave) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    this.settings.frontmatterFields = this.normalizeFrontmatterFields(this.settings.frontmatterFields);
    await this.saveData(this.settings);
  }

  async promptForShareText() {
    return new Promise((resolve) => {
      new XiaohongshuImportModal(this.app, this.settings, resolve).open();
    });
  }

  extractURL(text) {
    return extractXHSURL(text);
  }

  sanitizeFilename(text) {
    // [本地增强] 保留 emoji 与中文标点，只剔除文件系统不安全字符
    return sanitizeFilenamePreserveEmoji(text);
  }

  sanitizeNoteFilename(text) {
    let sanitized = text.replace(/[/\\?%*:|"<>]/g, "-").trim();
    sanitized = sanitized.length > 0 ? sanitized : "Untitled";
    // [本地增强] 按码点截断，避免把 emoji 的代理对切断
    return Array.from(sanitized).slice(0, 50).join("");
  }

  async ensureFolder(folderPath) {
    const normalized = normalizePath(folderPath || "");
    if (!normalized) {
      return;
    }

    if (await this.app.vault.adapter.exists(normalized)) {
      return;
    }

    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  buildVaultFilePath(folderPath, fileNameWithExtension) {
    if (!folderPath || folderPath.trim() === "") {
      return normalizePath(fileNameWithExtension);
    }

    return normalizePath(`${folderPath}/${fileNameWithExtension}`);
  }

  async getUniqueFilePath(folderPath, baseName, extension) {
    let candidate = this.buildVaultFilePath(folderPath, `${baseName}.${extension}`);
    let counter = 1;

    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = this.buildVaultFilePath(folderPath, `${baseName}-${counter}.${extension}`);
      counter += 1;
    }

    return candidate;
  }

  async getUniqueMediaPath(folderPath, baseName, extension) {
    let candidate = this.buildVaultFilePath(folderPath, `${baseName}.${extension}`);
    let counter = 1;

    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = this.buildVaultFilePath(folderPath, `${baseName}-${counter}.${extension}`);
      counter += 1;
    }

    return candidate;
  }

  getExtensionFromUrl(url, fallbackExtension) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || "";
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      return match ? match[1].toLowerCase() : fallbackExtension;
    } catch (_error) {
      return fallbackExtension;
    }
  }

  async downloadMediaFile(url, folderPath, filenameBase, fallbackExtension) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const extension = this.getExtensionFromUrl(url, fallbackExtension);
      const targetPath = await this.getUniqueMediaPath(folderPath, filenameBase, extension);
      const bytes = await (await response.blob()).arrayBuffer();

      await this.app.vault.adapter.writeBinary(targetPath, bytes);
      return targetPath;
    } catch (error) {
      console.log(`Failed to download media from ${url}: ${error.message}`);
      new Notice(t("noticeMediaFailed", error.message));
      return url;
    }
  }

  toMarkdownAssetPath(vaultPath) {
    if (vaultPath.startsWith("http")) {
      return vaultPath;
    }

    // [本地增强] 强制写成库根绝对路径（以 / 开头）。
    // 不带 / 会被 Markdown 当成相对当前笔记的路径，导致图片引不到。
    const normalized = normalizePath(vaultPath);
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  buildPlaceholderContext({ title, source, date, videoUrl, note }) {
    const interact = note?.interactInfo || {};

    return {
      date: date || "",
      title: title || "",
      source: source || "",
      videoUrl: videoUrl || "",
      // [本地增强] 以下占位符均为无登录抓取即可获得的字段
      noteId: note?.noteId || "",
      author: note?.user?.nickname || "",
      authorId: note?.user?.userId || "",
      publishDate: formatPublishDate(note?.time),
      ipLocation: note?.ipLocation || "",
      noteType: note?.type || "",
      likedCount: normalizeCount(interact.likedCount),
      collectedCount: normalizeCount(interact.collectedCount),
      commentCount: normalizeCount(interact.commentCount),
      shareCount: normalizeCount(interact.shareCount),
      noteTags: (note?.tagList || [])
        .map((tag) => (typeof tag === "string" ? tag : tag?.name || ""))
        .filter(Boolean)
        .join(" "),
    };
  }

  replacePlaceholders(value, context) {
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
      Object.prototype.hasOwnProperty.call(context, key) ? context[key] : _match,
    );
  }

  buildFrontmatter(context) {
    const lines = ["---"];
    const fields = this.normalizeFrontmatterFields(this.settings.frontmatterFields).filter((field) => field.enabled);

    for (const field of fields) {
      const key = (field.key || "").trim();
      if (!key) {
        continue;
      }

      const resolvedValue = this.replacePlaceholders(field.value || "", context);
      if (resolvedValue.trim() === "") {
        lines.push(`${key}:`);
        continue;
      }

      if (resolvedValue.includes("\n")) {
        lines.push(`${key}:`);
        for (const line of resolvedValue.split("\n")) {
          lines.push(`  ${line}`);
        }
        continue;
      }

      lines.push(`${key}: ${resolvedValue}`);
    }

    lines.push("---");
    return `${lines.join("\n")}\n`;
  }

  async importXHSNote(url, downloadMedia) {
    try {
      const html = (
        await requestUrl({
          url,
          headers: { ...XHS_REQUEST_HEADERS },
        })
      ).text;
      const note = this.getNoteDetail(html);
      if (!note) {
        throw new Error(t("noticeNoNoteData"));
      }

      const title = this.extractTitle(html, note);
      const videoUrl = this.extractVideoUrl(html, note);
      const images = this.extractImages(html, note);
      const content = this.extractContent(html, note);
      const isVideo = this.isVideoNote(html, note);
      const today = new Date().toISOString().split("T")[0];

      const noteFolder = (this.settings.noteFolder || "").trim();
      const imageFolder = (this.settings.imageFolder || "").trim();
      await this.ensureFolder(noteFolder);
      if (downloadMedia) {
        await this.ensureFolder(imageFolder);
      }

      const sanitizedTitle = this.sanitizeFilename(title);
      const noteBaseName = this.sanitizeNoteFilename(isVideo ? `[V]${title}` : title);
      const notePath = await this.getUniqueFilePath(noteFolder, noteBaseName, "md");
      const frontmatterContext = this.buildPlaceholderContext({
        title,
        source: url,
        date: today,
        videoUrl,
        note,
      });

      let markdown = `${this.buildFrontmatter(frontmatterContext)}# ${title}\n\n`;

      if (isVideo) {
        if (images.length > 0) {
          let coverImage = images[0];
          if (downloadMedia) {
            const downloadedCover = await this.downloadMediaFile(
              images[0],
              imageFolder,
              `${sanitizedTitle}-cover`,
              "jpg",
            );
            coverImage = this.toMarkdownAssetPath(downloadedCover);
          }
          markdown += `[![Cover Image](${coverImage})](${url})\n\n`;
        }

        if (videoUrl) {
          markdown += `[Video Link](${videoUrl})\n\n`;
        } else {
          new Notice(t("noticeNoVideoUrl"));
        }

        const cleanedContent = normalizeContentLines(content.replace(/#\S+/g, ""));
        markdown += `${cleanedContent}\n\n`;

        const tags = this.extractTags(content);
        if (tags.length > 0) {
          markdown += "```\n";
          markdown += tags.map((tag) => `#${tag}`).join(" ");
          markdown += "\n```\n";
        }
      } else {
        let localImagePaths = [];
        if (images.length > 0) {
          if (downloadMedia) {
            for (let index = 0; index < images.length; index += 1) {
              const downloadedImage = await this.downloadMediaFile(
                images[index],
                imageFolder,
                `${sanitizedTitle}-${index}`,
                "jpg",
              );
              localImagePaths.push(this.toMarkdownAssetPath(downloadedImage));
            }
          } else {
            localImagePaths = images;
          }

          markdown += `![Cover Image](${localImagePaths[0]})\n\n`;
        }

        const cleanedContent = content.replace(/#[^#\s]*(?:\s+#[^#\s]*)*\s*/g, "").trim();
        markdown += `${cleanedContent.split("\n").join("\n")}\n\n`;

        const tags = this.extractTags(content);
        if (tags.length > 0) {
          markdown += "```\n";
          markdown += tags.map((tag) => `#${tag}`).join(" ");
          markdown += "\n```\n\n";
        }

        // [本地增强] 第 0 张已作封面插入，此处跳过避免重复
        const restImagePaths = localImagePaths.slice(1);
        if (restImagePaths.length > 0) {
          markdown += `${restImagePaths.map((assetPath) => `![Image](${assetPath})`).join("\n")}\n`;
        }
      }

      const createdFile = await this.app.vault.create(notePath, markdown);
      await this.app.workspace.getLeaf(true).openFile(createdFile);
      await this.saveSettings();
      new Notice(t("noticeImported", notePath));
    } catch (error) {
      console.log(`Failed to import note from ${url}: ${error.message}`);
      new Notice(t("noticeImportFailed", error.message));
    }
  }

  extractTitle(html, note = this.getNoteDetail(html)) {
    const noteTitle = typeof note?.title === "string" ? note.title.trim() : "";
    if (noteTitle) {
      return noteTitle;
    }

    const match = html.match(/<title>(.*?)<\/title>/);
    return match ? match[1].replace(" - 小红书", "") : "Untitled Xiaohongshu Note";
  }

  parseInitialState(html) {
    const match = html.match(/window\.__INITIAL_STATE__=(.*?)<\/script>/s);
    if (!match) {
      return null;
    }

    try {
      const json = match[1].trim().replace(/undefined/g, "null");
      return JSON.parse(json);
    } catch (error) {
      console.log(`Failed to parse initial state: ${error.message}`);
      return null;
    }
  }

  getNoteDetail(html) {
    const state = this.parseInitialState(html);
    if (!state?.note?.noteDetailMap) {
      return null;
    }

    return (
      Object.values(state.note.noteDetailMap)
        .map((entry) => entry?.note)
        .find(Boolean) || null
    );
  }

  extractImages(html, note = this.getNoteDetail(html)) {
    if (!note?.imageList) {
      return [];
    }

    return note.imageList
      .map((image) => image.urlDefault || "")
      .filter((imageUrl) => imageUrl && imageUrl.startsWith("http"));
  }

  extractVideoUrl(html, note = this.getNoteDetail(html)) {
    const video = note?.video;

    if (!video?.media?.stream) {
      return null;
    }

    if (video.media.stream.h264 && video.media.stream.h264.length > 0) {
      return video.media.stream.h264[0].masterUrl || null;
    }

    if (video.media.stream.h265 && video.media.stream.h265.length > 0) {
      return video.media.stream.h265[0].masterUrl || null;
    }

    return null;
  }

  extractContent(html, note = this.getNoteDetail(html)) {
    const htmlMatch = html.match(/<div id="detail-desc" class="desc">([\s\S]*?)<\/div>/);
    if (htmlMatch) {
      return (
        htmlMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\[话题\]/g, "")
          .replace(/\[[^\]]+\]/g, "")
          .trim() || "Content not found"
      );
    }

    if (!note?.desc) {
      return "Content not found";
    }

    return (
      note.desc
        .replace(/\[话题\]/g, "")
        .replace(/\[[^\]]+\]/g, "")
        .trim() || "Content not found"
    );
  }

  isVideoNote(html, note = this.getNoteDetail(html)) {
    return note?.type === "video";
  }

  extractTags(text) {
    return (text.match(/#\S+/g) || []).map((tag) => tag.replace("#", "").trim());
  }
}

class XiaohongshuSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async moveField(index, direction) {
    const fields = this.plugin.normalizeFrontmatterFields(this.plugin.settings.frontmatterFields);
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= fields.length) {
      return;
    }

    [fields[index], fields[targetIndex]] = [fields[targetIndex], fields[index]];
    this.plugin.settings.frontmatterFields = fields.map((field, order) => ({
      ...field,
      order,
    }));

    await this.plugin.saveSettings();
    this.display();
  }

  async deleteField(index) {
    const fields = this.plugin.normalizeFrontmatterFields(this.plugin.settings.frontmatterFields);
    fields.splice(index, 1);
    this.plugin.settings.frontmatterFields = fields.map((field, order) => ({
      ...field,
      order,
    }));
    await this.plugin.saveSettings();
    this.display();
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // [本地增强] 标明当前为本地改造版本
    containerEl.createEl("p", {
      text:
        "[本地增强版] 已新增占位符：publishDate / author / authorId / likedCount / collectedCount / " +
        "commentCount / shareCount / ipLocation / noteType / noteTags / noteId；" +
        "并修复了封面图重复、图片文件名丢 emoji 两个问题。",
      cls: "xhs-frontmatter-hint",
    });

    new Setting(containerEl)
      .setName(t("setNoteFolderName"))
      .setDesc(t("setNoteFolderDesc"))
      .addText((text) =>
        text.setPlaceholder("00.收集箱").setValue(this.plugin.settings.noteFolder).onChange(async (value) => {
          this.plugin.settings.noteFolder = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setImageFolderName"))
      .setDesc(t("setImageFolderDesc"))
      .addText((text) =>
        text.setPlaceholder("附件/XHS").setValue(this.plugin.settings.imageFolder).onChange(async (value) => {
          this.plugin.settings.imageFolder = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setDownloadName"))
      .setDesc(t("setDownloadDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.downloadMedia).onChange(async (value) => {
          this.plugin.settings.downloadMedia = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: t("setFrontmatterHeading") });
    containerEl.createEl("p", {
      text:
        t("setPlaceholdersHint") +
        " {{date}}, {{title}}, {{source}}, {{videoUrl}}, {{noteId}}, " +
        "{{author}}, {{authorId}}, {{publishDate}}, {{ipLocation}}, {{noteType}}, " +
        "{{likedCount}}, {{collectedCount}}, {{commentCount}}, {{shareCount}}, {{noteTags}}.",
      cls: "xhs-frontmatter-hint",
    });

    const fields = this.plugin.normalizeFrontmatterFields(this.plugin.settings.frontmatterFields);
    fields.forEach((field, index) => {
      const fieldContainer = containerEl.createDiv({ cls: "xhs-field-setting" });

      new Setting(fieldContainer)
        .setName(t("setFieldName", index + 1))
        .setDesc(t("setFieldDesc"))
        .addText((text) =>
          text.setPlaceholder(t("setFieldKeyPlaceholder")).setValue(field.key).onChange(async (value) => {
            this.plugin.settings.frontmatterFields[index].key = value.trim();
            await this.plugin.saveSettings();
          }),
        )
        .addToggle((toggle) =>
          toggle.setTooltip(t("setEnableFieldTooltip")).setValue(field.enabled).onChange(async (value) => {
            this.plugin.settings.frontmatterFields[index].enabled = value;
            await this.plugin.saveSettings();
          }),
        )
        .addButton((button) =>
          button.setIcon("arrow-up").setTooltip(t("setMoveUpTooltip")).setDisabled(index === 0).onClick(async () => {
            await this.moveField(index, -1);
          }),
        )
        .addButton((button) =>
          button
            .setIcon("arrow-down")
            .setTooltip(t("setMoveDownTooltip"))
            .setDisabled(index === fields.length - 1)
            .onClick(async () => {
              await this.moveField(index, 1);
            }),
        )
        .addButton((button) =>
          button.setButtonText(t("setRemoveButton")).setWarning().onClick(async () => {
            await this.deleteField(index);
          }),
        );

      const valueWrapper = fieldContainer.createDiv({ cls: "xhs-field-value-wrapper" });
      valueWrapper.createEl("label", {
        text: t("setValueLabel"),
        cls: "xhs-field-value-label",
      });

      const textarea = valueWrapper.createEl("textarea", { cls: "xhs-field-value" });
      textarea.value = field.value;
      textarea.rows = Math.max(3, field.value.split("\n").length + 1);
      textarea.addEventListener("change", async () => {
        this.plugin.settings.frontmatterFields[index].value = textarea.value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText(t("setAddFieldButton")).onClick(async () => {
        this.plugin.settings.frontmatterFields.push({
          id: createFieldId(),
          key: "newField",
          value: "",
          enabled: true,
          order: this.plugin.settings.frontmatterFields.length,
        });
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }
}

class XiaohongshuImportModal extends Modal {
  constructor(app, settings, onSubmit) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.result = null;
    this.downloadMedia = settings.downloadMedia;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.addClass("xhs-modal-content");
    contentEl.createEl("h2", { text: t("modalTitle") });

    const textRow = contentEl.createEl("div", { cls: "xhs-modal-row" });
    textRow.createEl("p", { text: t("modalPasteLabel") });
    const textarea = textRow.createEl("textarea", {
      cls: "xhs-modal-textarea",
      attr: {
        placeholder: t("modalPlaceholder"),
      },
    });

    const toggleWrapper = contentEl
      .createEl("div", { cls: ["xhs-modal-row", "xhs-download-row"] })
      .createEl("div", { cls: "xhs-download-wrapper" });

    const checkboxId = "download-media-checkbox";
    const checkbox = toggleWrapper.createEl("input", {
      attr: { type: "checkbox", id: checkboxId },
    });
    checkbox.checked = this.downloadMedia;
    checkbox.addEventListener("change", () => {
      this.downloadMedia = checkbox.checked;
    });

    toggleWrapper.createEl("label", {
      text: t("modalDownloadLabel"),
      cls: "xhs-download-label",
      attr: { for: checkboxId },
    });

    contentEl
      .createEl("div", { cls: ["xhs-modal-row", "xhs-button-row"] })
      .createEl("button", { text: t("modalImportButton"), cls: "xhs-submit-button" })
      .addEventListener("click", () => {
        this.result = {
          text: textarea.value.trim(),
          downloadMedia: this.downloadMedia,
        };
        this.close();
      });

    textarea.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.result = {
          text: textarea.value.trim(),
          downloadMedia: this.downloadMedia,
        };
        this.close();
      }
    });
  }

  onClose() {
    this.onSubmit(this.result);
  }
}

module.exports = {
  default: XiaohongshuImporterPlugin,
  __test: {
    XHS_REQUEST_HEADERS,
    cleanURLCandidate,
    extractXHSURL,
    normalizeXHSURL,
    // [本地增强] 新工具函数一并导出，便于回归测试
    formatPublishDate,
    normalizeCount,
    sanitizeFilenamePreserveEmoji,
  },
};

/* nosourcemap */