# Phase 2: Obsidian Vault 直挂通道 实施计划

> **对于 Claude：** 必需的子技能：使用 superpowers:executing-plans 按任务逐步实施此计划。

**目标：** 让用户直接链接本地 Obsidian Vault 目录，自动监听 .md 文件变动并增量索引，解析 front-matter 和 wiki-link，在 KBSidebar 中与现有知识库平级展示。

**架构：** 主进程负责文件系统操作（目录选择、chokidar 监听、文件读取解析），通过 IPC 将变动事件推送到渲染进程。渲染进程收到事件后调用现有 RAG pipeline（chunker → embedding → IndexedDB）完成增量索引。Vault 配置持久化到 electron-store。

**技术栈：** chokidar（文件监听）、gray-matter（front-matter 解析）、electron-store（配置持久化）、现有 RAG pipeline

---

## 新增依赖

```bash
npm install chokidar gray-matter electron-store
```

## IndexedDB Schema 变更

DB_VERSION: 3 → 4

新增 store：
- `obsidianVaults`：keyPath `id`，存储 vault 元数据（path, name, lastSync）
- `wikiLinks`：keyPath `id`，索引 `bySource` / `byTarget`，存储 [[wiki-link]] 图谱

现有 `kbChunks` store 复用，vault 文件的 kbId 使用 `vault:{vaultId}` 前缀区分。

---

### 任务 1: 安装依赖 + electron-store 初始化

**文件：**
- 修改：`package.json`
- 修改：`electron/main.js`（顶部添加 electron-store 初始化）

**步骤 1: 安装依赖**

```bash
npm install chokidar gray-matter electron-store
```

**步骤 2: 在 main.js 顶部初始化 electron-store**

```javascript
const Store = require('electron-store')
const store = new Store({
  defaults: {
    vaults: [] // [{ id, path, name }]
  }
})
```

**步骤 3: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用正常启动，无报错

---

### 任务 2: IPC — 选择 Vault 目录 + 持久化

**文件：**
- 修改：`electron/main.js`（添加 3 个 IPC handler）
- 修改：`electron/preload.js`（暴露 3 个方法）

**步骤 1: 在 main.js 添加 vault IPC handlers**

```javascript
// 选择 vault 目录
ipcMain.handle('vault:pick', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 Obsidian Vault 目录'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const vaultPath = result.filePaths[0]
  const name = path.basename(vaultPath)
  const id = `vault_${Date.now()}`
  const vault = { id, path: vaultPath, name }
  const vaults = store.get('vaults', [])
  vaults.push(vault)
  store.set('vaults', vaults)
  return vault
})

// 获取已链接的 vaults
ipcMain.handle('vault:list', async () => {
  return store.get('vaults', [])
})

// 移除 vault 链接
ipcMain.handle('vault:remove', async (event, vaultId) => {
  const vaults = store.get('vaults', []).filter(v => v.id !== vaultId)
  store.set('vaults', vaults)
  return true
})
```

**步骤 2: 在 preload.js 暴露方法**

```javascript
vaultPick: () => ipcRenderer.invoke('vault:pick'),
vaultList: () => ipcRenderer.invoke('vault:list'),
vaultRemove: (vaultId) => ipcRenderer.invoke('vault:remove', vaultId),
```

**步骤 3: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动无报错（UI 暂未使用这些 IPC）

---

### 任务 3: IPC — 扫描 Vault 文件 + 读取内容

**文件：**
- 修改：`electron/main.js`（添加扫描和读取 IPC）

**步骤 1: 添加 vault 文件扫描 IPC**

```javascript
// 扫描 vault 中所有 .md 文件
ipcMain.handle('vault:scan', async (event, vaultPath) => {
  const glob = require('path')
  const files = []
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // 跳过隐藏目录
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath)
      } else if (entry.name.endsWith('.md')) {
        const stat = fs.statSync(fullPath)
        const relativePath = path.relative(vaultPath, fullPath)
        files.push({
          path: fullPath,
          relativePath,
          name: entry.name,
          mtime: stat.mtimeMs
        })
      }
    }
  }
  walkDir(vaultPath)
  return files
})

// 读取单个文件内容
ipcMain.handle('vault:readFile', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8')
})
```

**步骤 2: 在 preload.js 暴露**

```javascript
vaultScan: (vaultPath) => ipcRenderer.invoke('vault:scan', vaultPath),
vaultReadFile: (filePath) => ipcRenderer.invoke('vault:readFile', filePath),
```

**步骤 3: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动无报错

---

### 任务 4: chokidar 文件监听 + IPC 事件推送

**文件：**
- 修改：`electron/main.js`（添加 watcher 管理）
- 修改：`electron/preload.js`（添加事件监听）

**步骤 1: 在 main.js 添加 watcher 管理**

```javascript
const chokidar = require('chokidar')
const watchers = new Map() // vaultId → watcher

ipcMain.handle('vault:watch', async (event, vaultId, vaultPath) => {
  if (watchers.has(vaultId)) return // 已在监听

  const watcher = chokidar.watch('**/*.md', {
    cwd: vaultPath,
    ignored: /(^|[\/\\])\../, // 忽略隐藏文件/目录
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher.on('change', (relativePath) => {
    const fullPath = path.join(vaultPath, relativePath)
    const stat = fs.statSync(fullPath)
    mainWindow?.webContents.send('vault:fileChanged', {
      vaultId, type: 'change',
      file: { path: fullPath, relativePath, name: path.basename(relativePath), mtime: stat.mtimeMs }
    })
  })

  watcher.on('add', (relativePath) => {
    const fullPath = path.join(vaultPath, relativePath)
    const stat = fs.statSync(fullPath)
    mainWindow?.webContents.send('vault:fileChanged', {
      vaultId, type: 'add',
      file: { path: fullPath, relativePath, name: path.basename(relativePath), mtime: stat.mtimeMs }
    })
  })

  watcher.on('unlink', (relativePath) => {
    mainWindow?.webContents.send('vault:fileChanged', {
      vaultId, type: 'unlink',
      file: { path: path.join(vaultPath, relativePath), relativePath, name: path.basename(relativePath) }
    })
  })

  watchers.set(vaultId, watcher)
})

ipcMain.handle('vault:unwatch', async (event, vaultId) => {
  const watcher = watchers.get(vaultId)
  if (watcher) {
    await watcher.close()
    watchers.delete(vaultId)
  }
})

// 应用退出时关闭所有 watcher
app.on('before-quit', () => {
  for (const [, watcher] of watchers) watcher.close()
})
```

**步骤 2: 在 preload.js 添加事件监听**

```javascript
onVaultFileChanged: (callback) => {
  ipcRenderer.on('vault:fileChanged', (event, data) => callback(data))
  return () => ipcRenderer.removeAllListeners('vault:fileChanged')
},
vaultWatch: (vaultId, vaultPath) => ipcRenderer.invoke('vault:watch', vaultId, vaultPath),
vaultUnwatch: (vaultId) => ipcRenderer.invoke('vault:unwatch', vaultId),
```

**步骤 3: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动无报错

---

### 任务 5: Obsidian 解析服务（front-matter + wiki-links）

**文件：**
- 创建：`src/services/obsidianParser.js`

**步骤 1: 创建解析服务**

```javascript
import matter from 'gray-matter'

export function parseObsidianFile(content, relativePath) {
  const { data: frontMatter, content: body } = matter(content)

  // 提取 [[wiki-links]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  const links = []
  let match
  while ((match = wikiLinkRegex.exec(body)) !== null) {
    links.push({
      target: match[1].trim(),
      alias: match[2]?.trim() || null
    })
  }

  // 提取 tags（front-matter 中的 tags + 正文中的 #tag）
  const fmTags = Array.isArray(frontMatter.tags) ? frontMatter.tags : []
  const inlineTagRegex = /(?:^|\s)#([a-zA-Z一-鿿][\w一-鿿/]*)/g
  const inlineTags = []
  while ((match = inlineTagRegex.exec(body)) !== null) {
    inlineTags.push(match[1])
  }
  const tags = [...new Set([...fmTags, ...inlineTags])]

  return {
    frontMatter,
    body,
    links,
    tags,
    title: frontMatter.title || relativePath.replace(/\.md$/, '').split('/').pop()
  }
}
```

注意：gray-matter 是 Node.js 库，在渲染进程（浏览器环境）中无法直接使用。需要在主进程中解析，通过 IPC 返回结果。

**步骤 1b: 改为在主进程中解析**

在 `electron/main.js` 添加解析 IPC：

```javascript
ipcMain.handle('vault:parseFile', async (event, filePath) => {
  const matter = require('gray-matter')
  const content = fs.readFileSync(filePath, 'utf-8')
  const { data: frontMatter, content: body } = matter(content)

  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  const links = []
  let match
  while ((match = wikiLinkRegex.exec(body)) !== null) {
    links.push({ target: match[1].trim(), alias: match[2]?.trim() || null })
  }

  const fmTags = Array.isArray(frontMatter.tags) ? frontMatter.tags : []
  const inlineTagRegex = /(?:^|\s)#([a-zA-Z一-鿿][\w一-鿿/]*)/g
  const inlineTags = []
  while ((match = inlineTagRegex.exec(body)) !== null) {
    inlineTags.push(match[1])
  }

  return {
    frontMatter,
    body,
    links,
    tags: [...new Set([...fmTags, ...inlineTags])]
  }
})
```

preload.js 暴露：
```javascript
vaultParseFile: (filePath) => ipcRenderer.invoke('vault:parseFile', filePath),
```

**步骤 2: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动无报错

---

### 任务 6: IndexedDB Schema 升级（v4）+ Vault 存储服务

**文件：**
- 修改：`src/services/storageService.js`

**步骤 1: 升级 DB_VERSION 到 4，添加新 store**

DB_VERSION 改为 4，STORE_NAMES 添加 `VAULT_META: 'obsidianVaults'` 和 `WIKI_LINKS: 'wikiLinks'`。

在 onupgradeneeded 中添加 v4 升级：

```javascript
if (event.oldVersion < 4) {
  const vaultStore = db.createObjectStore('obsidianVaults', { keyPath: 'id' })
  const linkStore = db.createObjectStore('wikiLinks', { keyPath: 'id', autoIncrement: true })
  linkStore.createIndex('bySource', 'sourceFile', { unique: false })
  linkStore.createIndex('byTarget', 'targetNote', { unique: false })
  linkStore.createIndex('byVault', 'vaultId', { unique: false })
}
```

**步骤 2: 添加 vault CRUD 和 wiki-link 函数**

```javascript
export async function saveVaultMeta(vault) { /* put to obsidianVaults */ }
export async function getVaultMetas() { /* getAll from obsidianVaults */ }
export async function deleteVaultMeta(vaultId) { /* delete + 清理 chunks/links */ }
export async function saveWikiLinks(vaultId, sourceFile, links) { /* 批量写入 */ }
export async function getWikiLinksBySource(sourceFile) { /* index 查询 */ }
export async function getWikiLinksByTarget(targetNote) { /* index 查询 */ }
export async function deleteWikiLinksByVault(vaultId) { /* index 查询 + 批量删除 */ }
```

**步骤 3: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动，IndexedDB 自动升级到 v4

---

### 任务 7: Vault 索引服务（增量分块 + embedding）

**文件：**
- 创建：`src/services/vaultService.js`

核心函数：
- `vaultKbId(vaultId)` → `'vault:{vaultId}'`
- `vaultFileId(vaultId, relativePath)` → `'{vaultId}:{relativePath}'`
- `indexVaultFile(vaultId, file)` → 读取 → 解析 → 删旧 chunks → 分块 → embed → 存储 + 缓存 → 保存 wiki-links
- `removeVaultFile(vaultId, relativePath)` → 删除 chunks + 缓存
- `syncVault(vaultId, vaultPath, onProgress)` → 全量扫描 → 逐文件索引
- `handleFileChange(event)` → 处理 chokidar 的 add/change/unlink 事件

**步骤 1: 创建 vaultService.js**

（完整代码见任务 5 中的 obsidianParser 设计，此处复用 chunker + embeddingService + storageService）

**步骤 2: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：应用启动无报错

---

### 任务 8: KBSidebar UI — 添加 Obsidian Vault 区域

**文件：**
- 修改：`src/components/KBSidebar.jsx`

在现有知识库列表下方添加 "Obsidian 仓库" 分区，包含：
- vault 列表（从 electron-store 加载）
- "链接仓库" 按钮（调用 vault:pick IPC）
- 点击 vault 设置 kbScope（type: 'vault'）
- "取消链接" 按钮
- "同步中..." 状态指示

**步骤 1: 实现 vault UI**

（详细代码在实施时编写）

**步骤 2: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：知识库页面底部出现 "Obsidian 仓库" 区域

---

### 任务 9: 首次全量同步 + chokidar 启动

**文件：**
- 修改：`src/components/KBSidebar.jsx`

链接 vault 后：
1. 调用 syncVault 全量索引
2. 启动 chokidar watcher
3. 应用启动时恢复所有 vault 的 watcher
4. 监听 vault:fileChanged 事件，调用 handleFileChange 增量更新

**步骤 1: 实现同步 + watcher 逻辑**

**步骤 2: 验证**

运行：`npm run build && npx electron . --no-sandbox`
预期：链接 vault → 同步完成 → 修改 .md 文件 → 增量索引

---

### 任务 10: AI 对话集成 — vault 作为 RAG 数据源

**文件：**
- 修改：`src/services/aiService.js`（如需）

vault 的 chunks 存储时 kbId 使用 `vault:{vaultId}` 前缀。现有 `buildContextMessage` 中 `kbScope.type !== 'none'` 条件已覆盖 vault 类型，`loadKbVectorsToCache` 按 kbId 过滤也已兼容。理论上无需修改。

验证：选择 vault → 发送消息 → 确认 RAG 检索命中 vault 内容。

---

### 任务 11: 端到端测试 + 清理

完整流程测试：链接 vault → 全量同步 → AI 对话引用 vault 内容 → Obsidian 修改文件 → 增量更新 → 再次对话验证。清理 debug 日志。
