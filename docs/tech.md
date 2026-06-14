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

## 6.14 v2.13.0 新增实现要点（调色盘 / iPhone 16 Pro 风格 2D 调色盘）

> 把 6.13 的「8 款一键色调(Beta)」升级成**可手动微调**:在预设之上叠一层 `state.toneAdj`,用一块 iPhone 16 Pro 风格的 2D 调色盘 + 强度 / 饱和滑杆来调。**完全沿用 6.13 的 `getSize()` 单点注入管线**——36 款样式 + 导出零改动全继承,不碰任何绘制函数。这是 3.0「智能配色」(`roadmap-3.0.md` A1)的手动版地基:将来 AI 自动配色填的就是同一个 `state.toneAdj`。

- **微调层 `state.toneAdj{temp,tint,sat,intensity}`**(默认 `{0,0,0,100}` = 中性 + 强度满):
  - `effectiveParams()` 把**预设 + 盘子叠加**成最终参数喂给 `applyTone`:`base=TONE_PARAMS[tone]||中性`;`sat=base.sat*(1+adj.sat/100)`、`temp=base.temp+adj.temp*0.4`、`tint=base.tint+adj.tint*0.4`(±100 拖动 → ±40 实际偏移,手感不过冲)、`intensity=adj.intensity/100`。预设与盘子是**正交叠加**,可只用其一、也可叠着用。
  - `applyTone(d,p)` 加**强度混合 K**(`K=p.intensity`,0..1):逐像素先算出调色结果,再 `out=orig+(graded-orig)*K`。K=0 → 还原原片(强度滑杆拉到 0 = 原图),K=1 → 全量调色。
  - `clampNum(v,lo,hi,fallback)`:新加的健壮校验小工具,`initPrefs` 还原 `toneAdj` 各字段、`effectiveParams` / `gradeSig` 取值都过它,挡住 NaN / 越界 / 旧数据。
- **缓存与判定**:
  - `hasGrade()` = `(预设非 none ∥ 盘子 temp/tint/sat 任一非 0) 且 intensity>0`——否则 `gradedBitmap` 直接返原图(零开销;强度=0 也判为无调色)。
  - `gradeSig()` = `tone|temp|tint|sat|intensity`(全 clamp),盘子任一值变即换键 → `_gradeCache` 失效重算;签名 + `w/h/src` 命中才复用。`gradedBitmap()` 改以 `gradeSig()` 为键、`effectiveParams()` 为参,其余(离屏 canvas / tainted try-catch 回退)沿用 6.13。
- **UI——iPhone 16 Pro 风格 2D 调色盘(折叠在「调色盘 ▾」里)**:
  - `#toneToggle`(`调色盘 ▾`,`aria-expanded` / `aria-controls`)折叠 / 展开 `#tonePanel`(`.tone-dial.hidden{display:none}`),文字在 ▾ / ▴ 切。
  - `.dial-pad`(180×180,`touch-action:none` 防页面跟着滚):两层 `linear-gradient`(冷暖横轴 蓝→橙、色调纵轴 品红→绿)+ `background-blend-mode:multiply` 出盘面观感;`::before` / `::after` 十字准星;`#toneKnob`(26px 旋钮,`position:absolute` + `margin:-13px` 居中到落点)。
  - 落点 ↔ 参数:`placeToneKnob()` 把 (temp,tint) → `left=((temp+100)/2)%`、`top=((tint+100)/2)%`;`padPosToAdj(cx,cy)` 反向按 pad 矩形相对坐标算 `temp=round(x*200-100)`、`tint=round(y*200-100)`。
  - `.dial-sliders`:`#toneIntensity`(强度 0–100)、`#toneSat`(饱和 −100..100,`accent-color:var(--accent)`);`#toneReset`「复位调色盘」归中性。
  - **交互 `bindTonePad()`**:优先 **Pointer Events**(`setPointerCapture` 包 try/catch,失败回退 touch+mouse);pad `down` / `move` 实时 `padPosToAdj`→`syncTonePad`→`scheduleToneDraw`;滑杆 `input` 实时重绘、`change` 落 `savePrefs`。`scheduleToneDraw()` 用 `requestAnimationFrame` 节流(无 rAF 同步 `draw()` 兜底)避免拖动狂重绘;`syncTonePad()` 同步旋钮位置 + 滑杆值 + 标签。IIFE 内 `renderToneSeg()` 后调一次 `bindTonePad()`。
- **持久**:`savePrefs` 写 `toneAdj`;`initPrefs` 用 `clampNum` 逐字段校验还原。
- 自检:`node --check` = SYNTAX_OK、grep 无外链;版本 → v2.13.0,`sw.js` cache → `yinji-v20-2026-06-02-v2.13.0`。

## 6.15 v2.14.0 新增实现要点（滤镜系统 / 20 款分 6 类 / 随机一套 / 我的滤镜存分享导入）

> 把 6.13 的「8 款一键色调 + 调色盘微调」整体收编为**滤镜**——一档 built-in 滤镜 = 一整套完成观感,调色盘成了「在某套滤镜上再手动微调」的图层(Model B)。**完全沿用 6.13 / 6.12 的 `getSize()` 单点注入管线**:本版多出的 12 款预设只是往 `TONE_LIST` / `TONE_PARAMS` 加数据,**不碰任何绘制函数、不加逐样式逻辑**。这是 3.0 滤镜体系(`roadmap-3.0.md` A1)的地基。

- **命名 + 交互模型(Model B)**:
  - 全 UI「调色 / 色调」统一改叫**滤镜**;`tone-label` → `滤镜`、去掉 `.beta-tag` Beta 角标。
  - **built-in 选中即重置**:点内置滤镜把调色盘 `state.toneAdj` 归中性 + 清 `state.filterId`(它本就是完成态,不残留上一套手动微调)。
  - **手动动了 = 脱离选中**:`bindTonePad` 的 dial `down`、强度 `input`、饱和 `input`、`toneReset` 均调 `clearFilterSel()`——观感降级为「未保存的微调」,高亮取消,可再「＋ 存为滤镜」收藏。
  - `state.filterId`(string|null):仅指向当前选中的**自定义**滤镜(用于「我的」高亮 + 分享 / 删除目标);`savePrefs` 持久、`initPrefs` 还原前先 `findCustomFilter` 校验存在。
- **数据层——20 款预设分 6 类 + 自定义滤镜存储**:
  - `TONE_LIST` 扩到 21 项(含 none 原图),每项 `{id,name,cat}`;`TONE_PARAMS` 20 组 `{sat,con,bri,temp,tint,lift}` 沿用 6.12 同一套像素参数,**直接被 `effectiveParams()`→`gradedBitmap()` 单点注入消费**,新预设零额外代码。
  - `FILTER_CATEGORIES` 8 项:`all 全部 / film 胶片 / bw 黑白 / warm 暖调 / cool 冷调 / fresh 清新 / mood 氛围 / mine 我的`(按风格分 + 单独「我的」类);`var filterCat="all"` 记当前分类。
  - 自定义滤镜 = `{id,name,base,adj}`(base = 某 tone id 当底、adj = 调色盘 `{temp,tint,sat,intensity}`);`FILTERS_STORAGE_KEY="yinji.filters.v1"`、`customFilters[]`、`isValidCustomFilter()` 守卫、`loadCustomFilters` / `persistCustomFilters` / `findCustomFilter`。
- **UI——分类条 + chip 区 + 我的滤镜动作区**:
  - `tone-block` 重构:`滤镜` 标签 + `#filterRandBtn`(🎲 随机一套,`margin-left:auto`)、`#filterCats`(横向滚动分类条,隐藏滚动条)、`#toneSeg`(chip 行)、`#filterMineHint`(「我的」空态提示)、`#filterActions`(`#saveFilterBtn ＋存为滤镜` / `#importFilterBtn 导入滤镜` / `#shareFilterBtn 分享` / `#delFilterBtn 删除`.danger)。
  - `renderFilters()`(取代旧 `renderToneSeg()`):按 `filterCat` 过滤——`mine` 渲 `customFilters`(空则显 hint)、其余按 `TONE_LIST[].cat` 过滤内置;自定义 chip 加 `.custom-flt`(橙点 `::after`)。同步刷新分类条高亮 + 动作区显隐(`updateFilterActions`:有选中自定义才显分享 / 删除)。
  - `#filterSaveOverlay` 存名弹窗:`#filterName`(maxlength 12)+ 保存 / 取消;`#filterSaveDo` 校验非空 → 建 `{id:"flt_"+ts,name:slice(0,12),base:state.tone,adj:clamp(state.toneAdj)}` → push + persist + `filterCat="mine"` + `renderFilters` + `applyCustomFilter`。
- **分享码——type 路由(模板 / 滤镜共用一套编解码)**:
  - `encodeFilter(f)`:JSON `{v:1,type:"yinji-filter",flt:{name,base,adj clamp}}` → `btoa(unescape(encodeURIComponent(json)))`,沿用 `SHARE_PREFIX="YINJI1:"`(离线、纯本地)。
  - `decodeShareRaw(code)`:剥前缀 / 空白 → `atob` → `decodeURIComponent(escape())` → `JSON.parse`,返回**整个对象**(不再只返 tpl)。
  - `doImport()` 按 `raw.type==="yinji-filter" ∥ raw.flt` 路由:滤镜走 `importFilterObj(flt)`(校验 + 全新 `flt_` id + clamp adj + `isValidCustomFilter` 守卫 + push/persist + 切「我的」+ `applyCustomFilter`),否则走拆出的 `importTemplateObj(raw.tpl||raw)`;`openShare(mode,code,kind)` 按 `kind` 切「滤镜 / 模板」文案。删了死代码 `decodeTemplate`。
- **随机一套 `randomLook()`(🎲)**:守卫有图 → 随机 `TEMPLATES` 模板 + 随机一款非 none 内置滤镜(**模板 + 滤镜一起随机**),`toneAdj` 归中性、清 `filterId`、`filterCat="all"` → `renderFilters` + `syncTonePad` + `setStyle` → toast「换了一套:模板名 · 滤镜名」。用户无需自己挑。
- **持久**:`savePrefs` 写 `filterId`;`initPrefs` 还原(`findCustomFilter` 校验)。自定义滤镜单独存 `yinji.filters.v1`。
- 自检:`node --check` = SYNTAX_OK、grep 无外链;版本 → v2.14.0,`sw.js` cache → `yinji-v21-2026-06-02-v2.14.0`。浏览器预览(DOM 点击 + canvas 像素采样)过:21 chip / 8 分类 / 分类过滤 / 内置选中高亮 / 存为滤镜持久 + 「我的」选中 / 分享导入往返建副本 / 随机一套换图换调。

## 6.16 v3.0.0-beta.1 新增实现要点（智能配色 A1 / 端上启发式 / 3.0 第一个 AI 功能）

> 3.0「AI 主打」的首发功能。**纯端上启发式**——无神经网络、无模型下载、无联网。把照片缩到 48×48 采样统计 → 用规则映射成一组调色盘 `state.toneAdj` → 喂给 6.14 已有的 `syncTonePad()` + `effectiveParams()→gradedBitmap()` 管线。**渲染端零改动**:A1 只是"自动拨盘子",拨完和用户手动拖盘完全等价(同为「未保存的微调」,可复位 / 存为滤镜)。这是 `roadmap-3.0.md` A1 的落地。

- **采样 `analyzePhoto(bmp)`**(闭包私有):`document.createElement('canvas')` 48×48 → `drawImage` → `getImageData`(包 `try/catch`,跨域 taint 返 `null`),跳过 α<16 像素;累加平均 `r/g/b` + 每像素 HSV 饱和度 `(max-min)/max`;返回 `{r,g,b,luma=0.299r+0.587g+0.114b,sat=平均饱和}`。**缩图采样**避免在全分辨率上跑循环卡手机。
- **规则 `suggestToneAdj(info)`**(输出全在 ±100 盘坐标系,下手克制):
  - 冷暖:`warmth=r-b`;`tempFactor = warmth<0 ? 0.8 : 0.35`(**回暖比压冷更积极**,贴合暖调品牌、避免把暖照片洗白);`temp=clampNum(round(-warmth*tempFactor),-22,35,0)`。
  - 绿 / 品红:`greenCast=g-(r+b)/2`;`tint=clampNum(round(-greenCast*0.5),-18,18,0)`。
  - 饱和:`sat<0.18`(灰)→`+28`、`>0.55`(艳)→`-12`、其余→`+14`。
  - 强度:基准 `72`;`luma<45 ∥ >215`(过暗 / 过亮,均值不可信)→`60`。
- **动作 `smartColor()`**:守卫 `state.bitmap`(无图 toast)→ `suggestToneAdj(analyzePhoto(...))`(失败再 toast)→ `state.tone="none"`(从原图起步,这套色纯来自照片、不叠预设)+ `state.toneAdj=adj` + `state.filterId=null` → `syncTonePad()` + `markFilterActive()` + `updateFilterActions()` + `draw()` + `savePrefs()` → toast「已按这张照片配好色 ✨ 不满意点复位调色盘」。
- **UI**:`#tonePanel` 顶部插 `<button class="dial-smart" id="smartColorBtn">✨ 帮我配色<span class="sub">…</span></button>`;CSS `.dial-smart`(整宽、`var(--accent)` 底 + 白字、`.sub` 独占一行小字、`[disabled]` 灰显);`bindTonePad()` 末尾接 `smartColorBtn.addEventListener("click", smartColor)`(随其余调色盘控件一次性绑定)。
- **3.0 AI 接入位**:`window.Yinji.ai.register({id:"smartColor",label:"智能配色(端上)",onDevice:true,run:function(){return smartColor();}})` —— `ai.available` 翻 `true`、`ai.list()` 含 smartColor;run 全程本地、直接读已加载的 `state.bitmap`,不经 `getContext()` 取像素、不联网、不写盘。`getContext()` 增 `colorStats`(有图时 `{r,g,b,luma,sat,warm:r>b}`,整图聚合 / 四舍五入,**不可还原原图、非像素**;无图或分析失败为 `null`),延续 6.11「快照绝不含照片像素」铁律。
- 自检:`node --check` = SYNTAX_OK、grep 无 `http(s)://` / CDN / 外链字体;版本 → v3.0.0-beta.1,`sw.js` cache → `yinji-v22-2026-06-02-v3.0.0-beta.1`。浏览器预览(注入合成照 + DOM / canvas 采样)过:冷照回暖(temp 盘 +35、旋钮 67.5%、画面 R+8 / B−8 向暖)、暖照封顶压冷(temp 盘 −22、旋钮 39%)、旋钮 + 双滑杆 + 标签同步、复位回中性、AI 后手动滑杆仍生效、`colorStats` 正确、无 console 报错。

## 6.17 v3.0.0-beta.2 实现要点（UI 紧凑化 + 动效弹性 / 纯 CSS）

> 本轮**只动 CSS,零 JS / 零渲染管线改动**:目标是"手机一屏尽量放得下" + "动效更有弹性、手感更好"。所有改动都是等比收紧尺寸 + 一个新增缓动 token,功能 / 滤镜 / 导出 / 调色盘逻辑完全不变。

- **整体等比收紧(UI 紧凑化)**:`:root` 圆角 `--radius` 22→18px;`body` 底部安全区 padding +30→+20px;`header` 上下 padding 20/16→13/10px、品牌名 27→23px、副标 margin-top 7→5px;`.icon-btn` 44×44 圆角 14 → 40×40 圆角 13;`.drop`(空状态)padding 60/26→40/24、margin-top 6→4、圆环 72→58 / svg 32→27 / 标题 18→17;`.canvas-stage` padding 18→13 / margin-top 6→4;`.stage-hint` margin 9→7;`.panel` margin-top 16→11 / padding 18→14;`.seg button` padding 11/14→9/13、字号 14.5→14;`.tone-block` margin-top 14→10;`.dial-smart` padding 11/14→10/13、下边距 14→10;`.field` margin-top 16→11、文本框 padding 13/15→11/14;`.actions` margin-top 20→14、`.btn` padding 15→13;`#seg` 行内 margin-top 10→8。
- **动效弹性(`--spring`)**:`:root` 新增 `--spring:cubic-bezier(.34,1.5,.56,1)`(控制点 y=1.5>1 → 末段过冲回弹)。入场 `yj-fadeUp`(header / panel / drop)缓动由 `--ease` 换成 `--spring`,translateY 收尾略微越过 0 再回弹;`yj-scaleIn` 由单段改 **3 段过冲**(`0%` scale.93 → `55%` 1.018 → `100%` 1),仍配 `--ease`(非 spring)避免双重过冲;`.seg button` 过渡 `all .18s ease`→`all .2s var(--spring)`,`.btn` 过渡 `transform .12s`→`transform .16s var(--spring)`,按压更"弹"。**保留 `@media (prefers-reduced-motion: reduce)` 把动画时长压到 .01ms** 的无障碍兜底。
- **取舍**:UI 走**等比收紧而非重排布局**——风险最低、视觉关系与可发现性不变、零功能回归。落地后**横幅(4:3)照片可一屏放下,竖幅(3:4)因控件面板较高仍需轻滑**,这是刻意取舍(不为塞下竖幅牺牲控件可见性 / 给预览强行封高);竖幅也想一屏留作后续单独评估。
- 自检:`node --check` = SYNTAX_OK、grep 无 `http(s)://` / CDN / 外链字体;版本 → v3.0.0-beta.2,`sw.js` cache → `yinji-v23-2026-06-03-v3.0.0-beta.2`。浏览器预览(`getComputedStyle` + `getBoundingClientRect` 实测,截图本轮偶发卡顿改用计算样式量取):固定外壳(header + stage padding + hint + panel + body padding)≈ 583px;横幅 4:3 成像 ≈ 801px(< 812 视口,一屏放下);竖幅 3:4 ≈ 970px(需轻滑);spring 缓动 / 各尺寸缩减均已在计算样式确认生效,JS 正常执行(21 滤镜 chip 渲染、无 console 报错)。

## 6.18 v3.0.0-beta.3 实现要点（拼图基础版 / 合成即照片）

> 6/3 冲刺第①项「拼图」。**核心架构决策:不碰渲染 / 导出管线**——把 2–4 张照片合成进一张离屏 `<canvas>`,再令 `state.bitmap` 指向这张 canvas。既有 `getSize()` 读 `bmp.width||bmp.naturalWidth`、所有绘制走 `drawImage(bmp,...)`,故拼好的图对下游就是"一张普通照片",水印 / 滤镜 / 调色 / 导出**全部零改动继承**。拼图无单一 EXIF → `state.exif=null` / `exifApp1=null`。

- **入口与 DOM**:空状态(原 `.drop` + `<input>`)整体包进 `#startView`;`.drop` 下方加整宽玻璃按钮 `#collageEntry`(四宫格 SVG 图标,`yj-fadeUp` + `var(--spring)` 入场);新增隐藏 `<input id="collageInput" accept="image/*" multiple>`。原先两处 `drop.style.display` 开关(`loadFile` 隐藏、reset 复原)改为操作 `startView`。新增 `#collageOverlay` sheet(`#collagePreview` 预览 canvas + `#collageLayouts` 选项行 + 取消 / 换照片 / 用这个拼)。
- **布局表**:`COLLAGE_LAYOUTS` 以张数为键——`2:[2lr,2tb]`、`3:[3v,3h,3lr]`、`4:[4grid,4v,4h]`,每个 cell 是归一化 `{x,y,w,h}`(0~1 占比);`collageLayoutsFor(n)` / `findCollageLayout(n,id)`(找不到 id 返回首个)。
- **合成 `drawCollageInto(canvas,layout,photos)`**:白底 + gap(≈size×1.2%) + 圆角(gap×1.4);逐格 `collageRoundRect`(裁剪路径,**特意不叫 `roundRectPath`,避开既有同名全局函数被后声明覆盖的坑**——node --check 查不出此类静默 bug)→ `clip()` → `coverDraw`(用 `Math.max(dw/iw,dh/ih)` 算 cover 缩放、居中绘制,填满不变形),无图格填占位色 `#EDE7DC`。`layoutSvg(layout)` 按 cells 画 mini 预览塞进选项芯片(`fill="currentColor"`,**无 xmlns**,避外链 grep)。
- **选图 → 预览 → 确认**:`collageInput change` → slice + 清 `value`(允许重选同图)+ <2 张 / >4 张拦截或截断 → `Promise.all(loadBitmap…)`(复用既有 `createImageBitmap` + `<img>` 兜底)过滤打不开的 → 先 `renderCollagePreview()`(把 `collageLayoutId` 从 null 落到首个布局)再 `renderCollageLayouts()`(故首个布局**开局即高亮**,修了一个开局无高亮的割裂 bug)→ overlay show。`用这个拼` → `COLLAGE_SIZE=1500` 方图合成 → `state.bitmap=cv; state.exif=null; invalidateGrade()` → `setMode(chooseInitialMode(),true)` + 切 editor(`startView` 隐藏) + `renderAutoPanel()` + `draw()`。
- 自检:`node --check`=SYNTAX_OK、grep 无 `http(s)://` / CDN / 外链字体;版本 → v3.0.0-beta.3,`sw.js` cache → `yinji-v24-2026-06-03-v3.0.0-beta.3`。浏览器预览(注入合成照 File 经 `DataTransfer` 设 `collageInput.files` + dispatch change):2/3/4 张分别出 2/3/3 个布局选项、预览非空、点选项 `.on` 唯一切换 + 重绘、「用这个拼」后进编辑器(`#canvas` 1500×1680=方图 + 标题栏、控件齐、无 console 报错)。

## 6.19 v3.0.0-beta.4 实现要点（水印扩充 +6 款 / 调色板加法）

> 6/4 冲刺第①项「水印扩充」。沿用 6.7 节(v2.9.1 起)的**零风险加法**:**只加调色 + 注册,不写任何新绘制代码**。两个共享渲染器都只吃 `{bg,text,soft,accent}` 四键——`drawSeasonStyle(pal)`=浅底栏 + 照片下方一道 `accent` 细线 + `text`/`soft` 文字;`drawBrandStyle(pal)`=深底栏 + 顶部一条 `accent` 撞色细条 + 撞色字。模板总数 **36 → 42**。

- **新增调色**:`SEASON` 加 4 款奶系柔色——`matcha {bg:#EBF0DC,text:#5C6E2E,soft:#9AA876,accent:#8DA24A}`(抹茶,暖调奶绿,区别于冷青瓷绿 `solarTerm`)、`milkTea {…#F1E6D6/#9A6B33…}`(焦糖奶茶)、`lotusPink {…#F2E7EA/#9A6373…}`(藕粉雾玫,比 `spring` 含蓄)、`oatCream {…#F4EEDF/#80714F…}`(燕麦奶油,暖中性);`BRAND` 加 2 款——`silver {bg:#1C1E20,accent:#B8C0C6,text:#D6DCE0,soft:#8A9298}`(银盐,炭灰 + 银灰,黑白单色,填补无灰/银品牌色空白)、`kodak {bg:#1C1408,accent:#E8A12A,text:#F0C268,soft:#A98A52}`(柯达金,espresso + 琥珀金,区别于 `sony` 纯橙黑底 / `nikon` 柠檬黄)。
- **4 个改动点**:`SEASON`/`BRAND` 加调色 → `TEMPLATES` 加 6 条(id/name/desc/tags)→ `DRAW_DISPATCH` 加 6 条 `id→function(){ drawSeasonStyle/drawBrandStyle(pal); }` 映射 → `CAT_IDS`(`season` +4 奶系、`brand` +2 胶片)。顺手订正注册区注释 `(30→42 presets)`。**id 三处必须一致**(`TEMPLATES` ↔ `DRAW_DISPATCH` ↔ `CAT_IDS`):`matchaGreen`/`milkTea`/`lotusPink`/`oatCream`/`silverMono`/`kodakGold`。
- 自检:`node --check`=SYNTAX_OK、grep 无 `http(s)://` / CDN / 外链字体;版本 → v3.0.0-beta.4,`sw.js` cache → `yinji-v25-2026-06-04-v3.0.0-beta.4`。浏览器预览(注入 1200×800 合成照 File 进编辑器):更多模板面板渲染 **42** 个 `.template-item[data-style]`;逐个 `.click()` 6 个新 id → 画布稳定 1200×956(800 照片 + 156 标题栏)、**0 报错**;`getImageData(5,h-20)` 采底栏左下像素 → 6 款 `bg` **全部与设计 hex 精确相符**。(注:该环境 `preview_screenshot` 截图子系统超时不可用,改用 eval 逐像素取色,比肉眼截图更精确。)

## 6.20 v3.0.0-beta.5 实现要点（自定义主题色 / inline `--accent` 覆盖，仅改外壳）

> 6/4 冲刺第②项「支持修改主题配色」。让用户在「设置 → 外观」自定义 App 强调色 `--accent`。整套 UI 早已全程引用 `var(--accent)` / `var(--accent-soft)`,故只改这两个变量即可全局换色;**画布水印成图只读 JS 端硬编码调色板(`SEASON`/`BRAND`/`COLORS`),从不读 CSS 变量,故成图天然不受影响**。

- **核心手法**:把选中色作为 **inline style 写到 `document.body`** 上——inline 样式优先级高于任何选择器规则,因此同时盖过 `:root`(浅色默认 `#C2632D`)与 `body[data-theme="dark"]`(深色默认 `#E08A4C`)两处 `--accent`;若设到 `documentElement(html)` 则在深色模式会被 `body[data-theme="dark"]` 的规则反盖,故必须设到 `body`。选「默认」时 `body.style.removeProperty('--accent'/'--accent-soft')` 还原主题自带色。
- **`applyAccent()`**(新增,挂 `applyTheme()` 末尾):颜色工具 `_hexToRgb` / `_rgbToHex` / `_mix(hex,target,t)`(向 target 线性插值)。`accent==="default"` 或非 `#RRGGBB` → remove 还原;否则 `setProperty('--accent', ac)`,**`--accent-soft` 按明暗分别算**:浅色 `_mix(ac,'#FBF6EE',0.84)`(向奶白淡化)、深色 `_mix(ac,'#1A1410',0.80)`(向近黑压暗),结果贴近原手调默认值(`#F4E6D8` / `#3A2A1C`)。`applyTheme()` 末尾调 `applyAccent()` 使切换明暗 / 跟随系统时 soft 随当前明暗重算;`matchMedia` change → `applyTheme` 链路、`resetSettingsBtn`(走 `applyTheme`)均自动覆盖。
- **数据层**:`defaultSettings()` 增 `accent:"default"`,沿用 `yinji.settings.v1`,`loadSettings` 通用拷贝分支即识别字符串键,无需迁移。
- **UI**(设置 → 外观,`#themeSeg` 下方):`#accentSwatches` = 6 个 `.accent-sw[data-accent]` 圆点(default 赤陶 #C2632D / 海蓝 #2E6F95 / 松绿 #3E7A5E / 黛紫 #7A6A9A / 胭脂 #B65069 / 墨灰 #5A6168)+ `.accent-custom`(彩虹 `conic-gradient` 标签内嵌透明 `<input type=color id=accentColorInput>`)。`.accent-sw.on` 双层 ring 标选中。
- **wiring**:`syncSettingsUI()` 按 `data-accent===acc` 标 `.on`,无匹配且非 default 给 `.accent-custom` 标 `.on`,回填 `accentColorInput.value`;`#accentSwatches` click(冒泡找 `.accent-sw`;自定义标签无 `data-accent` → return 交给 input 事件)与 `accentColorInput` input 事件均写 `settings.accent` + save + `applyAccent()` + `syncSettingsUI()`。
- 自检:`node --check`=SYNTAX_OK、grep 无 `http(s)://`;版本 → v3.0.0-beta.5,`sw.js` cache → `yinji-v26-2026-06-04-v3.0.0-beta.5`。浏览器预览(先清 SW + caches 再 reload):7 个色板 + 取色 input 在位;点海蓝 → `body --accent`=#2E6F95 / soft=#dae0e0 / 持久化 / swatch `.on` / input 回填;点默认 → inline 清空、computed 回落 #C2632D、持久化 "default";深色下点松绿 → soft=#212820(向近黑);**实测玻璃开关 checked slider 背景 rgb(194,99,45 赤陶)→ 点胭脂 → rgb(182,80,105)→ 点默认 → 回赤陶**,证明可见 UI 实时换色且能还原;取色盘 input 派发 → 持久化 #1f8a70、自定义 ring 亮、无预设误选;console 零报错。(该环境 `preview_screenshot` 仍超时,改用 eval 读 `getComputedStyle`/inline style 验证。)

## 6.21 v3.0.0-beta.6 实现要点（拼图加文字 / 贴纸 / 预览叠加层烤进大图）

> 6/4 冲刺第③项「画图功能 × 自定义拼贴结合」,南心确认范围 = **拼图上加文字 / emoji 贴纸**(不做自由手绘)。在 6.18 拼图基础上加一层「装饰层(deco)」,与拼图同样**不碰渲染 / 导出管线**:deco 在合成时一起画进 1500² 离屏 canvas,`state.bitmap` 指向它,下游水印 / 滤镜 / 导出零改动继承。

- **数据模型**:`collageDecos=[]`,每项 `{type:'text'|'sticker', x, y, content, size, color}`。`x,y` 为**中心点归一化坐标(0~1)**、`size` 为**高度占画布的比例**——与画布边长无关,故预览(600)与成图(1500)**等比一致**,无需按比例换算。配套 `collageSelected`(选中下标 / -1)、`collageDrag`(`{dx,dy}` 指针与中心的归一化偏移)。
- **渲染**:`decoMetrics(ctx,d,size)` 用 `measureText` 量中心 / 宽高 / 字号(`fs=max(8,d.size*size)`);`drawCollageDecos(ctx,size,decos,selIndex)`——text 用 600 字重 + center/middle 对齐,**先 `strokeText` 描边光晕**(`lineJoin=round`、`lineWidth≈fs*0.16`,按字色明暗经 `_isLightColor`(复用 beta.5 的 `_hexToRgb`)选黑 / 白 halo)**再 `fillText`**,保证压在任意照片上可读;sticker 直接 `fillText(emoji)`(系统彩色字形,`fillStyle` 无效、**零外部资源**)。选中画蓝色虚线框(`setLineDash`),**仅预览**——`drawCollageInto(canvas,layout,photos,decos,selIndex)` 在 `collageConfirm` 时传 `selIndex=-1`,故成图不含框。两调用方:`renderCollagePreview` 传 `collageDecos,collageSelected`;confirm 传 `collageDecos,-1`。
- **交互**:`collageAddText`→`window.prompt`(trim / 空忽略 / 截 30 字)→ `addCollageDeco({type:'text',x:.5,y:.5,size:.09,color:'#ffffff'})`;`#collageDecoBar` 委托点击 `.deco-sticker[data-emoji]` → `addCollageDeco({type:'sticker',size:.16,color:null})`;上限 12。**拖动用 Pointer Events**:`#collagePreview` 加 `touch-action:none`(防滚动劫持),`pointerdown`→`collageEventPos`(`getBoundingClientRect` 把缩放显示坐标换算回归一化)+ `collageHit`(从上往下命中、范围放宽 `size*0.03`)→ 选中 + 记 `collageDrag` + `setPointerCapture`;`pointermove` 更新 `d.x/d.y`(clamp 0~1);`pointerup/cancel` 释放。选中行 `#collageDecoEdit`:`syncCollageDecoEdit()` toggle `.hidden` + 按 `type==='text'` toggle `.deco-text-only`(改文字 / 颜色对 sticker 隐藏);大小 `*0.85` / `*1.18`(clamp 0.03~0.6)、改文字再 prompt、颜色 = 隐藏 `<input type=color>` 的 input 事件、删除 = splice。`resetCollageDecos()` 在换照片 / 取消 / 关遮罩 / confirm 各清一次。
- **踩坑**:项目内**无全局 `.hidden`**(只有带前缀的),新增 **scoped** `.collage-deco-edit.hidden` / `.deco-ctl.hidden`,否则隐藏不生效。
- 自检:`node --check`=SYNTAX_OK、grep 无 `http(s)://`;版本 → v3.0.0-beta.6,`sw.js` cache → `yinji-v27-2026-06-04-v3.0.0-beta.6`。浏览器预览(脚本注入两张纯色 PNG 走真实 `change` 管线):overlay 打开、左格取到 `#2244cc` 照片像素;点 ❤️ → 预览中心出现非白像素、编辑行显示且 text-only 控件对贴纸隐藏;删除 → 编辑行回隐;`prompt` stub 加文字 → 中心像素变化、text-only 显示;字色改 `#00ff00` → 预览出 5641 绿像素;点「用这个拼」无异常切编辑器、overlay 关,**最终合成画布 1500×1680 含 37690 绿像素**(证明 deco 烤进大图并穿过水印管线);console 零报错。(该环境 `preview_screenshot` 仍超时,改用 eval 注入文件 + 采样像素验证。)

## 6.22 v3.0.0-beta.7 实现要点（智能文案灵感 A3 / 端上规则版 / 第二个端上 AI）

> 6/4 冲刺第⑦项「AI 功能再次增加」=「在 A1 基础上继续加 AI 能力」,落地 `roadmap-3.0.md` 的 **A3 智能文案 / 标题建议(端上规则版)**。**纯端上、零网络、零模型下载**——读这张照片的 EXIF 派生线索 + A1 的色调倾向,用规则 + 词库套句式生成 2~3 个文案候选,点 chip 填进文字框。与 6.16 的 A1 一样:**渲染端零改动**,只是替用户把文字框填好,填完仍是普通手动文字,可再改。

- **入口与 DOM**:`#manualField` 里 `#textInput` 下加一个整宽 `<button class="cap-spark" id="captionBtn">✨ 来点灵感<span class="sub">读这张照片的时间 / 季节 / 色调,给你几个文案,点一下就填</span></button>` + 候选容器 `<div class="cap-list" id="captionList" aria-live="polite"></div>`。CSS:`.cap-spark`(透明底 + `var(--accent)` 描边 / 字、`.sub` 独占行小字、`:active` scale.97);`.cap-chip`(玻璃底 + `backdrop-filter`,`body[data-glass=off]` / `[data-theme=dark]` 各自降级配色);`.cap-list:empty{margin-top:0}` 让空态不留缝。
- **EXIF 线索 `exifClues(ex)`**(纯函数):用 `/^(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2})/` 解析 `ex.date`(`"YYYY:MM:DD HH:MM:SS"`)→ **季节**(月份 3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬)+ **时段**(时 5-8 晨 / 8-11 上午 / 11-14 午 / 14-17 午后 / 17-20 暮 / 其余 夜);`device=ex.model||ex.make`;`ex.fnumber<=2.2`→`bigAperture`;`ex.focal>=85`→长焦 / `<=24`→广角。无 EXIF 各字段为空串 / false,函数照常返回。
- **生成 `suggestCaptions()`**:取 `exifClues(state.exif)` + `state.toneAdj`(冷暖 `temp` / 明暗 `intensity` 仅作语气微调);按线索拼 4 类句式池(时段词 / 季节词 / 情绪词 / 光线词 / 焦段词交叉组合,如「秋日暮色」「暮色 · 浅焦」「温柔的光」)+ 6 条**通用兜底**(无任何 EXIF 时也能出货);`aiPick` 随机取、Set 去重、返回前 3,故**再点一次换一批**。`aiNowDate()` 兜底当天日期类候选。
- **渲染 `renderCaptions()`**:`suggestCaptions()` → 清空 `#captionList` → 每个候选建一个 `<button class="cap-chip">` append;chip click → `textInput.value=候选` + `setMode('manual')` + `draw()` + toast「填好啦,可以再改」。接线:`(function(){ var cb=$("captionBtn"); if(cb) cb.addEventListener("click", renderCaptions); })();`(挨着既有 `textInput` input 监听)。
- **3.0 AI 接入位**:`window.Yinji.ai.register({id:"caption",label:"文案灵感(端上)",onDevice:true,run:function(){return suggestCaptions();}})` —— `ai.list()` 由 `["smartColor"]` 变 `["smartColor","caption"]`;run 全程本地、读 `state.exif`/`state.toneAdj` 派生信息、不联网、不写盘。`getContext()` 增只读字段 `hasExif` + `clue` 派生的 `timeOfDay/season/device/lens`(经 `var clue=exifClues(state.exif)`),延续 6.11 / 6.16 铁律——**不含照片像素、不含原始 GPS**(只给"傍晚 / 秋 / 某机型"这类粗粒度标签,不可还原原图或定位)。
- **隐私自查**:A3 读的全是已在端上的 EXIF 元信息(用户选图时本就解析出来),不新增任何权限 / 上传 / 下载;断网完全可用;定位诚实为"灵感模板"而非"AI 写作"(真正的自然语言生成是 B1 联网版,默认关)。
- 自检:`node --check`=SYNTAX_OK、grep 无 `http(s)://` / CDN / 外链字体;版本 → v3.0.0-beta.7,`sw.js` cache → `yinji-v28-2026-06-05-v3.0.0-beta.7`。浏览器预览(注入带 EXIF 的 `state` + 触发):`window.Yinji.ai.list()` = `["smartColor","caption"]`;`#captionBtn` 经 `getComputedStyle` 实测以 `--accent`(#C2632D)描边渲染;`.click()` 后 `#captionList` 渲出 chip;点 chip 后 `#textInput.value` 被填、`setMode('manual')` 生效、`draw()` 重绘;`getContext()` 含新增 `hasExif/timeOfDay/season/device/lens` 字段且无像素 / GPS;另跑 node 规则单测 11 组场景(各季节 / 时段 / 无 EXIF 兜底)全过;console 零报错。(该环境 `preview_screenshot` 仍超时,改用 eval 读 DOM / 计算样式 / 调用真实函数验证。)

## 6.23 v3.0.0-beta.8 实现要点（编辑器「水印 / 调色」分页 + 函数体注释清理 + UI 简洁化）

> 6.5 冲刺三项 🔴。① **调色 / 水印分离**——编辑器顶部加「水印 / 调色」标签,点哪个只露出哪组控件;**纯 UI 拆分,成图始终同时带水印 + 调色**(导出管线零改动)。② **去函数体注释**——regex-aware tokenizer 删 inline `<script>` 内 448 条解释性注释、留 45 条结构横幅,代码骨架逐字节不变。③ **UI 简洁化**——分页即主要瘦身,当前标签 `--accent` 点亮。南心确认设计 = **编辑器内切换标签**(非独立页 / 非两次导出)。

- **设计契约(关键)**:分页只切 DOM 显隐,**不碰渲染**。`getSize()` 单点注入的调色离屏画布 + 水印绘制管线全不变,故无论停哪个标签,「保存图片」导出的 `#canvas` 都同时含水印 + 调色(浏览器实测切标签前后同像素 `[107,107,107]` 不变)。**像 iPhone 相册编辑分页:工具分屏,导出仍是一张完整图。**
- **state**:加 `state.editTab:"watermark"`(默认);**不入 `yinji.settings.v1` 持久**——每张新照片 / 每次进编辑器都复位回「水印」。
- **DOM**(`.panel` 内):顶部 `#editTabs`(`.seg.edit-tabs`,`button[data-tab=watermark|color]` ×2)→ `#watermarkPane.edit-pane`(原 `#styleSeg` + 模式切换 `#seg` + `#manualField` + `#autoField`)+ `#colorPane.edit-pane.hidden`(原滤镜 / 调色盘整块 `#toneBlock`)→ 两页**共用**底部 `.actions`(保存图片 / 换一张)。即把原顺排两大块各包一个 pane,标签决定显隐。
- **JS**:`setEditTab(tab)`——归一化(非 `color` 即 `watermark`)→ 写 `state.editTab` → 标签 `.on` 类切换 → 两 pane `classList.toggle("hidden",…)`;标签行 `Array.prototype.forEach.call(...querySelectorAll("button"))` 绑 click→`setEditTab(data-tab)`。两处入口(照片加载成功 `setMode(...)` 后、拼图确认 `resetCollageDecos()` 后)各调 `setEditTab("watermark")`。
- **注释清理**:一次性 `tools/strip-comments.js`(跑完即删)逐字符走 CODE / 单 / 双 / 模板 / 正则 / 行 / 块注释状态机,`prevSig` 判正则上下文(`/` 前是 `[A-Za-z0-9_$)\]}.]` 则除号)、正则内 `[...]` charClass 置位防误判——**只删注释,字符串 / 模板 / 正则字面量一律不碰**。整行注释删(含该行)、正文 `^[-=]{4,}` 的**结构横幅保留**(导航目录)、行尾注释删后 rtrim;共删 **448** 留 **45**。CSS `/* */` 与 HTML `<!-- -->` 不在「函数体内」范围、刻意不动。验证:`tools/verify-strip.js` 对 strip 前后各产「codeOnly 骨架」(剥**全部**注释 + 空白)**逐字节相同(各 112293 字符)**→ 证只动注释 + 空白、代码零改。临时工具(strip / verify / _removed-comments.txt / .bak)收尾全删。
- **UI 简洁化**:`.edit-tabs button.on{color:var(--accent)}`(当前标签点亮,区别于下方同为 `.seg` 的「手动 / 自动」)、`.edit-tabs{margin-bottom:2px}`、`.edit-pane{margin-top:11px}`、`.edit-pane.hidden{display:none}`、`#colorPane .tone-block{margin-top:0}`。**项目无全局 `.hidden`**,`.edit-pane.hidden` 为 scoped(同 `.field.hidden` / `.collage-deco-edit.hidden`)。
- **⚠️ 设置模块零改动**:本版只动注释 + 分页 DOM 包裹 + 几行 CSS,**未删任何设置 / 功能**;grep 命中 52 处设置相关标识、DOM 六大分区(外观 / 打开照片时 / 自动信息 / 照片与导出 / 数据与隐私 / 关于)在位。
- 自检:抽 inline `<script>`(仍 1 块、141344 字符)过 `new Function()`=SYNTAX_OK;grep `(src|href)=http(s) / @import / url(http / cdn / googleapis / unpkg / jsdelivr / fonts.google` 全 0(散落的 `beta.2/3/5/6` 字符串是模板注释里的历史版本号引用,`APP_VERSION` 单一真源已是 beta.8)。版本 → v3.0.0-beta.8,`sw.js` cache → `yinji-v29-2026-06-05-v3.0.0-beta.8`。浏览器预览(unregister SW + clear caches + cache-buster 强刷):`#appVer`=v3.0.0-beta.8、`#editTabs` 两标签 `watermark(on)/color(off)`、`#watermarkPane` 显 / `#colorPane` 隐、切标签互换 pane、停「调色」加黑白滤镜烤进画布、**切标签不改成图(同像素一致)**、当前标签计算色 `rgb(194,99,45)`=`--accent`、`ai.list()`=`["smartColor","caption"]`、console 零报错。(该环境 `preview_screenshot` 仍超时,改用 `preview_eval` 读 DOM / 计算样式 / 采样。)

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
