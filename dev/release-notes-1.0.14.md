# XHS Importer Pro 1.0.14

> 本版只改一件事：**插件的显示名**。逻辑代码与 1.0.13 完全一致（`main.js` 逐字节相同）。

## 变更

- **显示名：`xhs-importer-pro` → `XHS Importer Pro`**
  与同作者的另一个插件 `XHS Product Search` 统一为「空格分隔 + 首字母大写」写法 —— 读起来更自然，在社区搜索里也更容易命中。

## 使用提示

- ⚠️ **插件 `id` 没有变**，仍是 `xhs-importer-pro`。你的插件配置、插件目录名、去重索引（`imported-notes.json`）全部以 `id` 为准 —— **不需要重装、不需要重设**。
- 更新后 Obsidian 里显示的名字会变成 **XHS Importer Pro**，但**插件文件夹名仍是 `xhs-importer-pro`**（目录名以 id 为准，这是正常的）。
- 本版**没有功能改动**；如果你对名字不敏感，跳过这版也不影响使用。

## 测试

`dev/verify.mjs` **43 项断言全部通过**（未改动逻辑，跑一遍确认无回归）。
