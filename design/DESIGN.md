# ModPilot 设计说明（v2）

> 目标：把「一堆 jar 文件夹」变成「能直接装进 PCL 的整合包」。
> 现状：v1 是单文件 `index.html + app.js`，深色 UI，只能查 Modrinth。
> 本文件是 v2 的设计稿，确认后再动代码。

## 1. 三个站点的真实能力（先说清楚，避免白做）

| 站点 | 有无公开接口 | 浏览器能否直接调用 | 能做的事 |
|---|---|---|---|
| Modrinth | 有，`api.modrinth.com/v2`，CORS 全开 | 可以 | 搜索、查版本、取直链、取 sha1/sha512（打包必需） |
| CurseForge | 有，但必须带 `x-api-key` | 不行（密钥会暴露、跨域被拦） | 只能生成「搜索页 / 项目页」链接，点一下自己去看 |
| Planet Minecraft | 没有公开接口，且有 Cloudflare 防护 | 不行 | 只能生成「搜索页」链接 |

所以：**Modrinth = 全自动；CurseForge / PM = 一键跳转**。
如果以后一定要自动化 CurseForge，需要额外写一个本地小代理（Node/Python）替浏览器带密钥请求，属于第二阶段的可选项，不在本次范围。

## 2. 为什么「搜不到前置」

不是大小写问题，是**搜索词本身不是项目名**。举例：

- 依赖里写的是 `fabric_api_base`、`fabric_renderer_api_v1` —— 这是 Fabric API 的**子模块 ID**，不是项目 slug。
- 依赖里写的是 `mizunoky_mod` —— 项目 slug 是 `mizunoky`。
- Modrinth 的 `/v2/search` 只匹配标题 / slug / 描述，模糊搜 `fabric_api_base` 自然搜不到。

**解析策略（按顺序尝试，命中即停）**

1. **精确**：`GET /v2/project/{depId}` —— 直接把依赖 ID 当 slug 查。
2. **别名表**：本地维护一份常见库映射（`fabric_api_base → fabric-api`、`mod_minecraftforge → forge`…），先归一化。
3. **模糊**：`/v2/search?query=<候选>` 取前 10 条，把 slug / 标题做规范化（小写、去掉 `_ - 空格`）后比较；相似度 ≥ 阈值才算命中。
4. **降级**：都不中就显示「没自动匹配上」，给一个**可编辑的搜索框**（预填依赖 ID）+「重新匹配」按钮。
5. **记忆**：成功的「依赖 ID → 项目」写进 `localStorage`，下次直接命中。

第 4、5 条就是解决「我服了」的关键：自动失败时人只改一个词，改对了以后不再问。

## 3. 自动挑版本

按 `modId` 分组 → 过滤（加载器 ∈ 目标加载器、`mcRange` 覆盖目标版本）→ 排序：

1. 版本号高的优先（`mcRange` 完全匹配的优先于 `[x,)` 这种开放区间）
2. 正式版优先于 beta / alpha（版本号里含 `alpha/beta/pre` 降权）
3. 同分时：本地 jar 优先于在线版本（少下载一次）

- 只有一个候选 → 直接选中，行上不显示下拉框。
- 多个候选 → 显示下拉框，默认选推荐项，用户可以换。
- 一个都没有 → 标红「不兼容」，不进打包。

**只选必需前置**（`mandatory=true`）；可选前置（JEI、REI 这种）默认不加入，避免把整合包塞爆。

## 4. 打包格式

用 **`.mrpack`（Modrinth 整合包格式）**，PCL 2.13+ 可直接导入，其他启动器（HMCL、Prism、ATLauncher）也认。

```
modrinth.index.json      # 清单：每个文件一条
overrides/mods/*.jar     # 本地收集、Modrinth 上没有的 jar
overrides/config/...     # 预留
```

- **Modrinth 上的模组**：不下载文件，只写 `path / downloads[url] / hashes(sha1,sha512) / fileSize`，哈希直接取 `/v2/project/{id}/version` 返回值，**零流量**。
- **本地 jar**：浏览器里用 `crypto.subtle.digest` 算 SHA-1 / SHA-512，放进 `overrides/mods/`。
- 生成 zip 用自写的 `zip-writer.js`（不需要第三方库），打包时流式写入，避免一次性占满内存。
- 备选：如果以后要做「不给链接、纯本地」的包，可以再出一个普通 zip（`mods/` 文件夹 + 说明.txt），但 PCL 不会自动下载缺失项。

## 5. 代码结构（可维护是硬要求）

`file://` 下 ES Module 会被 CORS 拦，所以用**经典 script + 单一命名空间** `window.MC`，但按职责拆文件：

```
mod-checker/
├─ index.html                 只放结构，不放样式和逻辑
├─ css/
│  ├─ tokens.css              颜色/圆角/阴影/间距变量（改主题只改这里）
│  ├─ base.css                reset、字体、背景
│  └─ components.css          按钮/卡片/行/标签/下拉
├─ js/
│  ├─ core/zip-reader.js      中央目录 + ZIP64 + deflate-raw 解压
│  ├─ core/metadata.js        mods.toml / fabric.mod.json / mcmod.info
│  ├─ core/version.js         版本号比较、区间判断
│  ├─ core/analyzer.js        缺前置 / 重复 / 加载器 / MC 版本
│  ├─ core/selector.js        按 modId 选版本（第 3 节算法）
│  ├─ core/resolver.js        依赖 ID → 项目（第 2 节策略 + 缓存）
│  ├─ core/zip-writer.js      生成 zip（打包用）
│  ├─ pack/mrpack.js          组装 modrinth.index.json + overrides
│  ├─ api/modrinth.js         接口封装（含重试、限速）
│  ├─ api/links.js            CurseForge / PM 的搜索链接生成
│  ├─ ui/state.js             状态机（导入 → 分析 → 选择 → 打包）
│  ├─ ui/render.js            纯渲染函数（输入数据 → DOM 字符串）
│  ├─ ui/events.js            事件绑定
│  └─ main.js                 启动
├─ design/mockup.html         设计稿（本文件同目录）
└─ design/DESIGN.md
```

规则：
- `core/` 不碰 DOM，可在 Node 里直接单测。
- `ui/render.js` 只做「数据 → HTML」，不写业务判断。
- 所有网络请求集中在 `api/`，方便以后换代理。
- 样式全部走 `tokens.css` 变量，换主题不用翻组件。

## 6. 界面（见 mockup.html）

- 浅色：白底 + 粉/紫/蓝三向柔光背景，白色卡片、24px 圆角、淡紫阴影。
- 三个层级：**拖拽区（入口）→ 概览条（4 个数字）→ 左清单 + 右打包卡**。
- 状态用「颜色 + 图标 + 文字」三重表达（不只靠颜色，色弱也能看）。
- 缺前置卡片内联解决：匹配结果 + 换一个 + 可编辑搜索词，不跳页。
- 每行一个模组：色块图标 + 名称 + 版本 + 三个标签（加载器 / MC / 来源）+ 右侧版本下拉（仅多候选时出现）。
- 圆角、间距、字号全部走 4/8 的节奏，不做「皱巴巴」的密集堆叠。

## 7. 测试计划

- `core/` 用 Node 跑：用 `Mod/` 里真实的 94 个 jar 做回归样本（当前全部可解析）。
- 浏览器端：拖入真实文件夹 → 切加载器 → 改版本 → 生成 mrpack → 检查 zip 结构（用 `unzip -l` 或 Node 解）。
- 回归点：ZIP64 jar（Reminia 70k 条目）、`${file.jarVersion}` 占位符、`[[dependencies."modid"]]` 引号写法、`mandatory=false` 无引号布尔值。

## 8. 里程碑

- **M1 结构重做 + 浅色 UI**：拆文件、换主题、保留现有分析能力。
- **M2 自动选版本 + 多候选下拉**：`selector.js` + 行内下拉。
- **M3 打包**：`zip-writer.js` + `mrpack.js` + 下载按钮。
- **M4 多站点**：CurseForge / PM 搜索链接；`resolver.js` 别名表 + 记忆。
