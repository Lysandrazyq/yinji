# 技术说明

> 记录"印迹"怎么实现、用到什么、有哪些坑。动代码前请读本文件。

## 1. 技术选型

- **纯原生**：单个 HTML 文件，内联 CSS + 原生 JavaScript（ES5 风格写法，`var` / `function`，兼容老旧 Safari）。
- **无构建步骤**：不用打包工具，双击即运行，方便非程序员维护和部署。
- **无外部依赖**（关键约束）：不引用外链字体、CDN 脚本等任何需联网资源。字体用系统字体栈（`-apple-system, "PingFang SC", …`）。
  - 原因：曾因外链 Google 字体在手机内置浏览器里阻塞渲染导致整页白屏。教训 → 一律自包含。

## 2. 主要模块

- **照片载入**：`<input type="file" accept="image/*">`（iOS 会同时给"相册 / 拍照 / 选取文件"）。
- **图像解码与方向校正**：优先 `createImageBitmap(file, {imageOrientation:"from-image"})` 自动校正 EXIF 旋转；不支持时回退到 `createImageBitmap(file)`，再回退到 `<img>` 元素。
- **EXIF 解析**：自写的轻量解析器，直接读 JPEG 的 APP1 / TIFF 结构，提取标签：
  - IFD0：Make(0x010F)、Model(0x0110)、Exif 指针(0x8769)
  - ExifIFD：DateTimeOriginal(0x9003)、FNumber(0x829D)、ExposureTime(0x829A)、ISO(0x8827)、FocalLength(0x920A)
  - 全程 try/catch，解析失败返回 null → 自动切回手动模式。
- **水印渲染**:用 Canvas 2D。`draw()` 按 `state.style` 通过 `DRAW_DISPATCH` 字典分发到对应的 `drawXxx`。
  - **底栏类**(经典 / 拍立得 / 徕卡 / 宝丽来 / 黑底白字 / 电影黑边 / 复古胶片 / 节日红 / 哈苏风 / 极简框 / 杂志浅版)走统一的 `drawText(ox, oy, w, barH, opts)` 文字渲染,`opts` 可覆盖文字色 / 软字色 / 自动模式分隔线色 / 字重。
  - **自定义布局**(杂志 / 大字日期 / 极简右下角 / 签到打卡)自己画文字,因为它们的版式独特。
  - 颜色统一从 `COLORS` 全局调色板取,新加样式直接用名字,不撒色值。
  - 字体:正文 `FONT` 用无衬线栈,宝丽来落款 `SERIF` 用衬线栈做手写感。

- **模板搜索 + 自定义**:
  - 预设登记在 `TEMPLATES` 数组,每项有 `id / name / desc / tags`,描述和标签支持中英文模糊搜索。
  - 用户自定义模板写入 `localStorage` 的 `yinji.customTemplates.v1` 键,运行时合并到搜索列表,带「我的」徽章 + 删除按钮。
  - 自定义模板有 `layout` 字段(`bar` / `frame` / `overlay`),由 `drawCustom(tpl)` 分发到 `drawCustomBar` / `drawCustomFrame` / `drawCustomOverlay`。这三个绘制函数都读 `tpl.bg / text / textSoft / accent` 等参数,所以**新加一种"布局类型"** 等于多支持一类自定义。
  - 颜色辅助:`hexToRgb()`、`mixSoft()` 用来给自定义模板算"软字色"(文字色 + 底色按 55:45 混合,看着像灰)。

## 6.5 平台接口（window.Yinji.platform）

为跨平台预留的注入点:

```js
window.Yinji.platform = {
  name: "web",
  saveDataUrl: null,    // null = 默认 web 流程(Web Share「保存到相册」/ 下载兜底);Tauri 可覆盖
  pickPhoto: null,      // null = 默认 <input type=file>;原生可覆盖为相机 / 相册 API
  getStorage: fn        // 默认返回 localStorage;原生可换为 sqlite / file
};
```

各平台的"原生壳"在加载 `watermark.html` **之前**注入自己的实现:

- **Tauri**:在 `src-tauri/src/main.rs` 里注册 Rust 命令,然后用 `tauri.conf.json` 的 `initialization_script` 在 webview 启动时注入一段 JS 设 `window.Yinji.platform.saveDataUrl = ...`。

> 安卓 Capacitor 路线已于 v2.3.0 弃用(改为统一 PWA),此处不再给出注入示例。Web / PWA 的"保存到相册"默认走 **Web Share API**(`navigator.share({files})`),iOS 上即"存储图像",不支持时退化为下载。

**关键约定**:核心 `watermark.html` 永远是平台无关的,所有平台差异都注入到 `window.Yinji.platform.*`。

## 6.7 导出管线（v2.7.0）

保存时按所选画质产出图片,并尽量保留原图的拍摄信息(EXIF):

- **三档画质**:标准 JPEG(`toDataURL("image/jpeg",0.92)`)/ 高清 JPEG(`0.98`)/ 无损 PNG(`toDataURL("image/png")`,无 EXIF)。
- **EXIF 保留**:加载照片时,从原文件抽出一段可直接拼接的 `APP1`(Exif)字节:
  - JPEG 源:原样拷贝其 `APP1` 段。
  - HEIC/HEIF 源:从 ISOBMFF 容器里取出内嵌 TIFF 块,包成新的 `APP1`。
  导出 JPEG 时把这段 `APP1` 插到 `SOI`(`FFD8`)之后即可。
- **方向陷阱**:`createImageBitmap(file,{imageOrientation:"from-image"})` 已经把像素摆正,所以再拼回的 EXIF 必须把 `Orientation`(0x0112)写成 1,否则查看器会二次旋转。
- **保存到相册**:`navigator.share({files:[File]})`,必须在点击手势的同步调用栈里触发(延迟到 `setTimeout` 会丢失 iOS 用户激活,分享面板打不开)。

## 6.8 v2.8.0 新增实现要点

- **玻璃磨砂(downscale-upscale)**:`ctx.filter="blur()"` 在 iOS Safari 的 canvas 2D 上几乎不生效(桌面 Chrome 正常)。改用 `frostDraw / frostRect / frostRound`——把目标区域 `drawImage` 到极小离屏 canvas(宽 ≈ `ww/24`),再开 `imageSmoothingQuality="high"` 平滑放大回原尺寸,降采样丢高频 = 等效强模糊,全平台一致;放大时叠 `ctx.filter="saturate(155%) brightness(1.06)"`(`typeof` 守卫)提亮。
- **复制到剪贴板**:`navigator.clipboard.write([new ClipboardItem({"image/png":blob})])`,PNG 兼容面最广。和 `navigator.share` 同理,blob 必须在 click 手势同步栈内生成(`dataURLToUint8(canvas.toDataURL("image/png"))`),否则 iOS 丢用户激活。特性门控 `window.ClipboardItem && navigator.clipboard.write`,不支持就隐藏按钮。
- **记住上次选择**:`localStorage` 键 `yinji.prefs.v1` 存 `{style, mode, quality}`。另设 `prefMode` 记录用户的模式「意图」——避免被 EXIF 自动→手动回退污染:`setMode(mode, silent)` 仅在 `!silent`(真人点击)时记 `prefMode`。bootstrap 里 `initPrefs()` 还原(带 `DRAW_DISPATCH[id] || findCustomTemplate(id)` 守卫,跳过已删除的自定义模板)。
- **长按看原图**:`setTimeout` 220ms 触发 `drawOriginalOnly()`(只画 bmp、不加水印),移动 >10px 取消;`touchstart / touchmove` 用 `{passive:true}` 不挡页面滚动;松手 `draw()` 恢复。CSS `-webkit-touch-callout:none` 压掉 iOS 长按系统菜单。

## 6.9 v2.8.1 新增实现要点

- **主样式条可自挑(segPins)**:新增 `localStorage` 键 `yinji.segPins.v1`,存一个**有序的模板 id 数组**(被钉到主条的)。惰性加载 `var segPins=null`,`loadSegPins()` 读不到 / 解析失败 / 非数组都回落 `defaultPins()`。
  - **首跑默认 = 旧行为**:`defaultPins() = SEG_PRESETS.concat(所有自定义模板 id)`——老用户升级后主条完全不变,零回归。
  - 辅助:`saveSegPins / isPinned / addPin / removePin / togglePin`。`togglePin` 移除前守卫 `segPins.length<=1`(至少留一个,避免主条空掉);改完同时 `renderStyleSeg()` + `renderSearchResults()` 双刷新。
  - `renderStyleSeg()` 改为**遍历 `segPins`**(而非 `SEG_PRESETS` + 全部自定义):`presetById(id)` → 预设按钮、`findCustomTemplate(id)` → `.custom-tpl` 按钮、都不命中(陈旧 id,如已删自定义)静默跳过。
  - 「更多模板」面板每张卡加 `data-pin` 星标按钮(`☆ 常用 / ★ 常用`);点击委托里 `pin` 分支**置于最前** + `stopPropagation`,避免冒泡到选样式。
  - 自定义模板进出自动化:`customSave` 新建分支、`doImport` 推入后各加 `addPin(tpl.id)`;`deleteCustomTemplate` 加 `removePin(id)`。
- **「复制图片」按钮位置**:从单独一行移进 `.row`,和「下载文件」「关闭」并排(三个 `flex:1` ghost)。顺带补 `.sheet a.btn[hidden],.sheet button.btn[hidden]{display:none;}`——因为作者样式 `.sheet button.btn{display:block}` 会压过 UA 的 `[hidden]{display:none}`,导致 `hidden` 失效,需更具体的作者规则夺回。

## 6.10 v2.9.0 新增实现要点(设置面板 / 深色模式 / 新手引导)

- **统一设置对象 `yinji.settings.v1`**:惰性 `var settings=null` + `defaultSettings()`(`theme/rememberLast/defaultTextMode/defaultQuality/longPress/defaultText/fixedText/autoFields{6 项}/maxEdge`)。`loadSettings()` 把存储值**合并到默认值之上**(逐键校验,`autoFields` 逐项只收 boolean),对部分 / 损坏数据健壮。`ensureSettings()` 供在 bootstrap 前运行的消费者(`getSize`、日期预填)用。**刻意不合并** `yinji.glass / yinji.prefs.v1 / yinji.segPins.v1` 三个老键。
- **设置项收口在已有函数里**(一处改、全局生效):`applyDefaultText()`(默认水印文字)、`chooseInitialMode()`(默认文字模式,`loadFile` 调用)、`getSize()` 读 `maxEdge`、`buildInfo()` 用 `autoFields` 门控六字段(屏显 + 所有底栏样式同源)、长按 `begin()` 门控 `longPress`、`initPrefs()` 按 `rememberLast` 决定是否还原 + `defaultQuality` 打底。
- **主题(`body[data-theme]`)**:`resolveDark()` 读 `settings.theme`,`auto` 走 `matchMedia('(prefers-color-scheme: dark)')`;`applyTheme()` 把 body 设成**显式** `light`/`dark`(auto 在 JS 解析掉,CSS 只认两态)+ 同步 `<meta name=theme-color>`。监听 `matchMedia change`(仅 `theme==="auto"` 重应用;兼容老 Safari `addListener`)。CSS:`body[data-theme="dark"]` 重定义调色板 + 玻璃 token + 暖深色径向渐变,并对少数硬编码浅色面板逐一给深色替身;`body[data-theme="dark"][data-glass="off"]`(特异度 0,2,1)处理"深色 + 关玻璃"= 纯深色实底。**canvas 水印输出不受任何主题影响**。
- **设置 UI 接线**:`segSelect(seg,attr,v)` 标 `.on`、`segBind(seg,attr,cb)` 事件委托;`syncSettingsUI()` 打开面板时回灌所有控件;各绑定写设置 → `saveSettings()` → 重应用副作用(`applyTheme`/`applyLongPressHint`/`renderAutoPanel`+`draw`/`draw`)。`默认水印文字` 刻意不即时覆盖正在编辑的文本(下张生效)。数据动作:重置常用栏(`segPins=defaultPins()`)、清空模板(`confirm`+逐个 `removePin`+样式回落 `classic`)、恢复默认(`settings=defaultSettings()`,不动模板 / 常用栏 / 玻璃)。
- **新手引导(`#onboardOverlay`)**:`ONB_STEPS`(4 步)+ 圆点进度,末步按钮变「开始用」、跳过隐藏;`yinji.onboarded.v1` 标记是否看过,`initOnboard()` 首跑 `setTimeout(startOnboarding,450)`;设置「关于」可重看。**故意不**点背景关闭(首跑要做选择)。全程内联、零外链、自动吃当前 `data-theme`/`data-glass`。
- **入口**:头部 `.header-actions` 容器并排「更多模板」+ 齿轮 `#settingsBtn`;液态玻璃开关从「更多模板」面板**移入**设置「外观」段(同一个 `#glassToggle` id,既有 init / change handler 不变)。

## 6.11 v2.9.1 新增实现要点 + 3.0 AI 接口预留

- **「+」按钮文案化**:主样式条 new-tpl-btn `+` → `＋ 添加模板`,CSS 字号 / padding 下调与样式条齐高,功能不变(仍 `openCustomEditor(null)`)。
- **默认打开模板(`settings.defaultStyle`)**:取值 `"last"`(用上次的)| 预设 id | 自定义 id。设置「打开照片时」加原生 `<select id="defStyleSel">`,`buildDefStyleOptions()` 动态填充(全部预设 + 当前自定义)。`initPrefs()` 重构:style 只在 `defaultStyle==="last"` 时还原"上次";指定具体样式则**覆盖**,且与 `rememberLast` 无关。默认 `"last"` 完全保持旧行为。
- **导出文件名**:`exportFilename(ext)` → `印迹_YYYY-MM-DD_样式名.ext`(正则剥除非法字符与空白),替换 `saveAlbumBtn` / `downloadLink` 两处硬编码。
- **4 款新预设(26→30)**:`SEASON.grad / morandi / solarTerm` + `BRAND.canon`,复用 `drawSeasonStyle` / `drawBrandStyle`;`TEMPLATES` / `DRAW_DISPATCH` / `CAT_IDS` 同步。无新绘制逻辑,零风险。

### 3.0 AI 接入接口（已预留，2.x 不产生行为、不联网）

3.0 主打 AI。为避免到时返工,本版先把"接入位置"搭好,作为 `window.Yinji.platform` 的姊妹命名空间:

```js
window.Yinji.ai = {
  version: "3.0-reserved",
  available: false,                  // 3.0 注册 provider 后才 true
  register: function(feature){...},  // feature = { id, label, run(ctx) }
  list: function(){...},
  run: function(id){...}             // 2.x:无注册 → 恒 no-op
};
window.Yinji.getContext = function(){
  // 交给 AI 功能的只读快照,故意不含 bitmap / 原始像素
  return { version, hasPhoto, style, mode, text };
};
```

**隐私底线(3.0 必须遵守,先写死在这里以免日后走样)**:

- 照片绝不静默上传。`getContext()` 只给元信息(是否有图 / 当前样式 / 模式 / 文字),**不含像素**;需要像素的 AI 能力必须在当次操作里**显式、单独**向用户申请,拒绝则该能力不可用。
- 优先**端上**实现(本地推理 / 轻量规则),保持单文件 + 零外链;若某能力确需联网,必须:① 明确告知会上传什么、传给谁;② 默认关闭、用户主动开启;③ 不与"本地处理"的默认体验混淆。
- 任何联网 AI 都不得成为核心功能的前置——断网 / 拒绝授权时,2.x 的水印能力必须照常可用。

UI 上本版只放预告:设置面板「AI · 即将推出」段 + `#aiSoonBtn`(toast 预告),不暴露任何真实 AI 行为。

## 6.12 v2.9.2 新增实现要点（常用栏默认改空 / 对称齿轮）

- **常用栏默认空**:`defaultPins()` 由 `SEG_PRESETS.concat(customs)` 改为返回 `[]`。存储键 **bump** `yinji.segPins.v1` → `yinji.segPins.v2`,使新默认对老用户也立即生效(旧的自动预置清空一次;`customTemplates` / 照片 / 其它设置键不动)。新建 / 导入仍 `addPin` 自动入栏。
- **solo 大按钮**:`renderStyleSeg()` 在 `segPins` 为空时给 `.new-tpl-btn` 加 `solo` 类;CSS `.new-tpl-btn.solo{flex:1 1 auto;width:100%;display:flex;justify-content:center;font-size:16px;padding:15px 16px}` → 独占一行、居中放大。
- **取消"至少留一个"守卫**:`togglePin()` 删去 `segPins.length<=1` 的拦截,允许清到 0(`renderStyleSeg` 对空数组安全,无代码假设非空)。
- **对称齿轮**:`#settingsBtn` SVG 换成自绘 8 齿——一颗 `<rect>` 齿牙 `transform="rotate(k×45 12 12)"` 旋转 8 份(严格 8 重对称)+ 外环 `r6.6` / 内孔 `r2.7`,`stroke-width 1.7`,沿用 `.icon-btn svg{stroke:var(--ink)}` 描边风格。替换原 Feather `settings`(齿距不均、视觉偏斜)。
- 自检:`node --check` 通过、无外链资源;版本 → v2.9.2,`sw.js` cache → `yinji-v16-2026-05-31-v2.9.2`。

## 6.13 v2.12.0 新增实现要点（调色 Beta / 玻璃四周 / 选择模板）

> 2.0 大版本收官。三件事:① 调色(色调影调)Beta;② 玻璃四周新预设;③「添加模板」→「选择模板」。仍单文件 + 零外链。

- **调色 · 色调影调(Beta)—— `getSize()` 单点注入,35 款样式 + 导出零改动全继承**:
  - **核心架构**:照片只调一次色,结果缓存进离屏 canvas;`getSize()` 返回这块缓存 canvas 当 `bmp`。因为所有 `drawXxx` 都靠 `getSize()` 拿 `s.bmp` 再 `ctx.drawImage(s.bmp,…)`,导出 `buildExport()` 又读已绘制的 `canvas`,所以**调色一处注入,全部样式 + 导出自动吃到**,无需改任何绘制函数。
  - **为什么手动改像素而非 `ctx.filter`**:同 6.8 的磨砂教训——iOS Safari 对 canvas 不应用 `ctx.filter` 的颜色类滤镜(saturate / contrast / brightness 调色无效)。所以改走 `getImageData` / `putImageData` 逐像素算。
  - `state.tone`(默认 `"none"`);`TONE_LIST` 8 项(none 原图 / bw 黑白 / film 复古 / warm 暖阳 / cool 冷调 / fresh 清新 / gray 高级灰 / vivid 鲜艳);`TONE_PARAMS` 每款一组 `{sat,con,bri,temp,tint,lift}` 参数。
  - `applyTone(d,p)`:逐像素按**饱和度 → 色温/色调(temp 调 R/B、tint 调 G)→ 对比度 → 亮度 → 提亮暗部(lift)** 的固定顺序运算,全程 clamp 0–255。
  - `gradedBitmap(bmp,w,h)`:`tone==="none"` 直接返回原 `bmp`(零开销);否则按 `tone / w / h / src` 做缓存键,命中复用、未命中重算后存 `_gradeCache`。`getImageData` 包 try/catch——画布被污染(tainted)时回退原图、不抛错。
  - `invalidateGrade()`:换图 / 重置照片时清缓存(`reset` 处 `state.bitmap=null` 后补调一次),避免用旧图的调色结果。
  - **长按看原图**:`drawOriginalOnly()` 改为 `ctx.drawImage(state.bitmap,…)`——直接画**真·原始 bitmap**(既不调色也不加水印),和调色后的预览对照更直观。
  - **UI**:样式条下方加 `.tone-block`(「调色 · 色调影调」标签 + `.beta-tag` Beta 角标)+ `.tone-seg` chip 行;`renderToneSeg()` 生成芯片、`setTone(tone)` 切换并 `invalidateGrade()`+`draw()`。
  - **持久**:`savePrefs()` 写入 `tone:state.tone`;`initPrefs()` 校验 `p.tone==="none"||TONE_PARAMS[p.tone]` 后还原;IIFE 后调一次 `renderToneSeg()` 同步选中态。
  - **3.0 完整版预告**:本版只给现成几款一键套用。强度滑杆、更多胶片色、按样式记忆调色等留到 3.0 做完整版(与 AI 主线同期)。

- **玻璃四周(`glassFrame`)—— 复用 `frostRect` 的四边磨砂相框**:
  - `drawGlassFrame()`:四边各一条 `frostRect` 磨砂边(边宽 `m=max(22, min(w,h)*0.052)`),叠 `rgba(248,250,252,.16)` 提亮玻璃感;底栏 `barH=max(76, h*0.14)`(封顶 `h*0.4`)叠"上浅→下深"渐变承载文字;中间照片区描 `rgba(255,255,255,.55)` 细内框 + 顶部一条高光线。文字走 `drawText` 的白字配置。
  - 登记三处(漏一处就"搜得到画不出"或归错类):`DRAW_DISPATCH.glassFrame`、`TEMPLATES`(`{id:"glassFrame",name:"玻璃四周",desc,tags}`)、`CAT_IDS.glass` 追加 `glassFrame`(与 `glassBar` / `glassCard` 同「玻璃」分类)。

- **「添加模板」→「选择模板」(改名 + 改行为)**:
  - 顶部大按钮文案 / `title` / `aria-label` 全改「选择模板」;点击从 `openCustomEditor(null)`(直接进自建编辑器)改为 `openTemplatePicker()`(打开「更多模板」面板挑样式),更合直觉。
  - 抽出 `openTemplatePicker()`:清搜索框 → `searchCat="all"` → `renderCatRow()` + `renderSearchResults("")` → `.show` 面板 → 延时 focus;`searchBtn`(头部「更多模板」)也复用它,逻辑单点。
  - **自建入口不丢**:面板内仍有「＋ 新建我的模板」→ `openCustomEditor(null)`,自定义模板功能一个没少。新手引导文案同步成「…默认是个大大的「选择模板」按钮…」。

- 自检:`node --check` = SYNTAX_OK、grep 无外链资源;版本 → v2.12.0,`sw.js` cache → `yinji-v19-2026-06-01-v2.12.0`。

## 6.6 PWA 文件

- `manifest.webmanifest`:App 名字、图标、起始 URL、主题色
- `icons/icon.svg`(普通图标)、`icons/icon-mask.svg`(maskable,安卓自适应图标)
- `sw.js`:service worker,缓存 watermark.html + manifest + icons 实现离线。**改版上线务必 bump `CACHE` 名**(如 `yinji-v18-…-v2.11.0`)强制重新缓存。
- `watermark.html` 头部 `<link rel="manifest">` + `<link rel="apple-touch-icon">`,脚本末尾注册 `sw.js`。
- **「有新版本」更新提示**(v2.11.0):`sw.js` 的 `install` 不再自动 `skipWaiting()`,新版停在 `waiting`;只在收到页面 `postMessage({type:'SKIP_WAITING'})` 时才激活。`watermark.html` 注册段监听 `updatefound` / `reg.waiting`,有新版(且已有 `controller` = 是更新非首装)时弹底部 `.update-bar` 提示条;用户点「刷新」→ `postMessage` → `controllerchange` → `reload()`(用 `swReloading` 闸,只在用户主动触发时重载,避免首装 `clients.claim()` 误刷新)。**SW 模型的"隔一版生效":本版上线后老用户需手动刷新一次拿到 v2.11.0,之后的新版才会自动弹提示。**

**注意**:PWA 必须**多文件部署**(HTTPS + 整个 `yinji/` 文件夹)。DevFile.cn 只能上传单 HTML,在它上面 PWA 安装提示不出现。要完整 PWA 需要换 GitHub Pages / Netlify。详见 `docs/cross-platform.md`。
- **保存**：`canvas.toDataURL("image/jpeg", 0.92)` 生成图片，展示供长按"存储到照片"，并提供下载链接。

## 3. 兼容与体验注意事项

- **目标环境是 Safari**（真浏览器）。iOS「文件」App 的"快速预览"对 `<input type=file>` 支持差，会出现"选图无反应"——这不是 bug，部署成网址用 Safari 打开即可。
- 大图先按最长边封顶（约 2200px）缩放，避免手机内存压力；输出仍是高清图。
- 关键流程都有用户可见反馈：载入中、成功、失败原因都会显示在界面上，不静默失败。
- 重置文件 input 的时机放在加载流程结束之后，避免 iOS 上 File 引用被提前失效。

## 4. 性能与体积

- 整个 App 是单文件，约 20+ KB，纯本地运行，无网络请求（除首次打开网页本身）。

## 5. 部署

- 平台：**DevFile（devfile.cn）**——上传 HTML 即得 HTTPS 网址，无需服务器 / 域名。
- 更新方式：改完 HTML，重新上传覆盖即可（详见 `steps.md`）。

## 6. 自检清单（改完代码必做）

1. 提取内联 JS 做语法检查（如 `node --check`）。
2. 用带 EXIF 的样张验证"自动读取"字段是否正确。
3. 肉眼检查水印排版（不出框、不重叠）。
4. 确认文件内无任何外链资源（`grep` 检查 http/cdn 等）。
