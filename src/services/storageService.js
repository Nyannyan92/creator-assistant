// 文件存储服务 - 使用IndexedDB存储文件

const DB_NAME = 'CreatorAIToolDB'
const DB_VERSION = 4
const STORE_NAMES = {
  ARTICLES: 'articles',         // 过往文章
  PERSONAL: 'personal',         // 个人信息
  MATERIALS: 'materials',       // 素材信息（废弃但保留）
  KB_BASES: 'knowledgeBases',   // 知识库
  KB_FOLDERS: 'kbFolders',      // 知识库文件夹
  KB_FILES: 'kbFiles',          // 知识库文件
  KB_CHUNKS: 'kbChunks',        // 知识库分块（RAG 向量检索）
  VAULT_META: 'obsidianVaults', // Obsidian Vault 元数据
  WIKI_LINKS: 'wikiLinks'       // Wiki-link 图谱
}

// 文件大小限制：50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// 支持的文件类型
const SUPPORTED_TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/json',
  'application/pdf'
]

const TEXT_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.html', '.json', '.pdf']

/**
 * 初始化数据库
 */
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      // v1: 创建原有三个对象存储空间
      if (!db.objectStoreNames.contains(STORE_NAMES.ARTICLES)) {
        db.createObjectStore(STORE_NAMES.ARTICLES, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.PERSONAL)) {
        db.createObjectStore(STORE_NAMES.PERSONAL, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.MATERIALS)) {
        db.createObjectStore(STORE_NAMES.MATERIALS, { keyPath: 'id', autoIncrement: true })
      }

      // v2: 创建知识库相关存储空间
      if (event.oldVersion < 2) {
        db.createObjectStore(STORE_NAMES.KB_BASES, { keyPath: 'id', autoIncrement: true })
        db.createObjectStore(STORE_NAMES.KB_FOLDERS, { keyPath: 'id', autoIncrement: true })
        db.createObjectStore(STORE_NAMES.KB_FILES, { keyPath: 'id', autoIncrement: true })
      }

      // v3: 创建 kbChunks 存储空间（RAG 向量检索）
      if (event.oldVersion < 3) {
        const chunkStore = db.createObjectStore(STORE_NAMES.KB_CHUNKS, { keyPath: 'id', autoIncrement: true })
        chunkStore.createIndex('byFileId', 'fileId', { unique: false })
        chunkStore.createIndex('byKbId', 'kbId', { unique: false })
      }

      // v4: Obsidian Vault 元数据 + Wiki-link 图谱
      if (event.oldVersion < 4) {
        db.createObjectStore(STORE_NAMES.VAULT_META, { keyPath: 'id' })
        const linkStore = db.createObjectStore(STORE_NAMES.WIKI_LINKS, { keyPath: 'id', autoIncrement: true })
        linkStore.createIndex('bySource', 'sourceFile', { unique: false })
        linkStore.createIndex('byTarget', 'targetNote', { unique: false })
        linkStore.createIndex('byVault', 'vaultId', { unique: false })
      }
    }
  })
}

/**
 * 获取对象存储（每次调用都会创建新的事务）
 */
async function getStore(storeName) {
  const db = await initDB()
  const transaction = db.transaction([storeName], 'readwrite')
  return transaction.objectStore(storeName)
}

/**
 * 保存文件数据到数据库
 */
async function saveFileData(spaceType, fileData) {
  return new Promise(async (resolve, reject) => {
    try {
      const store = await getStore(spaceType)
      const request = store.add(fileData)
      
      request.onsuccess = () => {
        resolve({ ...fileData, id: request.result })
      }
      request.onerror = () => reject(request.error)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 检查文件大小
 * @param {File} file - 文件对象
 * @throws {Error} 如果文件过大
 */
function validateFileSize(file) {
  if (file.size > MAX_FILE_SIZE) {
    const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024)
    throw new Error(`文件大小超过限制（最大${maxSizeMB}MB）`)
  }
}

/**
 * 检查是否为文本文件
 * @param {File} file - 文件对象
 * @returns {boolean}
 */
function isTextFile(file) {
  return SUPPORTED_TEXT_TYPES.includes(file.type) ||
         TEXT_FILE_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))
}

// 初始化PDF.js worker（只执行一次）
let pdfjsWorkerInitialized = false

/**
 * 初始化PDF.js worker
 */
async function initPDFWorker() {
  if (pdfjsWorkerInitialized) return
  
  try {
    const pdfjsLib = await import('pdfjs-dist')
    
    // 尝试多个worker路径，按优先级顺序
    const workerPaths = [
      // 方案1: 使用jsdelivr CDN（国内访问更稳定）
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`,
      // 方案2: 使用unpkg CDN
      `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`,
      // 方案3: 使用cdnjs
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
    ]
    
    // 设置第一个worker路径
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPaths[0]
    pdfjsWorkerInitialized = true
  } catch (error) {
    console.warn('PDF worker初始化警告:', error)
  }
}

/**
 * 从PDF提取文本内容
 * @param {File} file - PDF文件
 * @returns {Promise<string>} 提取的文本内容
 */
async function extractTextFromPDF(file) {
  try {
    // 确保worker已初始化
    await initPDFWorker()
    
    // 动态导入pdfjs-dist
    const pdfjsLib = await import('pdfjs-dist')
    
    // 读取文件为ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    
    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      verbosity: 0 // 减少日志输出
    })
    
    const pdf = await loadingTask.promise
    
    // 提取所有页面的文本
    let fullText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
      fullText += pageText + '\n\n'
    }
    
    return fullText.trim()
  } catch (error) {
    console.error('PDF文本提取失败:', error)
    
    // 如果是worker相关错误，尝试使用备选CDN
    if (error.message && (error.message.includes('worker') || error.message.includes('Failed to fetch'))) {
      try {
        console.log('尝试使用备选worker路径...')
        const pdfjsLib = await import('pdfjs-dist')
        // 切换到备选CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
        
        // 重试提取
        const arrayBuffer = await file.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 })
        const pdf = await loadingTask.promise
        
        let fullText = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map(item => item.str).join(' ')
          fullText += pageText + '\n\n'
        }
        
        return fullText.trim()
      } catch (retryError) {
        throw new Error(`无法提取PDF文本内容。请检查网络连接或尝试使用其他PDF文件。错误: ${retryError.message}`)
      }
    }
    
    throw new Error(`无法提取PDF文本内容: ${error.message}`)
  }
}

/**
 * 上传文件到指定存储空间
 * @param {string} spaceType - 存储空间类型 ('articles', 'personal', 'materials')
 * @param {File} file - 文件对象
 * @returns {Promise<Object>} 文件信息
 */
export async function uploadFile(spaceType, file) {
  // 验证文件大小
  validateFileSize(file)
  
  const isText = isTextFile(file)
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  
  const fileData = {
    name: file.name,
    type: file.type,
    size: file.size,
    uploadTime: new Date().toISOString(),
    isText: isText
  }

  try {
    // 处理PDF文件
    if (isPDF) {
      // 先提取PDF文本内容
      fileData.textContent = await extractTextFromPDF(file)
      fileData.content = fileData.textContent
      
      // PDF处理完成，保存到数据库（使用新的事务）
      return await saveFileData(spaceType, fileData)
    }
    
    // 处理其他文本文件
    if (isText) {
      return new Promise((resolve, reject) => {
        const textReader = new FileReader()
        textReader.onload = async (textEvent) => {
          try {
            fileData.textContent = textEvent.target.result
            fileData.content = fileData.textContent
            
            // 保存到数据库（使用新的事务）
            const result = await saveFileData(spaceType, fileData)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        }
        textReader.onerror = () => reject(textReader.error)
        textReader.readAsText(file)
      })
    }
    
    // 非文本文件，存储为base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          fileData.content = e.target.result // base64
          
          // 保存到数据库（使用新的事务）
          const result = await saveFileData(spaceType, fileData)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  } catch (error) {
    throw error
  }
}

/**
 * 获取指定存储空间的所有文件
 * @param {string} spaceType - 存储空间类型
 * @returns {Promise<Array>} 文件列表
 */
export async function getFiles(spaceType) {
  return new Promise(async (resolve, reject) => {
    try {
      const store = await getStore(spaceType)
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 删除文件
 * @param {string} spaceType - 存储空间类型
 * @param {number} fileId - 文件ID
 * @returns {Promise<void>}
 */
export async function deleteFile(spaceType, fileId) {
  return new Promise(async (resolve, reject) => {
    try {
      const store = await getStore(spaceType)
      const request = store.delete(fileId)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 获取文件内容（用于AI上下文）
 * @param {string} spaceType - 存储空间类型
 * @returns {Promise<string>} 所有文件的文本内容
 */
export async function getFilesContent(spaceType) {
  try {
    const files = await getFiles(spaceType)
    const contents = files
      .filter(file => file.isText && file.textContent)
      .map(file => `文件名: ${file.name}\n内容:\n${file.textContent}`)
      .join('\n\n---\n\n')
    return contents
  } catch (error) {
    console.error('获取文件内容失败:', error)
    return ''
  }
}

/**
 * 保存文本内容到指定存储空间（在线编辑）
 * @param {string} spaceType - 存储空间类型
 * @param {string} title - 内容标题
 * @param {string} content - 文本内容
 * @returns {Promise<Object>} 保存的文件信息
 */
export async function saveTextContent(spaceType, title, content) {
  if (!title || !title.trim()) {
    throw new Error('标题不能为空')
  }
  if (!content || !content.trim()) {
    throw new Error('内容不能为空')
  }

  const fileData = {
    name: title.trim(),
    type: 'text/plain',
    size: new Blob([content]).size,
    uploadTime: new Date().toISOString(),
    isText: true,
    textContent: content,
    content: content,
    isManualEdit: true, // 标记为手动编辑的内容
    title: title.trim() // 单独存储标题字段
  }

  return await saveFileData(spaceType, fileData)
}

/**
 * 更新已存在的文本内容
 * @param {string} spaceType - 存储空间类型
 * @param {number} fileId - 文件ID
 * @param {string} title - 新的标题
 * @param {string} content - 新的文本内容
 * @returns {Promise<Object>} 更新后的文件信息
 */
export async function updateTextContent(spaceType, fileId, title, content) {
  if (!title || !title.trim()) {
    throw new Error('标题不能为空')
  }
  if (!content || !content.trim()) {
    throw new Error('内容不能为空')
  }

  return new Promise(async (resolve, reject) => {
    try {
      const store = await getStore(spaceType)
      
      // 先获取原文件
      const getRequest = store.get(fileId)
      getRequest.onsuccess = async () => {
        const fileData = getRequest.result
        if (!fileData) {
          reject(new Error('文件不存在'))
          return
        }

        // 更新标题和内容
        fileData.name = title.trim()
        fileData.title = title.trim()
        fileData.textContent = content
        fileData.content = content
        fileData.size = new Blob([content]).size
        fileData.uploadTime = new Date().toISOString()

        // 保存更新
        const updateRequest = store.put(fileData)
        updateRequest.onsuccess = () => {
          resolve({ ...fileData, id: updateRequest.result })
        }
        updateRequest.onerror = () => reject(updateRequest.error)
      }
      getRequest.onerror = () => reject(getRequest.error)
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 获取所有存储空间的内容（用于AI上下文）
 * @returns {Promise<Object>} 包含三个空间内容的对象
 */
export async function getAllSpacesContent() {
  return {
    articles: await getFilesContent(STORE_NAMES.ARTICLES),
    personal: await getFilesContent(STORE_NAMES.PERSONAL)
  }
}

// ==================== 知识库 CRUD ====================

async function getDB() {
  return initDB()
}

export async function createKnowledgeBase(name, description = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_BASES], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.KB_BASES)
      const now = new Date().toISOString()
      const req = store.add({ name, description, createdAt: now, updatedAt: now })
      req.onsuccess = () => resolve({ id: req.result, name, description, createdAt: now, updatedAt: now })
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getKnowledgeBases() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_BASES], 'readonly')
      const req = tx.objectStore(STORE_NAMES.KB_BASES).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function updateKnowledgeBase(kbId, name) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_BASES], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.KB_BASES)
      const getReq = store.get(kbId)
      getReq.onsuccess = () => {
        const data = { ...getReq.result, name, updatedAt: new Date().toISOString() }
        const putReq = store.put(data)
        putReq.onsuccess = () => resolve(data)
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteKnowledgeBase(kbId) {
  // 级联删除文件夹和文件
  const folders = await getFolders(kbId)
  for (const folder of folders) {
    await deleteFolder(folder.id)
  }
  // 删除根目录文件
  const rootFiles = await getKBFiles(kbId, null)
  for (const file of rootFiles) {
    await deleteKBFile(file.id)
  }
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_BASES], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.KB_BASES).delete(kbId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

// ==================== 文件夹 CRUD ====================

export async function createFolder(kbId, name) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FOLDERS], 'readwrite')
      const now = new Date().toISOString()
      const req = tx.objectStore(STORE_NAMES.KB_FOLDERS).add({ kbId, name, createdAt: now })
      req.onsuccess = () => resolve({ id: req.result, kbId, name, createdAt: now })
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getFolders(kbId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FOLDERS], 'readonly')
      const req = tx.objectStore(STORE_NAMES.KB_FOLDERS).getAll()
      req.onsuccess = () => resolve((req.result || []).filter(f => f.kbId === kbId))
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function updateFolder(folderId, name) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FOLDERS], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.KB_FOLDERS)
      const getReq = store.get(folderId)
      getReq.onsuccess = () => {
        const data = { ...getReq.result, name }
        const putReq = store.put(data)
        putReq.onsuccess = () => resolve(data)
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteFolder(folderId) {
  // 级联删除文件夹下所有文件
  const files = await getKBFilesByFolder(folderId)
  for (const file of files) {
    await deleteKBFile(file.id)
  }
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FOLDERS], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.KB_FOLDERS).delete(folderId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

// ==================== 知识库文件 CRUD ====================

async function getKBFilesByFolder(folderId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FILES], 'readonly')
      const req = tx.objectStore(STORE_NAMES.KB_FILES).getAll()
      req.onsuccess = () => resolve((req.result || []).filter(f => f.folderId === folderId))
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

const KB_SUPPORTED_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/html']
const KB_SUPPORTED_EXTS = ['.pdf', '.txt', '.md', '.markdown', '.html', '.htm']

export async function uploadKBFile(kbId, folderId, file) {
  validateFileSize(file)

  const ext = file.name.toLowerCase()
  const isSupported = KB_SUPPORTED_TYPES.includes(file.type) ||
    KB_SUPPORTED_EXTS.some(e => ext.endsWith(e))
  if (!isSupported) {
    throw new Error('仅支持 PDF、TXT、MD、HTML 格式文件')
  }

  const isPDF = file.type === 'application/pdf' || ext.endsWith('.pdf')
  const isHTML = file.type === 'text/html' || ext.endsWith('.html') || ext.endsWith('.htm')
  const fileData = {
    kbId,
    folderId: folderId ?? null,
    name: file.name,
    type: file.type,
    size: file.size,
    uploadTime: new Date().toISOString(),
    isText: true
  }

  if (isPDF) {
    fileData.textContent = await extractTextFromPDF(file)
    fileData.content = fileData.textContent
  } else if (isHTML) {
    const raw = await new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = e => res(e.target.result)
      reader.onerror = () => rej(reader.error)
      reader.readAsText(file)
    })
    // 用 DOMParser 提取纯文本，去掉 HTML 标签噪音
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    // 移除 script/style 标签
    doc.querySelectorAll('script, style').forEach(el => el.remove())
    fileData.textContent = doc.body?.innerText || doc.body?.textContent || raw
    fileData.content = fileData.textContent
  } else {
    fileData.textContent = await new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = e => res(e.target.result)
      reader.onerror = () => rej(reader.error)
      reader.readAsText(file)
    })
    fileData.content = fileData.textContent
  }

  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FILES], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.KB_FILES).add(fileData)
      req.onsuccess = () => {
        const savedFile = { ...fileData, id: req.result }
        import('./ragPipeline').then(({ indexFile }) => {
          indexFile(req.result, kbId, file.name, fileData.textContent).catch(e =>
            console.warn('RAG 索引失败:', e)
          )
        })
        resolve(savedFile)
      }
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getKBFiles(kbId, folderId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FILES], 'readonly')
      const req = tx.objectStore(STORE_NAMES.KB_FILES).getAll()
      req.onsuccess = () => {
        const all = req.result || []
        const filtered = all.filter(f =>
          f.kbId === kbId && f.folderId === (folderId ?? null)
        )
        resolve(filtered)
      }
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteKBFile(fileId) {
  await deleteChunksByFile(fileId)
  import('./embeddingService').then(({ removeCachedVectors }) => removeCachedVectors(fileId))
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_FILES], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.KB_FILES).delete(fileId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getKBContent(kbId, folderId) {
  const files = await getKBFiles(kbId, folderId ?? null)
  const parts = files
    .filter(f => f.isText && f.textContent)
    .map(f => `文件名: ${f.name}\n内容:\n${f.textContent}`)
  return parts.join('\n\n---\n\n')
}

// ==================== 知识库分块 CRUD（RAG 向量检索） ====================

export async function saveChunks(fileId, kbId, chunks, vectors) {
  const db = await getDB()
  const tx = db.transaction([STORE_NAMES.KB_CHUNKS], 'readwrite')
  const store = tx.objectStore(STORE_NAMES.KB_CHUNKS)
  const ids = []
  for (let i = 0; i < chunks.length; i++) {
    const record = {
      fileId,
      kbId,
      text: chunks[i].text,
      heading: chunks[i].heading || null,
      fileName: chunks[i].fileName,
      vector: vectors[i],
      createdAt: new Date().toISOString()
    }
    const req = store.add(record)
    ids.push(new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  }
  return Promise.all(ids)
}

export async function getChunksByFile(fileId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_CHUNKS], 'readonly')
      const store = tx.objectStore(STORE_NAMES.KB_CHUNKS)
      const index = store.index('byFileId')
      const req = index.getAll(fileId)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getChunksByKb(kbId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_CHUNKS], 'readonly')
      const store = tx.objectStore(STORE_NAMES.KB_CHUNKS)
      const index = store.index('byKbId')
      const req = index.getAll(kbId)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteChunksByFile(fileId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_CHUNKS], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.KB_CHUNKS)
      const index = store.index('byFileId')
      const req = index.getAll(fileId)
      req.onsuccess = () => {
        const records = req.result || []
        records.forEach(r => store.delete(r.id))
        resolve(records.length)
      }
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteChunksByKb(kbId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.KB_CHUNKS], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.KB_CHUNKS)
      const index = store.index('byKbId')
      const req = index.getAll(kbId)
      req.onsuccess = () => {
        const records = req.result || []
        records.forEach(r => store.delete(r.id))
        resolve(records.length)
      }
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

// ==================== Obsidian Vault 元数据 ====================

export async function saveVaultMeta(vault) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.VAULT_META], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.VAULT_META).put(vault)
      req.onsuccess = () => resolve(vault)
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getVaultMetas() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.VAULT_META], 'readonly')
      const req = tx.objectStore(STORE_NAMES.VAULT_META).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteVaultMeta(vaultId) {
  await deleteChunksByKb(`vault:${vaultId}`)
  await deleteWikiLinksByVault(vaultId)
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.VAULT_META], 'readwrite')
      const req = tx.objectStore(STORE_NAMES.VAULT_META).delete(vaultId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

// ==================== Wiki-link 图谱 ====================

export async function saveWikiLinks(vaultId, sourceFile, links) {
  const db = await getDB()
  // 先删除该文件的旧 links
  const delTx = db.transaction([STORE_NAMES.WIKI_LINKS], 'readwrite')
  const delStore = delTx.objectStore(STORE_NAMES.WIKI_LINKS)
  const delIndex = delStore.index('bySource')
  const delReq = delIndex.getAll(sourceFile)
  await new Promise((resolve, reject) => {
    delReq.onsuccess = () => {
      const old = (delReq.result || []).filter(r => r.vaultId === vaultId)
      old.forEach(r => delStore.delete(r.id))
      resolve()
    }
    delReq.onerror = () => reject(delReq.error)
  })

  if (links.length === 0) return

  const tx = db.transaction([STORE_NAMES.WIKI_LINKS], 'readwrite')
  const store = tx.objectStore(STORE_NAMES.WIKI_LINKS)
  for (const link of links) {
    store.add({
      vaultId,
      sourceFile,
      targetNote: link.target,
      alias: link.alias
    })
  }
}

export async function getWikiLinksBySource(sourceFile) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.WIKI_LINKS], 'readonly')
      const index = tx.objectStore(STORE_NAMES.WIKI_LINKS).index('bySource')
      const req = index.getAll(sourceFile)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function getWikiLinksByTarget(targetNote) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.WIKI_LINKS], 'readonly')
      const index = tx.objectStore(STORE_NAMES.WIKI_LINKS).index('byTarget')
      const req = index.getAll(targetNote)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}

export async function deleteWikiLinksByVault(vaultId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB()
      const tx = db.transaction([STORE_NAMES.WIKI_LINKS], 'readwrite')
      const store = tx.objectStore(STORE_NAMES.WIKI_LINKS)
      const index = store.index('byVault')
      const req = index.getAll(vaultId)
      req.onsuccess = () => {
        const records = req.result || []
        records.forEach(r => store.delete(r.id))
        resolve(records.length)
      }
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
}
