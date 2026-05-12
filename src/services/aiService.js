// AI服务 - 处理Gemini / Claude API调用

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || ''

// 创作助手系统提示（来自 .claude/skills/interactive-writing-assistant）
const WRITING_ASSISTANT_SYSTEM_PROMPT = `你是花木菜菜子的专属创作助手，支持从构思到修订的全流程写作协作。

## 核心原则

### COP（大纲+正文共同演进）
大纲和正文同步发展，格式如下：
\`\`\`
## 章节标题
%%
- 大纲要点 1
- 大纲要点 2
%%

正文内容...
\`\`\`
- 只有大纲时，补充正文；只有正文时，补充大纲
- 更新大纲时同步更新正文，反之亦然

### VUI（语音输入处理）
用户输入可能来自语音，需先解析指令再执行。

## 写作流程工具

- **IDH（灵感助手）**：从知识库挖掘相关内容，以引用块（>）插入草稿
- **OEX（大纲扩展）**：填补逻辑空白，完善大纲结构
- **IVT（语音转录优化）**：修正语法错误，添加章节标题和格式
- **PRW（段落写作）**：根据大纲展开正文，直接写入文档
- **DEN（草稿润色）**：检查整体流畅度，平衡段落长度，修正语法
- **DAV（批判性审阅）**：批判主要论点，提供反驳视角，以注释形式添加建议
- **翻译**：自然语气翻译，修正生硬表达，标注文化差异

## 工作方式
- 写作是高度互动的任务，频繁征求反馈
- 直接在文档中更新内容，不在对话中粘贴
- 根据用户需求灵活组合以上工具`

/**
 * 发送消息到AI模型
 * @param {string} message - 用户消息
 * @param {string} model - 模型类型
 * @param {Array} history - 历史消息记录
 * @param {Object} kbScope - 知识库范围
 * @returns {Promise<string>} AI回复
 */
export async function sendMessage(message, model = 'gemini-3-flash', history = [], kbScope = null) {
  const isClaudeModel = model.startsWith('claude-')

  if (isClaudeModel) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('请设置 Claude API 密钥（VITE_ANTHROPIC_API_KEY）')
    }
  } else {
    if (!GEMINI_API_KEY) {
      throw new Error('请设置Gemini API密钥（VITE_GEMINI_API_KEY）')
    }
  }

  // 映射模型名称到实际的API模型ID
  const modelMap = {
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3-pro': 'gemini-3-pro-preview'
  }

  // 读取存储空间的内容作为上下文
  const { getAllSpacesContent, getKBContent } = await import('./storageService')
  const spacesContent = await getAllSpacesContent()

  // 构建包含上下文的完整消息
  const contextMessage = await buildContextMessage(message, spacesContent, kbScope, getKBContent)

  if (isClaudeModel) {
    return await sendToClaude(contextMessage, model, history)
  }

  const apiModelName = modelMap[model]
  if (!apiModelName) {
    throw new Error(`不支持的模型类型: ${model}`)
  }

  return await sendToGemini(contextMessage, apiModelName, history)
}

/**
 * 构建包含上下文的完整消息
 * @param {string} userMessage - 用户原始消息
 * @param {Object} spacesContent - 存储空间内容
 * @returns {string} 包含上下文的完整消息
 */
async function buildContextMessage(userMessage, spacesContent, kbScope, getKBContent) {
  let contextParts = []

  if (spacesContent.articles && spacesContent.articles.trim()) {
    contextParts.push(`## 过往文章（用于参考行文风格）\n${spacesContent.articles}`)
  }

  // RAG 检索替代全量拼接
  if (kbScope && kbScope.type !== 'none') {
    try {
      const { embedTexts, searchSimilar, rerankChunks } = await import('./embeddingService')
      const { loadKbVectorsToCache } = await import('./ragPipeline')

      await loadKbVectorsToCache(kbScope.kbId)

      const [queryVector] = await embedTexts([userMessage])

      const topChunks = await searchSimilar(queryVector, 6)

      if (topChunks.length > 0) {
        const reranked = await rerankChunks(userMessage, topChunks, 3)
        const ragContent = reranked.map((c, i) =>
          `### 参考片段 ${i + 1}（来源：${c.fileName}${c.heading ? ' > ' + c.heading : ''}）\n${c.text}`
        ).join('\n\n')
        contextParts.push(`## 知识库：${kbScope.label}（RAG 检索结果）\n${ragContent}`)
      } else {
        const kbContent = await getKBContent(kbScope.kbId, kbScope.folderId)
        if (kbContent) contextParts.push(`## 知识库：${kbScope.label}\n${kbContent}`)
      }
    } catch (e) {
      console.warn('RAG 检索失败，回退到全量拼接:', e)
      const kbContent = await getKBContent(kbScope.kbId, kbScope.folderId)
      if (kbContent) contextParts.push(`## 知识库：${kbScope.label}\n${kbContent}`)
    }
  }

  if (contextParts.length > 0) {
    const context = contextParts.join('\n\n---\n\n')
    return `以下是创作者的背景素材，请结合这些内容完成创作任务：

${context}

---

${userMessage}`
  }

  return userMessage
}

/**
 * 发送消息到Gemini
 * @param {string} message - 用户消息
 * @param {string} apiModelName - API模型名称（如 'gemini-3-flash-preview'）
 * @param {Array} history - 历史消息记录
 */
async function sendToGemini(message, apiModelName, history) {
  try {
    let filteredHistory = history.filter(msg => msg.role !== 'system')
    if (filteredHistory.length > 0 && filteredHistory[0].role === 'assistant') {
      filteredHistory = filteredHistory.slice(1)
    }
    const chatHistory = filteredHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }))

    return await window.electronAPI.geminiChat({
      apiKey: GEMINI_API_KEY,
      model: apiModelName,
      systemPrompt: WRITING_ASSISTANT_SYSTEM_PROMPT,
      history: chatHistory,
      message
    })
  } catch (error) {
    console.error('Gemini API错误:', error)
    if (error.message && error.message.includes('404')) {
      throw new Error(`Gemini模型不可用。请检查API密钥和模型名称（当前: ${apiModelName}）。错误: ${error.message}`)
    }
    throw new Error(`Gemini API调用失败: ${error.message}`)
  }
}

/**
 * 发送消息到 Claude（带 interactive-writing-assistant 系统提示）
 * @param {string} message - 用户消息（含上下文）
 * @param {string} model - Claude 模型 ID
 * @param {Array} history - 历史消息记录
 */
async function sendToClaude(message, model, history) {
  try {
    // 构建对话历史（过滤掉 system 消息和初始 assistant 欢迎语）
    const filteredHistory = history.filter(msg => msg.role !== 'system')
    const startIndex = filteredHistory.length > 0 && filteredHistory[0].role === 'assistant' ? 1 : 0
    const claudeMessages = filteredHistory.slice(startIndex).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }))
    claudeMessages.push({ role: 'user', content: message })

    // 通过 IPC 在主进程调用，避免浏览器 CORS 限制
    return await window.electronAPI.claudeChat({
      apiKey: ANTHROPIC_API_KEY,
      model,
      messages: claudeMessages,
      systemPrompt: WRITING_ASSISTANT_SYSTEM_PROMPT
    })
  } catch (error) {
    console.error('Claude API错误:', error)
    throw new Error(`Claude API调用失败: ${error.message}`)
  }
}
