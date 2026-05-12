# 创作者助手

帮助内容创作者管理素材、组织知识、高效创作的本地桌面工具。所有数据存储在本地，不上传任何服务器。

## 功能

- **AI 对话** — 专属创作助手，支持大纲写作、草稿润色、批判审阅等写作全流程
- **文章库** — 上传过往文章，让 AI 学习并模仿你的行文风格
- **知识库** — 管理创作素材，支持文件夹分类，AI 对话时可引用指定知识库内容
- **OneNote 导入** — 通过 Microsoft Graph API 将 OneNote 笔记批量导入知识库

## 技术栈

- Electron 28 + Vite + React
- Google Gemini API（主模型）
- Microsoft Graph API（OneNote 集成）
- IndexedDB（本地数据持久化）

## 快速开始

```bash
npm install
```

复制环境变量模板并填入密钥：

```bash
cp .env.example .env.local
```

启动应用：

```bash
npm start
```

开发模式（需开两个终端）：

```bash
npm run dev           # 终端 1：启动 Vite 开发服务器
npm run electron:dev  # 终端 2：启动 Electron
```

构建：

```bash
npm run build
```

## 环境变量

在 `.env.local` 中配置（不提交到 Git）：

```
VITE_GEMINI_API_KEY=     # Google AI Studio 获取
VITE_MS_CLIENT_ID=       # Azure 应用注册 ID（OneNote 登录用，可选）
```

## 项目结构

```
src/
  components/   # React 组件
  services/     # AI、存储、OneNote 服务
  styles/       # CSS 样式
electron/
  main.js       # Electron 主进程（API 调用、IPC）
  preload.js    # 渲染进程桥接
```

## 数据存储

所有数据保存在本地 IndexedDB：

- macOS：`~/Library/Application Support/创作者AI助手/IndexedDB/`
- Windows：`%APPDATA%/创作者AI助手/IndexedDB/`

## 注意事项

- Gemini API 在中国大陆需要 VPN
- API 密钥存放在 `.env.local`，不要提交到 Git
