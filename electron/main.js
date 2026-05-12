const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const chokidar = require('chokidar')

const store = new Store({
  defaults: {
    vaults: []
  }
})

const watchers = new Map()

// 判断是否为开发模式
// 如果dist目录存在且包含index.html，优先使用生产模式
const distPath = path.join(__dirname, '../dist/index.html')
const distExists = fs.existsSync(distPath)
const isDev = process.env.NODE_ENV === 'development' && !distExists

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      // 允许访问本地文件系统（用于IndexedDB）
      partition: 'persist:main'
    },
    titleBarStyle: 'default',
    show: false // 先不显示，等加载完成后再显示
  })

  // 加载应用
  if (isDev && process.env.ELECTRON_DEV === 'true') {
    // 开发模式：加载Vite开发服务器（需要先启动vite）
    console.log('开发模式：等待Vite服务器启动...')
    const checkServer = setInterval(() => {
      fetch('http://localhost:3000')
        .then(() => {
          clearInterval(checkServer)
          clearTimeout(serverTimeout)
          mainWindow.loadURL('http://localhost:3000')
          mainWindow.webContents.openDevTools()
        })
        .catch(() => {
          // 服务器还没启动，继续等待
        })
    }, 1000)

    // 10秒后如果还没启动，显示错误
    const serverTimeout = setTimeout(() => {
      clearInterval(checkServer)
      if (!mainWindow.isDestroyed()) {
        mainWindow.loadURL('data:text/html;charset=utf-8,<h1>无法连接到开发服务器</h1><p>请先运行: npm run dev</p>')
        mainWindow.show()
      }
    }, 10000)
  } else {
    // 生产模式：加载打包后的文件
    console.log('生产模式：加载打包文件...')
    const indexPath = path.join(__dirname, '../dist/index.html')
    
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath).catch(err => {
        console.error('加载文件失败:', err)
        mainWindow.loadURL('data:text/html,<h1>加载失败</h1><p>错误: ' + err.message + '</p>')
        mainWindow.show()
      })
    } else {
      console.error('找不到dist/index.html文件')
      mainWindow.loadURL('data:text/html,<h1>应用文件未找到</h1><p>请先运行: npm run build</p><p>当前路径: ' + indexPath + '</p>')
      mainWindow.show()
    }
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 监听加载错误
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('加载失败:', errorCode, errorDescription, validatedURL)
    if (errorCode === -6) {
      // ERR_FILE_NOT_FOUND
      mainWindow.loadURL('data:text/html,<h1>文件未找到</h1><p>请先运行: npm run build</p>')
    }
  })

  // 窗口关闭前处理（确保数据保存）
  mainWindow.on('close', (event) => {
    // IndexedDB数据会自动持久化，无需额外处理
    // 但可以在这里添加其他清理逻辑
    mainWindow = null
  })

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url)
    return { action: 'deny' }
  })
}

// 应用准备就绪
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出（macOS除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 安全：阻止新窗口创建
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault()
    require('electron').shell.openExternal(navigationUrl)
  })
})

// Claude API 调用（在主进程中执行，避免浏览器 CORS 限制）
ipcMain.handle('claude:chat', async (event, { apiKey, model, messages, systemPrompt }) => {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic.default({ apiKey })
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages
  })
  return response.content[0].text
})

// Gemini API 调用（使用 undici 的 fetch，避免 macOS LibreSSL 兼容性问题）
ipcMain.handle('gemini:chat', async (event, { apiKey, model, systemPrompt, history, message }) => {
  const { fetch: undiciFetch, ProxyAgent } = require('undici')

  // 读取系统代理配置
  let dispatcher
  try {
    const proxyInfo = require('child_process').execSync('scutil --proxy', { encoding: 'utf8' })
    const portMatch = proxyInfo.match(/HTTPSPort\s*:\s*(\d+)/)
    const enableMatch = proxyInfo.match(/HTTPSEnable\s*:\s*(\d+)/)
    if (portMatch && enableMatch && enableMatch[1] === '1') {
      dispatcher = new ProxyAgent(`http://127.0.0.1:${portMatch[1]}`)
    }
  } catch (e) { /* 无代理 */ }

  const contents = [...history, { role: 'user', parts: [{ text: message }] }]
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents
  })

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }
  if (dispatcher) fetchOptions.dispatcher = dispatcher

  const response = await undiciFetch(url, fetchOptions)
  const json = await response.json()

  if (!response.ok || json.error) {
    const msg = json.error ? `API错误 ${json.error.code}: ${json.error.message}` : `HTTP ${response.status}`
    throw new Error(msg)
  }

  return json.candidates[0].content.parts[0].text
})

// Gemini Embedding API 调用
ipcMain.handle('gemini:embed', async (event, { apiKey, texts }) => {
  const { fetch: undiciFetch, ProxyAgent } = require('undici')

  let dispatcher
  try {
    const proxyInfo = require('child_process').execSync('scutil --proxy', { encoding: 'utf8' })
    const portMatch = proxyInfo.match(/HTTPSPort\s*:\s*(\d+)/)
    const enableMatch = proxyInfo.match(/HTTPSEnable\s*:\s*(\d+)/)
    if (portMatch && enableMatch && enableMatch[1] === '1') {
      dispatcher = new ProxyAgent(`http://127.0.0.1:${portMatch[1]}`)
    }
  } catch (e) { /* 无代理 */ }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`
  const body = JSON.stringify({
    requests: texts.map(text => ({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] }
    }))
  })

  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }
  if (dispatcher) fetchOptions.dispatcher = dispatcher

  const response = await undiciFetch(url, fetchOptions)
  const json = await response.json()

  if (!response.ok || json.error) {
    const msg = json.error ? `Embedding错误 ${json.error.code}: ${json.error.message}` : `HTTP ${response.status}`
    throw new Error(msg)
  }

  return json.embeddings.map(e => e.values)
})

// Gemini Rerank（使用 LLM 打分实现）
ipcMain.handle('gemini:rerank', async (event, { apiKey, query, candidates }) => {
  const { fetch: undiciFetch, ProxyAgent } = require('undici')

  let dispatcher
  try {
    const proxyInfo = require('child_process').execSync('scutil --proxy', { encoding: 'utf8' })
    const portMatch = proxyInfo.match(/HTTPSPort\s*:\s*(\d+)/)
    const enableMatch = proxyInfo.match(/HTTPSEnable\s*:\s*(\d+)/)
    if (portMatch && enableMatch && enableMatch[1] === '1') {
      dispatcher = new ProxyAgent(`http://127.0.0.1:${portMatch[1]}`)
    }
  } catch (e) { /* 无代理 */ }

  const prompt = `你是一个相关性评分器。给定一个查询和若干候选文本片段，为每个片段打分（0-10），只返回 JSON 数组。

查询：${query}

候选片段：
${candidates.map((c, i) => `[${i}] ${c}`).join('\n\n')}

返回格式：[{"index": 0, "score": 8}, ...]，只返回 JSON，不要其他文字。`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  })

  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }
  if (dispatcher) fetchOptions.dispatcher = dispatcher

  const response = await undiciFetch(url, fetchOptions)
  const json = await response.json()

  if (!response.ok || json.error) {
    const msg = json.error ? `Rerank错误 ${json.error.code}: ${json.error.message}` : `HTTP ${response.status}`
    throw new Error(msg)
  }

  const text = json.candidates[0].content.parts[0].text
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  return jsonMatch ? JSON.parse(jsonMatch[0]) : []
})

// OAuth PKCE 流程：打开隐藏窗口完成授权，拦截 localhost 回调
ipcMain.handle('oauth:start', async (event, authUrl) => {
  return new Promise((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    })

    authWin.loadURL(authUrl)

    let settled = false

    function handleNavigation(url) {
      if (!url || !url.startsWith('http://localhost')) return false
      if (settled) return true
      settled = true
      try {
        const parsed = new URL(url)
        const code = parsed.searchParams.get('code')
        const error = parsed.searchParams.get('error')
        if (!authWin.isDestroyed()) authWin.destroy()
        if (error) {
          reject(new Error(`OAuth 错误: ${error}`))
        } else if (code) {
          resolve(code)
        } else {
          reject(new Error('未获取到授权码'))
        }
      } catch (e) {
        if (!authWin.isDestroyed()) authWin.destroy()
        reject(e)
      }
      return true
    }

    // 拦截重定向（授权完成时 Microsoft 会 302 到 http://localhost?code=...）
    authWin.webContents.on('will-redirect', (e, url) => {
      if (handleNavigation(url)) e.preventDefault()
    })

    // 备用：有些版本触发 will-navigate 而非 will-redirect
    authWin.webContents.on('will-navigate', (e, url) => {
      if (handleNavigation(url)) e.preventDefault()
    })

    // 备用：localhost 无服务器时会触发加载失败，从 validatedURL 提取 code
    authWin.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedURL) => {
      handleNavigation(validatedURL)
    })

    authWin.on('closed', () => {
      if (!settled) reject(new Error('用户关闭了授权窗口'))
    })
  })
})

// ── Obsidian Vault IPC ──

ipcMain.handle('vault:pick', async () => {
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

ipcMain.handle('vault:list', async () => {
  return store.get('vaults', [])
})

ipcMain.handle('vault:remove', async (event, vaultId) => {
  const vaults = store.get('vaults', []).filter(v => v.id !== vaultId)
  store.set('vaults', vaults)
  const watcher = watchers.get(vaultId)
  if (watcher) {
    await watcher.close()
    watchers.delete(vaultId)
  }
  return true
})

ipcMain.handle('vault:scan', async (event, vaultPath) => {
  const files = []
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath)
      } else if (entry.name.endsWith('.md')) {
        const stat = fs.statSync(fullPath)
        files.push({
          path: fullPath,
          relativePath: path.relative(vaultPath, fullPath),
          name: entry.name,
          mtime: stat.mtimeMs
        })
      }
    }
  }
  walkDir(vaultPath)
  return files
})

ipcMain.handle('vault:readFile', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8')
})

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

ipcMain.handle('vault:watch', async (event, vaultId, vaultPath) => {
  if (watchers.has(vaultId)) return

  const watcher = chokidar.watch('**/*.md', {
    cwd: vaultPath,
    ignored: /(^|[/\\])\./,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher.on('change', (relativePath) => {
    try {
      const fullPath = path.join(vaultPath, relativePath)
      const stat = fs.statSync(fullPath)
      mainWindow?.webContents.send('vault:fileChanged', {
        vaultId, type: 'change',
        file: { path: fullPath, relativePath, name: path.basename(relativePath), mtime: stat.mtimeMs }
      })
    } catch (e) { /* file may have been deleted between events */ }
  })

  watcher.on('add', (relativePath) => {
    try {
      const fullPath = path.join(vaultPath, relativePath)
      const stat = fs.statSync(fullPath)
      mainWindow?.webContents.send('vault:fileChanged', {
        vaultId, type: 'add',
        file: { path: fullPath, relativePath, name: path.basename(relativePath), mtime: stat.mtimeMs }
      })
    } catch (e) { /* file may have been deleted */ }
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

app.on('before-quit', () => {
  for (const [, watcher] of watchers) watcher.close()
})
