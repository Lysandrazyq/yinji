# 跨平台打包指南

> ⚠️ **2026-05-28 v2.3.0 决策**：**统一走 PWA 路线**（下面的方式 A）。
> 安卓 / iOS 的 Capacitor 原生打包**已弃用**（维护成本高、商店上架材料门槛大），相关文件与章节已从项目中移除。
> Windows Tauri（下面的方式 B）保留可选，但优先级低。

> 「印迹」的跨平台路线：**核心永远是 `watermark.html`** —— 1 个文件，内含全部 UI 和逻辑。
> 各平台只是把这个 HTML "套个壳" 让它看起来像原生 App。改 1 处，全部平台同步。

## 一、3 种"装上"方式

| 方式 | 平台 | 怎么装 | 难度 | 你需要装什么 |
|---|---|---|---|---|
| **A. PWA**（推荐） | iOS / 安卓 / Win / Mac | 浏览器打开网址 → 安装到桌面/主屏 | 零成本 | 无，只要浏览器 |
| **B. Tauri**（可选） | Windows | 生成 `.exe` 安装包，双击安装 | 中 | Rust + Node.js + WebView2（系统自带） |
| **C. PWA + iOS Safari** | iOS / macOS | Safari → 分享 → 添加到主屏 | 零成本 | iPhone / iPad |

> **不推荐**：用 Swift / Kotlin / WPF 给每个平台原生重写 —— 单人维护是灾难，且违背"核心一份代码"原则。
> **安卓 `.apk`（Capacitor）已弃用**：PWA 在安卓 Chrome 上"添加到主屏"体验已足够；上架材料（软著 / 商店审核）对个人非程序员门槛太高。

**你没有 Mac**：做不了 iOS / macOS 的原生打包（必须 Mac + 苹果开发者账号 $99/年）。iOS / macOS 用户走方式 C（PWA via Safari）即可。这其实够用，iPhone 上"添加到主屏"和原生 App 体验非常接近。

## 二、方式 A：PWA（立刻可用）

**项目里已经预置好了** —— `manifest.webmanifest` + `icons/` + `sw.js` 都已就位，`watermark.html` 也已链接它们。

**用户体验**：

- **Windows / macOS Edge / Chrome**：打开网址 → 地址栏右边出现"安装"图标 → 点一下，变成桌面 App，有自己的窗口和图标，无地址栏。
- **安卓 Chrome**：打开网址 → 底部弹"添加到主屏" → 装上，和原生 App 几乎一样，可全屏、能离线。
- **iOS Safari**：打开网址 → 分享按钮 → "添加到主屏" → 出现图标，可全屏。

**重要前提**：**网页必须从 HTTPS 上提供**，且**多文件部署**（manifest 和 icons 要能被浏览器请求到）。

- 只能上传 1 个 HTML 的托管（如部分免费空间）**不能完整 PWA**（没有 manifest / icons / sw.js 就只装得上，装不离线）。
- 想要完整 PWA，用支持整文件夹上传的免费托管：**GitHub Pages**（本项目已用）、**Netlify**、**Cloudflare Pages** 都行。

### 上 GitHub Pages 的步骤（最简单，本项目已采用）

1. 注册 GitHub 账号（github.com），装 GitHub Desktop（可选，无脑界面）。
2. 新建一个 public 仓库，叫 `yinji`。
3. 把 `yinji/` 整个文件夹的内容（`watermark.html`、`manifest.webmanifest`、`icons/`、`sw.js`）上传到仓库根目录。
4. 仓库 Settings → Pages → Source 选 `main` 分支 → Save。
5. 等 1 分钟，得到网址：`https://你的用户名.github.io/yinji/watermark.html`
6. 把这个网址给用户，打开就能"安装"。

> 本项目正式版网址：`https://lysandrazyq.github.io/yinji/watermark.html`

## 三、方式 B：Windows `.exe`（Tauri 打包，可选）

**Tauri 是什么**：用 Rust 写的"WebView 套壳器" —— 把 `watermark.html` 用 Windows 自带的 Edge WebView2 显示，外面套个原生窗口和图标，打包成 `.exe` 安装包。包很小（2-5MB），启动很快。

### 一次性环境准备（只装一次）

1. **装 Rust**：打开 https://www.rust-lang.org/zh-CN/tools/install → 下 `rustup-init.exe` → 一路 Enter，默认选项即可。装完打开 PowerShell 输 `rustc --version`，有版本号就对了。
2. **装 Node.js**（LTS 版）：https://nodejs.org/zh-cn → 默认安装。装完 `node --version`、`npm --version` 都有版本号即可。
3. **WebView2** 通常已经在 Windows 10/11 上预装。如果没装，Tauri 会提示。

### 项目里要做的事

1. 在项目根目录（`E:\yinji\yinji-project\yinji\`）打开 PowerShell。
2. 第一次运行：`npm install`（读 `package.json` 装 Tauri CLI）。
3. 初始化 Tauri：`npx tauri init` —— 按提示填：
   - App name: `印迹`
   - Window title: `印迹 · 照片水印`
   - Web assets relative path: `..`（指向 watermark.html 所在的项目根目录）
   - Dev server URL: 留空回车
   - Frontend dev command: 留空回车
   - Frontend build command: 留空回车
4. 这会生成 `src-tauri/` 文件夹，里面的 `tauri.conf.json` 可以参考 `docs/tauri.conf.example.json`（本项目预置的范例）做微调。
5. **开发模式**（实时预览）：`npx tauri dev` —— 会开一个 Windows 窗口，显示 watermark.html。
6. **打包安装包**：`npx tauri build` —— 几分钟后，在 `src-tauri/target/release/bundle/msi/` 下生成 `印迹_1.0.0_x64_zh-CN.msi`（Windows 安装包）。双击安装。

### 重新打包

每次改完 `watermark.html`，只需要重新跑 `npx tauri build` 即可。配置不用改。

## 四、平台差异要注意的地方

`watermark.html` 在不同平台 WebView 里的行为有一些细微差异：

- **保存图片**：web / PWA 用 Web Share API「保存到相册」（iOS「存储图像」/ 安卓「保存到相册」），不支持时退化为下载或"长按保存"。Tauri 可走 Rust 写文件 API —— 通过 `window.Yinji.platform.saveDataUrl` 接口替换（见 `tech.md` 平台接口章节）。
- **拍照 / 选照片**：web 用 `<input type=file>`。Tauri 可改用文件对话框。同样走 `window.Yinji.platform.pickPhoto` 接口替换。
- **持久化**（自定义模板）：统一走 `localStorage`，各平台 WebView 都支持。`window.Yinji.platform.getStorage()` 返回的就是它。

**这意味着**：核心 `watermark.html` 一份代码，不动核心逻辑；每个平台只是在外面加一个"原生 API 实现"，注入到 `window.Yinji.platform.*` 上。

## 五、优先级建议

1. **主线，已完成**：`yinji/` 整个文件夹放到 GitHub Pages，用 Edge / Chrome / 安卓 Chrome / iOS Safari 测试 PWA 安装。这一步不写代码，只是部署。
2. **可选，出 Windows .exe**：按上面方式 B 走一遍。机器装 Rust + Node 后，后续每次打包只要一行命令。
3. **iOS / macOS**：走 PWA（方式 A / C）即可。

## 六、问题排查

- **PWA 装不上**：可能没用 HTTPS，或 manifest 路径错。打开浏览器 DevTools → Application → Manifest 看错误。
- **Tauri `npx tauri init` 报 "rustc not found"**：Rust 没装好。重开 PowerShell（让 PATH 生效）再试。
- **打包出来的 App 字体丑**：可能 WebView 没拿到中文字体。Tauri 在 Win 上一般没问题（系统字体）。
