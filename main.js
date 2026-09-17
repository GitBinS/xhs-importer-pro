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
  // [本地增强] 是否额外抓取作者主页以获取「小红书号」等信息
  fetchAuthorProfile: true,
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

// [批量] 单次导入上限与请求间隔（拟人化节流）
const BATCH_MAX_PER_RUN = 20;
const BATCH_DELAY_MIN_MS = 1500;
const BATCH_DELAY_MAX_MS = 3500;

// [批量] 已导入笔记索引文件名（存于插件目录，用于跨批次去重）
const IMPORT_INDEX_FILE = "imported-notes.json";

// [批量] 提取文本里的所有小红书链接：保持出现顺序，并按规范化 URL 去重
function extractAllXHSURLs(text) {
  const candidates =
    String(text || "").match(
      /https?:\/\/[^\s\u200B-\u200D\u2060\uFEFF<>"'`,，。；！？？、)\]}>）】》」』]+/giu,
    ) || [];

  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const normalized = normalizeXHSURL(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function randomBatchDelay() {
  const span = BATCH_DELAY_MAX_MS - BATCH_DELAY_MIN_MS;
  return BATCH_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    modalPlaceholder: "一行一条，可一次粘贴多条分享链接（也支持直接糊一大段文本）",
    modalCountEmpty: "还没有识别到小红书链接",
    modalCountHint: (n) => `已识别到 ${n} 条链接`,
    modalCountOver: (n, max) => `已识别到 ${n} 条链接，超出单次上限 ${max} 条，请分批导入`,
    modalDedupeHint: "已导入过的笔记会自动跳过（按笔记 ID 判断）。",
    modalDownloadLabel: "本次导入同时下载图片到本地",
    modalImportButton: "导入",
    modalImportCount: (n) => `导入 ${n} 条`,
    batchSummary: (ok, skipped, failed) =>
      `批量导入完成：成功 ${ok} 条，跳过重复 ${skipped} 条，失败 ${failed} 条`,
    batchProgress: (cur, total) => `正在导入第 ${cur}/${total} 条…`,
    batchFailedList: (titles) => `失败：${titles}`,
    noticeDuplicate: (title) => `已跳过重复笔记：${title}`,
    backfillCommand: "补抓作者的缺失信息",
    backfillNone: "没有需要补抓的笔记（authorRedId 都已有值或缺少 source）。",
    backfillStart: (n) => `开始补抓 ${n} 篇笔记的作者信息…`,
    backfillDone: (ok, fail) => `补抓完成：成功 ${ok} 篇，失败 ${fail} 篇`,
    backfillTip: "失败通常是主页被临时限流，稍后再执行一次即可。",
    setNoteFolderName: "笔记保存目录",
    setNoteFolderDesc: "导入的笔记默认保存到这个目录。",
    setImageFolderName: "图片保存目录",
    setImageFolderDesc: "下载的图片默认保存到这个目录。",
    setDownloadName: "下载图片",
    setDownloadDesc: "开启后，笔记图片会下载到本地库。视频仍保留远程链接。",
    setFetchAuthorName: "抓取作者小红书号",
    setFetchAuthorDesc:
      "额外访问一次作者主页，用于获取小红书号、作者简介、粉丝数与主页链接。同一作者只请求一次，结果会缓存。",
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
    modalPlaceholder: "One link per line. Multiple share links at once are supported.",
    modalCountEmpty: "No Xiaohongshu link detected yet",
    modalCountHint: (n) => `${n} link(s) detected`,
    modalCountOver: (n, max) => `${n} links detected, over the ${max}-per-run limit. Please split the batch.`,
    modalDedupeHint: "Notes that were already imported are skipped automatically (matched by note ID).",
    modalDownloadLabel: "Download images locally for this import",
    modalImportButton: "Import",
    modalImportCount: (n) => `Import ${n} note(s)`,
    batchSummary: (ok, skipped, failed) =>
      `Batch import finished: ${ok} imported, ${skipped} skipped as duplicate, ${failed} failed`,
    batchProgress: (cur, total) => `Importing ${cur} of ${total}...`,
    batchFailedList: (titles) => `Failed: ${titles}`,
    noticeDuplicate: (title) => `Skipped duplicate note: ${title}`,
    backfillCommand: "Backfill missing author info",
    backfillNone: "Nothing to backfill (authorRedId already filled, or source missing).",
    backfillStart: (n) => `Backfilling author info for ${n} note(s)...`,
    backfillDone: (ok, fail) => `Backfill finished: ${ok} updated, ${fail} failed`,
    backfillTip: "Failures are usually temporary profile rate limits — run it again later.",
    setNoteFolderName: "Default note folder",
    setNoteFolderDesc: "Imported notes will use this folder by default.",
    setImageFolderName: "Default image folder",
    setImageFolderDesc: "Downloaded images will use this folder by default.",
    setDownloadName: "Download images",
    setDownloadDesc:
      "If enabled, note images are downloaded to the local vault. Videos remain remote links.",
    setFetchAuthorName: "Fetch author profile",
    setFetchAuthorDesc:
      "Makes one extra request to the author's profile page to retrieve their Xiaohongshu ID, bio, follower count and profile link. Cached per author, so each author is requested once.",
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

// [本地增强] 作者主页信息缓存：同一作者只抓一次，避免重复请求
const authorProfileCache = new Map();

// [本地增强] 主页请求的最小间隔。主页接口对"连发"很敏感，
// 连发会被重定向到登录页；这里强制拉开间隔以提高成功率。
const AUTHOR_PROFILE_MIN_GAP_MS = 5000;
let lastAuthorProfileFetchAt = 0;

// [本地增强] 抓取作者主页，取「小红书号」等信息。
// 说明：小红书号（redId）只在用户主页下发，笔记页没有这个字段。
// 主页 URL 无需登录即可访问，但**有明显限流**：连续请求会被重定向到登录页，
// 因此这里自带重试 + 退避，并且「失败不写缓存」，以便后续重试。
async function fetchAuthorProfile(userId, options = {}) {
  if (!userId) {
    return null;
  }

  if (authorProfileCache.has(userId)) {
    return authorProfileCache.get(userId);
  }

  const maxAttempts = options.retries ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // 与上一次主页请求拉开最小间隔（带随机抖动），避免连发被限流
    const sinceLast = Date.now() - lastAuthorProfileFetchAt;
    if (sinceLast < AUTHOR_PROFILE_MIN_GAP_MS) {
      await sleep(AUTHOR_PROFILE_MIN_GAP_MS - sinceLast + Math.floor(Math.random() * 1500));
    }
    lastAuthorProfileFetchAt = Date.now();

    try {
      const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
      const html = (await requestUrl({ url, headers: { ...XHS_REQUEST_HEADERS } })).text;

      const match = html.match(/window\.__INITIAL_STATE__=(.*?)<\/script>/s);
      if (!match) {
        // 被限流重定向到登录页时会走到这里
        throw new Error("profile page returned no initial state (likely rate limited)");
      }

      // 主页的初始状态里含 `new Set([...])`，标准 JSON.parse 会失败，需先替换
      const cleaned = match[1]
        .trim()
        .replace(/undefined/g, "null")
        .replace(/new Set\(\[[^\]]*\]\)/g, "[]");

      const state = JSON.parse(cleaned);
      const basic = state?.user?.userPageData?.basicInfo;
      if (!basic) {
        throw new Error("profile page has no basicInfo");
      }

      const interactions = state?.user?.userPageData?.interactions || [];
      const pick = (type) => interactions.find((item) => item?.type === type)?.count || "";

      const profile = {
        redId: basic?.redId || "",
        nickname: basic?.nickname || "",
        desc: basic?.desc || "",
        ipLocation: basic?.ipLocation || "",
        fans: pick("fans"),
        follows: pick("follows"),
        likesAndCollects: pick("interaction"),
      };

      authorProfileCache.set(userId, profile);
      return profile;
    } catch (error) {
      console.log(`Author profile attempt ${attempt}/${maxAttempts} failed for ${userId}: ${error.message}`);
      if (attempt < maxAttempts) {
        // 退避后重试，间隔带随机抖动
        await sleep(2500 + Math.floor(Math.random() * 2500));
      }
    }
  }

  // [关键] 失败不写缓存 —— 否则一次限流会让该作者在整个会话内都无法再取到信息
  console.log(`Author profile unavailable for ${userId} after ${maxAttempts} attempts`);
  return null;
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

    // [批量] 统一的导入入口：1 条走单篇流程，多条走批量流程
    const runImport = async () => {
      const result = await this.promptForShareText();
      if (!result || !result.text) {
        return;
      }

      const urls = result.urls || extractAllXHSURLs(result.text);
      if (urls.length === 0) {
        new Notice(t("noticeNoUrl"));
        return;
      }

      if (urls.length === 1) {
        await this.importXHSNote(urls[0], result.downloadMedia);
        return;
      }

      await this.importBatch(urls, result.downloadMedia);
    };

    this.addRibbonIcon("book", t("ribbonTooltip"), runImport);

    this.addCommand({
      id: "import",
      name: t("commandName"),
      callback: runImport,
    });

    // [补抓] 为已导入但缺失作者信息的笔记回填
    this.addCommand({
      id: "backfill-author-info",
      name: t("backfillCommand"),
      callback: async () => {
        await this.backfillAuthorInfo();
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
      const extension = this.getExtensionFromUrl(url, fallbackExtension);
      const targetPath = this.buildVaultFilePath(folderPath, `${filenameBase}.${extension}`);

      // [本地增强] 图片已存在则直接复用，不重复下载。
      // 典型场景：笔记被删但图片还在，重新导入时不应产生 -1 / -2 副本。
      if (await this.app.vault.adapter.exists(targetPath)) {
        return targetPath;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

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

  buildPlaceholderContext({ title, source, date, videoUrl, note, authorProfile }) {
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
      // [本地增强] 以下字段来自作者主页（需额外一次请求，可在设置中关闭）
      authorRedId: authorProfile?.redId || "",
      authorDesc: authorProfile?.desc || "",
      authorIpLocation: authorProfile?.ipLocation || "",
      authorFans: authorProfile?.fans || "",
      authorUrl: note?.user?.userId
        ? `https://www.xiaohongshu.com/user/profile/${note.user.userId}`
        : "",
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

  async importXHSNote(url, downloadMedia, options = {}) {
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

      // [批量] 按 noteId 去重：仅当对应笔记**确实还在仓库里**才算重复。
      // 若笔记已被用户删除，索引项失效 → 清掉并正常重新导入。
      const noteId = note?.noteId || "";
      const existing = options.index ? options.index[noteId] : null;
      if (existing) {
        if (this.isIndexEntryAlive(existing)) {
          return { ok: false, skipped: true, title, noteId };
        }
        delete options.index[noteId];
      }
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
      // [本地增强] 可选：抓作者主页取「小红书号」等（同一作者有缓存，不会重复请求）
      const authorProfile =
        this.settings.fetchAuthorProfile === false ? null : await fetchAuthorProfile(note?.user?.userId);

      const frontmatterContext = this.buildPlaceholderContext({
        title,
        source: url,
        date: today,
        videoUrl,
        note,
        authorProfile,
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

        const cleanedContent = normalizeContentLines(
          content.replace(/#[^#\s]*(?:\s+#[^#\s]*)*\s*/g, ""),
        );
        markdown += `${cleanedContent}\n\n`;

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

      // [批量] 记入去重索引（含文件路径，便于后续校验笔记是否还在）
      if (options.index && noteId) {
        options.index[noteId] = {
          title,
          url,
          path: notePath,
          importedAt: new Date().toISOString(),
        };
      }

      if (!options.silent) {
        new Notice(t("noticeImported", notePath));
      }

      return { ok: true, skipped: false, title, noteId, path: notePath };
    } catch (error) {
      console.log(`Failed to import note from ${url}: ${error.message}`);
      if (!options.silent) {
        new Notice(t("noticeImportFailed", error.message));
      }
      return { ok: false, skipped: false, error: error.message, url };
    }
  }

  // [批量] 去重索引文件（放在插件目录，不污染 vault 内容区）
  getImportIndexPath() {
    return normalizePath(
      `${this.app.vault.configDir}/plugins/${this.manifest.id}/${IMPORT_INDEX_FILE}`,
    );
  }

  async loadImportIndex() {
    try {
      const raw = await this.app.vault.adapter.read(this.getImportIndexPath());
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  // [去重] 索引项是否仍然有效：对应的笔记文件必须还在 vault 里。
  // 用户把笔记删掉后索引项即失效，应当允许重新导入 —— 否则会出现
  // 「仓库里没有这篇笔记，却提示重复」的错误判断。
  isIndexEntryAlive(entry) {
    if (!entry) {
      return false;
    }

    if (entry.path) {
      return Boolean(this.app.vault.getAbstractFileByPath(entry.path));
    }

    // 旧版索引没有 path：用标题在全库反查同名笔记，找不到即视为已被删除
    if (!entry.title) {
      return true;
    }

    return this.app.vault
      .getMarkdownFiles()
      .some((file) => file.basename === entry.title || file.name === `${entry.title}.md`);
  }

  async saveImportIndex(index) {
    try {
      await this.app.vault.adapter.write(
        this.getImportIndexPath(),
        JSON.stringify(index, null, 2),
      );
    } catch (error) {
      console.log(`Failed to save import index: ${error.message}`);
    }
  }

  // [批量] 逐条导入：批内去重 → 随机节流 → 进度提示 → 末尾汇总
  async importBatch(urls, downloadMedia) {
    const index = await this.loadImportIndex();
    const total = urls.length;
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    const failedList = [];

    for (let i = 0; i < total; i += 1) {
      // 第 2 条起先等一段随机时间，避免连续请求
      if (i > 0) {
        await sleep(randomBatchDelay());
      }

      new Notice(t("batchProgress", i + 1, total), 1500);

      const result = await this.importXHSNote(urls[i], downloadMedia, {
        index,
        silent: true,
      });

      if (result?.ok) {
        ok += 1;
      } else if (result?.skipped) {
        skipped += 1;
      } else {
        failed += 1;
        failedList.push(result?.title || result?.error || urls[i]);
      }

      // 每条都落盘，中途中断也不丢已完成的记录
      await this.saveImportIndex(index);
    }

    new Notice(t("batchSummary", ok, skipped, failed), 8000);
    if (failedList.length > 0) {
      new Notice(t("batchFailedList", failedList.join(" / ")), 12000);
    }

    return { ok, skipped, failed };
  }

  // [补抓] 扫描笔记目录，为 authorRedId 为空的笔记补齐作者信息。
  // 用于：主页限流导致首次导入时漏抓，事后回填（重导会判重复，故单独提供入口）。
  async backfillAuthorInfo() {
    const folder = normalizePath((this.settings.noteFolder || "").trim());
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      if (!folder) {
        return true;
      }
      const parent = file.parent?.path || "";
      return parent === folder || parent.startsWith(`${folder}/`);
    });

    const targets = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) {
        continue;
      }

      const block = fmMatch[1];
      // 只挑 authorRedId 键后面为空的
      if (!/^authorRedId:\s*$/m.test(block)) {
        continue;
      }

      const sourceMatch = block.match(/^source:\s*(\S+)\s*$/m);
      if (!sourceMatch) {
        continue;
      }

      targets.push({ file, source: sourceMatch[1].trim() });
    }

    if (targets.length === 0) {
      new Notice(t("backfillNone"));
      return { ok: 0, fail: 0 };
    }

    new Notice(t("backfillStart", targets.length), 4000);
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < targets.length; i += 1) {
      new Notice(t("batchProgress", i + 1, targets.length), 1500);
      const { file, source } = targets[i];

      try {
        const html = (await requestUrl({ url: source, headers: { ...XHS_REQUEST_HEADERS } })).text;
        const note = this.getNoteDetail(html);
        const profile = await fetchAuthorProfile(note?.user?.userId);

        if (!profile?.redId) {
          fail += 1;
        } else {
          const current = await this.app.vault.read(file);
          const updated = current.replace(/^(authorRedId:\s*)$/m, `$1 ${profile.redId}`);
          if (updated !== current) {
            await this.app.vault.modify(file, updated);
            ok += 1;
          } else {
            fail += 1;
          }
        }
      } catch (error) {
        console.log(`Backfill failed for ${file.path}: ${error.message}`);
        fail += 1;
      }

      if (i < targets.length - 1) {
        await sleep(randomBatchDelay());
      }
    }

    new Notice(t("backfillDone", ok, fail), 8000);
    if (fail > 0) {
      new Notice(t("backfillTip"), 8000);
    }

    return { ok, fail };
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
        "[本地增强版] 已新增：作者小红书号／简介／粉丝数／主页链接、笔记发布时间、点赞收藏评论分享数、" +
        "以及引用修复（封面图重复、图片路径、文件名丢 emoji）。",
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

    new Setting(containerEl)
      .setName(t("setFetchAuthorName"))
      .setDesc(t("setFetchAuthorDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.fetchAuthorProfile !== false).onChange(async (value) => {
          this.plugin.settings.fetchAuthorProfile = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: t("setFrontmatterHeading") });
    containerEl.createEl("p", {
      text: t("setPlaceholdersHint"),
      cls: "xhs-frontmatter-hint",
    });
    containerEl.createEl("p", {
      text:
        "{{date}}, {{title}}, {{source}}, {{videoUrl}}, {{noteId}}, {{noteType}}, {{noteTags}}, " +
        "{{publishDate}}, {{ipLocation}}",
      cls: "xhs-frontmatter-hint",
    });
    containerEl.createEl("p", {
      text:
        "{{author}}, {{authorId}}, {{authorRedId}}, {{authorDesc}}, {{authorUrl}}, " +
        "{{authorFans}}, {{authorIpLocation}}",
      cls: "xhs-frontmatter-hint",
    });
    containerEl.createEl("p", {
      text: "{{likedCount}}, {{collectedCount}}, {{commentCount}}, {{shareCount}}",
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
        rows: "6",
      },
    });

    // [批量] 实时显示识别到的链接条数
    const countEl = textRow.createEl("p", {
      text: t("modalCountEmpty"),
      cls: "xhs-count-hint",
    });

    // [批量] 去重说明
    textRow.createEl("p", {
      text: t("modalDedupeHint"),
      cls: "xhs-dedupe-hint",
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

    const submitButton = contentEl
      .createEl("div", { cls: ["xhs-modal-row", "xhs-button-row"] })
      .createEl("button", { text: t("modalImportButton"), cls: "xhs-submit-button" });

    const submit = () => {
      const urls = extractAllXHSURLs(textarea.value);
      if (urls.length === 0) {
        return;
      }
      this.result = {
        text: textarea.value.trim(),
        urls,
        downloadMedia: this.downloadMedia,
      };
      this.close();
    };

    const updateState = () => {
      const count = extractAllXHSURLs(textarea.value).length;
      if (count === 0) {
        countEl.setText(t("modalCountEmpty"));
        countEl.toggleClass("is-warning", false);
        submitButton.setText(t("modalImportButton"));
        submitButton.disabled = true;
        return;
      }

      const over = count > BATCH_MAX_PER_RUN;
      countEl.setText(over ? t("modalCountOver", count, BATCH_MAX_PER_RUN) : t("modalCountHint", count));
      countEl.toggleClass("is-warning", over);
      submitButton.setText(t("modalImportCount", count));
      submitButton.disabled = over;
    };

    textarea.addEventListener("input", updateState);
    submitButton.addEventListener("click", submit);

    textarea.addEventListener("keypress", (event) => {
      // Ctrl/Cmd + Enter 提交；单独 Enter 用于换行（批量粘贴需要换行）
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });

    updateState();
    textarea.focus();
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
    extractAllXHSURLs,
    normalizeContentLines,
    BATCH_MAX_PER_RUN,
  },
};

/* nosourcemap */