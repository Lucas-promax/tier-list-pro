# Tier List Maker Pro 项目开发文档

## 1. 项目简介

这是一个基于 React 开发的纯前端 Tier List（层级排行榜）制作工具。它允许用户上传图片，通过拖拽的方式将图片分配到不同的评级行（Tier）中。

**核心亮点：**

- **本地存储：** 使用 IndexedDB 替代 LocalStorage，支持存储大量、高分辨率的图片，无大小限制。
- **高级拖拽：** 实现了“实时排序（Live Sorting）”和“智能插入”，拖拽手感顺滑，支持视觉反馈（虚影预览）。
- **完全自定义：** 支持自定义评级行的数量、标题、颜色。
- **导入/导出：** 支持保存未完成的进度（.tmp/.json 文件）以及导出最终的高清图片。
- **无服务端：** 所有数据均存储在用户浏览器本地，安全且隐私。

---

## 2. 技术栈与依赖

- **框架：** React (Vite 构建)
- **样式：** Tailwind CSS (用于快速布局和响应式设计)
- **图标库：** lucide-react (提供界面所需的 SVG 图标)
- **截图工具：** html2canvas (动态加载，用于将 DOM 转换为图片)
- **数据库：** Native IndexedDB API (用于持久化存储配置和 Blob 图片数据)

---

## 3. 核心功能实现逻辑

### 3.1 数据存储 (IndexedDB Utility)

为了解决 localStorage 5MB 的存储限制，项目使用了浏览器原生的 IndexedDB。

- **initDB：** 初始化数据库 TierListDB_v13。创建两个对象仓库（Object Stores）：
  - **config：** 存储评级行的结构、颜色、标签以及侧边栏图片的 ID 列表。
  - **images：** 存储具体的图片文件（Blob），以 ID 为键。
- **dbOperate：** 一个通用的异步辅助函数，封装了繁琐的 IndexedDB 事务（Transaction）操作，支持读写模式。

---

### 3.2 拖拽系统 (Core Drag & Drop)

这是本项目最复杂也是最核心的部分，未使用第三方 DnD 库，而是原生实现以获得最大控制权。

**状态管理：**

- **activeDragId：** 当前被拖拽的图片 ID。
- **dropTarget：** 包含 `{ tierId, index }`，表示如果此刻松手，图片将落入的位置。
- **dragItemRef：** 使用 useRef 存储拖拽数据，避免闭包陷阱导致的数据不同步。

**交互逻辑：**

- **开始拖拽 (handleDragStart)：**
  - 记录源位置。
  - 设置 activeDragId。
  - 使用 setTimeout 延迟隐藏原图，确保浏览器能截取到清晰的拖拽缩略图。

- **拖拽经过 (handleDragOverItem / handleDragOverContainer)：**
  - **智能插入：** 计算鼠标相对于目标图片的 X 轴位置。如果鼠标在目标图左侧 50%，则插入前部；否则插入后部。
  - **实时预览：** 更新 dropTarget 状态，触发组件重新渲染。

- **渲染视图 (renderListItems)：**
  - **隐藏源图：** 将正在被拖动的原图渲染为不可见的 DOM 节点（保持 HTML5 拖拽连接）。
  - **显示虚影 (Ghost)：** 在 dropTarget 指定的位置，动态插入一个半透明的虚影组件，提示落点。

- **放置 (handleDrop)：**
  - 根据 dropTarget 计算最终的数据索引。
  - 从源数组移除 ID，插入到目标数组。
  - 更新 React State 并同步写入 IndexedDB。

---

### 3.3 图片处理与垃圾桶

- **上传：** 图片通过 `<input type="file">` 获取后，直接存入 IndexedDB 的 images 仓库，仅将生成的 UUID 保存在 sidebarImageIds 状态中。同时生成 `URL.createObjectURL` 用于展示。

- **删除：** 底部设有一个 TRASH 区域。当 `dropTarget.tierId === 'TRASH'` 时，触发删除逻辑：
  - 从状态中移除 ID。
  - 调用 deleteImageFromDB 物理删除 IndexedDB 中的 Blob 数据。
  - 释放 `URL.revokeObjectURL` 避免内存泄漏。

---

### 3.4 文件保存与导出 (Modals)

由于浏览器环境（特别是 iframe 或沙盒环境）限制了 `window.showSaveFilePicker` 和 `window.prompt` 的使用，项目实现了自定义模态框。

- **导出配置 (.json/.tmp)：** 将所有图片 Blob 转换为 Base64 字符串，打包成 JSON 对象。
- **导出图片 (.png)：** 调用 html2canvas 截取 exportRef 指向的 DOM 节点。
- **saveModal：** 一个自定义 UI 组件。用户点击保存后，弹出此窗口输入文件名，确认后通过创建隐藏的 `<a>` 标签触发浏览器下载行为。

---

## 4. 代码结构解析 (App.jsx)

代码采用单文件组件模式，主要分为以下几个区域：

- **Imports & Constants：** 引入依赖，定义数据库常量。
- **Helper Functions：** initDB, dbOperate, blobToBase64 等工具函数。

**Main Component (TierListMaker)：**

- **State Definitions：** 定义 tiers, sidebarImageIds, modals 等状态。
- **useEffect Hooks：**
  - 加载 html2canvas 脚本。
  - 初始化时从 IndexedDB 读取数据恢复状态。
- **Event Handlers：**
  - handleDragStart, handleDrop 等拖拽逻辑。
  - handleExportState, exportImage 等文件操作逻辑。
- **Render Helper (renderListItems)：** 负责根据当前拖拽状态，计算应该渲染哪些 Item，哪里插入 Ghost，哪里隐藏 Source。

**JSX Layout：**

- **Global Modals：** 确认框和保存文件框，绝对定位覆盖全屏。
- **Header：** 顶部操作栏（导入、保存、设置、重置）。
- **Main Content：**
  - **Tier Board：** 循环渲染评级行。
  - **Sidebar：** 底部待选图片库 + 垃圾桶区域。

---

## 5. 配置与运行指南

### 5.1 环境要求

- Node.js (LTS 版本)
- npm 或 yarn

---

### 5.2 初始化项目

如果你是从零开始，建议使用 Vite 创建 React 项目：

1. 创建项目  
   ```bash
   npm create vite@latest tier-list-pro -- --template react
   cd tier-list-pro
    ```

2. 安装依赖
    ```bash
    npm i -D tailwindcss@3 postcss autoprefixer
    npx tailwindcss init -p
    npm install lucide-react
    ```

---
### 5.3 配置 Tailwind CSS
修改 `tailwind.config.js`：
   ```js
   /** @type {import('tailwindcss').Config} */
   export default {
   content: [
       "./index.html",
       "./src/**/*.{js,ts,jsx,tsx}",
   ],
   theme: {
       extend: {},
   },
   plugins: [],
   }
   ```
在 `src/index.css` 中添加：
   ```js
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```
---
### 5.4 运行项目
使用以下命令启动开发服务器：
   ```bash
   npm run dev
   ```