# dsh-drop-to-path-electron

一个**极小**的 DSH 客户端插件 demo：在 Electron/桌面版里**拖一个文件、瞬间拿到它的真实绝对路径**并自动填进输入框——**不靠搜索、不卡**。

> 前提（已实测验证）：在**沙箱化的 Electron 渲染进程**里，页面拿不到真实路径——
> 既没有 `window.webUtils`，也没有 `file.path`。**唯一**能拿到真实路径的方式，是宿主在
> **preload 里用 webUtils.getPathForFile 经 contextBridge 暴露一个桥**。
> 本 demo 就是读这个宿主桥（如 `window.dshNative.getPathForFile`）。

## 痛点 / 为什么

社区里「解析真实路径」的拖拽插件（如 `dsh-drag-and-drop`）在浏览器里**很卡**：拖一个不在 Workspace 里的文件要好一会儿才挂上路径，装 Everything 才稍微好点。

- **浏览器**：网页被安全机制禁止拿到拖入文件的真实绝对路径 → 插件只能退回本机全盘搜索 → 慢（卡）。
- **桌面版（Electron）**：Electron 本身能拿到真实路径，但沙箱默认不把 webUtils/file.path 暴露给页面。
- **解法**：宿主（EAC）在 **preload 暴露一个桥**，插件即可 drop 瞬间拿到真实路径。

## 实测证据（Electron 43）

用 preload 桥 `window.dshNative.getPathForFile` 实测：
- `window.webUtils` → 不可用
- `file.path` → 不可用
- **preload 桥** → 真实绝对路径，单文件/多文件一次拖都稳定

## 结构

- `lib/index.js` — no-op host（官方插件要求合法 bundle）
- `lib/client.js` — 浏览器半区：ModuleLoader 加载 + composer.dock 槽位写输入框
- `package.json` — dsh.client 声明 + dsh.bundle.patch

## 安装（需宿主已暴露桥）

`dsh plugin --profile <active-profile> add link:<本仓库路径>`

> demo 的 realPathOf 会先找宿主桥（`window.dshNative.getPathForFile` 等），再试 webUtils 和 file.path。
> 当前 EAC 还没暴露桥，所以插件在真实 EAC 里暂时拿不到路径——这正是希望 EAC 支持的点。

## 说明

- 仅当宿主是 Electron/桌面版且暴露了路径桥时才生效；普通浏览器拿不到真实路径。
- 概念验证 Demo，非生产、未在桌面端完整实测。
