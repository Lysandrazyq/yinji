# 印迹 · 照片水印 —— 项目说明（CLAUDE.md）

> 本文件供 AI（Claude）在每次参与本项目开发时**最先阅读**。
> 它说明项目是什么、各标准文件在哪、以及必须遵守的工作规矩。

---

## 一、项目概况

「印迹」是一个运行在浏览器里的**照片水印网页 App**，主要面向 iPhone Safari，可"添加到主屏幕"当原生 App 用。

核心能力：给照片加一条**白框黑字**的底栏水印（类似 OPPO / 徕卡相机水印）。支持两种文字来源——手动输入、或自动读取照片 EXIF（设备、时间、光圈、快门、ISO、焦段），一键切换、实时预览。所有处理都在用户手机**本地**完成，照片不上传。

项目负责人是**非程序员**。沟通和交付都要照顾这一点（见第三节）。

---

## 二、项目结构与文件路径

```
yinji/
├── CLAUDE.md                 ← 本文件(工作总指引)
├── watermark.html            ← 应用本体(单文件,HTML+CSS+JS 全部内联)
├── manifest.webmanifest      ← PWA 元数据(App 名 / 图标 / 主题色)
├── sw.js                     ← PWA service worker(离线缓存)
├── package.json              ← Node 依赖清单(Tauri / Capacitor)
├── icons/                    ← PWA 图标
│   ├── icon.svg              ← 普通图标
│   └── icon-mask.svg         ← maskable(安卓自适应)
├── docs/                     ← 标准文档(开工前按需阅读),每份 .md + .docx 双格式
│   ├── requirements.md / .docx       ← 需求、范围、路线图
│   ├── tech.md         / .docx       ← 技术选型、实现要点、平台接口、PWA
│   ├── design.md       / .docx       ← 视觉规范、配色、模板样式
│   ├── steps.md        / .docx       ← 开发 / 自检 / 部署 / 协作流程
│   ├── cross-platform.md / .docx     ← Win / 安卓 / PWA 打包指南(详细)
│   ├── tauri.conf.example.json       ← Windows Tauri 配置范例
│   └── capacitor.config.example.json ← 安卓 Capacitor 配置范例
├── tools/
│   └── md2docx.py            ← 把 docs/*.md 重新生成同名 .docx(改完 md 后跑一下)
└── devlog/                   ← 每日开发记录,文件名 YYYY-MM-DD.md
```

> `.docx` 是给负责人用 Word 打开看的,**由 .md 自动生成**,不要手动编辑。改完任何一份 .md,交付前都要跑 `python tools/md2docx.py` 重新生成(详见 `docs/steps.md` 3.5 节)。

> **跨平台**:核心永远是 `watermark.html`。PWA / Tauri / Capacitor 三种"装上"方式都只是套壳,不改核心。平台差异通过 `window.Yinji.platform.*` 接口注入,详见 `docs/cross-platform.md`。

> `.docx` 是给负责人用 Word 打开看的，**由 .md 自动生成**，不要手动编辑。改完任何一份 .md，交付前都要跑 `python tools/md2docx.py` 重新生成（详见 `docs/steps.md` 3.5 节）。

各文档用途速查：
- 改需求 / 加功能前 → 读 `docs/requirements.md`
- 动代码前 → 读 `docs/tech.md`
- 调样式 / 配色 / 排版前 → 读 `docs/design.md`
- 不确定怎么测、怎么发布、怎么和负责人协作 → 读 `docs/steps.md`

---

## 三、给 AI 的工作规矩（每次都要遵守）

1. **先读后做**：开工先读本文件，再读 `docs/` 下相关标准文件，确认改动符合既有需求与规范，不凭空发挥。

2. **面向非程序员沟通**：用大白话，不堆术语；涉及取舍先讲清楚利弊；**改动前先确认需求，得到同意再执行**。交付时给清楚的"怎么用"步骤。

3. **单文件 + 零外部依赖**（重要，踩过坑）：App 必须是一个自包含的 HTML 文件，**不引入任何需要联网才能加载的外部资源**（如外链字体、CDN 脚本）。字体一律用系统字体栈。原因：外链资源会在手机内置浏览器里阻塞渲染，导致白屏。

4. **隐私优先**：所有照片处理留在本地，绝不上传照片到任何服务器。

5. **改完必自检**（详见 `docs/steps.md`）：至少做到 JS 语法检查、EXIF 解析用样张验证、水印排版肉眼检查。

6. **写当日开发日志**（这就是"每天自动记录"的落地方式）：**每次完成一轮开发后**，在 `devlog/` 下创建或更新当天的 `YYYY-MM-DD.md`，记录两部分——「今日完成」和「待办」。这一步每次都要做，不要遗漏。

---

## 四、当前状态（摘要，详情见最新开发日志）

- **第一版已上线**(devfile.cn 单文件托管,Safari 打开)。
- **15 种预设水印样式** + **用户自定义模板**(localStorage 持久):
  - 基础白款:经典、拍立得、宝丽来完全款、极简框、杂志浅版
  - 深色款:黑底白字、电影黑边、杂志封面、哈苏风
  - 彩色/特殊款:徕卡、节日红、复古胶片、签到打卡、大字日期、极简右下角
- **模板搜索**(右上角图标点开,中英文模糊搜索)+ 自定义模板编辑器。
- **PWA 已就位**:`manifest.webmanifest` + 图标 + service worker。多文件部署后(GitHub Pages 等)浏览器即可"安装到桌面/主屏"。
- **跨平台脚手架已就位**:`package.json` + Tauri / Capacitor 配置范例 + 详细打包指南(`docs/cross-platform.md`)。
- **平台接口**(`window.Yinji.platform`)预留:保存图片 / 选照片 / 存储抽象出来,以后接 Tauri / Capacitor 直接注入实现。

**主要待办**:
- 在用户机器上跑通 Tauri 出 Windows `.exe` + Capacitor 出安卓 `.apk`(配置就位,等装工具链)
- PWA 真正部署到 GitHub Pages / Netlify
- 地点信息(GPS → 地名)、HEIC 兼容

> 最新进展与待办**以 `devlog/` 里最新一篇为准**。
