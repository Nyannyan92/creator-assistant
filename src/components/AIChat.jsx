import React, { useState, useRef, useEffect } from 'react'
import { sendMessage } from '../services/aiService'
import { getKnowledgeBases } from '../services/storageService'
import '../styles/AIChat.css'

const AIChat = ({ kbScope, onKbScopeChange }) => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好！我是你的AI创作助手。我可以帮助你创作文章，请告诉我你的创作需求。',
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash')
  const [copiedIndex, setCopiedIndex] = useState(null) // 记录已复制的消息索引
  const [kbList, setKbList] = useState([])
  const messagesEndRef = useRef(null)

  useEffect(() => {
    getKnowledgeBases().then(setKbList).catch(() => {})
  }, [])

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await sendMessage(input.trim(), selectedModel, messages, kbScope)
      const assistantMessage = {
        role: 'assistant',
        content: response,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('发送消息失败:', error)
      const errorMessage = {
        role: 'assistant',
        content: `抱歉，发生了错误：${error.message}`,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 复制消息内容到剪贴板
  const handleCopy = async (content, index) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(index)
      // 2秒后清除复制状态
      setTimeout(() => {
        setCopiedIndex(null)
      }, 2000)
    } catch (error) {
      console.error('复制失败:', error)
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea')
      textArea.value = content
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopiedIndex(index)
        setTimeout(() => {
          setCopiedIndex(null)
        }, 2000)
      } catch (err) {
        alert('复制失败，请手动选择文本复制')
      }
      document.body.removeChild(textArea)
    }
  }

  return (
    <div className="ai-chat-container">
      <div className="chat-header">
        <div className="chat-header-controls">
          <div className="model-selector">
            <label htmlFor="creator-model-select">模型</label>
            <select
              id="creator-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading}
            >
              <option value="gemini-3-flash">Gemini 3 Flash</option>
              <option value="gemini-3-pro">Gemini 3 Pro</option>
            </select>
          </div>
          <div className="kb-scope-selector">
            <label htmlFor="creator-kb-select">知识库</label>
            <select
              id="creator-kb-select"
              value={kbScope?.type === 'kb' ? `kb-${kbScope.kbId}` : ''}
              onChange={e => {
                const val = e.target.value
                if (!val) {
                  onKbScopeChange({ type: 'none', kbId: null, folderId: null, label: '' })
                } else {
                  const kb = kbList.find(k => `kb-${k.id}` === val)
                  if (kb) onKbScopeChange({ type: 'kb', kbId: kb.id, folderId: null, label: kb.name })
                }
              }}
              disabled={isLoading}
            >
              <option value="">不引用</option>
              {kbList.map(kb => (
                <option key={kb.id} value={`kb-${kb.id}`}>{kb.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="messages-container">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
          >
            <div className="message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-header">
                <div className="message-text">{message.content}</div>
                {message.role === 'assistant' && (
                  <button
                    className={`copy-button ${copiedIndex === index ? 'copied' : ''}`}
                    onClick={() => handleCopy(message.content, index)}
                    title={copiedIndex === index ? '已复制' : '复制'}
                  >
                    {copiedIndex === index ? '✓ 已复制' : '📋 复制'}
                  </button>
                )}
              </div>
              <div className="message-time">
                {message.timestamp.toLocaleTimeString('zh-CN', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant-message">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="输入你的创作需求...（Shift+Enter换行，Enter发送）"
          disabled={isLoading}
          rows={3}
          className="message-input"
        />
        <button 
          onClick={handleSend} 
          disabled={!input.trim() || isLoading}
          className="send-button"
        >
          {isLoading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  )
}

export default AIChat
