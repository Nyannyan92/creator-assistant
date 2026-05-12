import React, { useState, useEffect } from 'react'
import { uploadFile, getFiles, deleteFile, saveTextContent, updateTextContent } from '../services/storageService'
import FilePreviewModal from './FilePreviewModal'
import '../styles/StorageSpace.css'

const StorageSpace = ({ spaceType, title, description, icon }) => {
  const [files, setFiles] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  
  // 在线编辑相关状态（仅素材库使用）
  const [editorTitle, setEditorTitle] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingFileId, setEditingFileId] = useState(null)

  // 加载文件列表
  const loadFiles = async () => {
    try {
      const fileList = await getFiles(spaceType)
      setFiles(fileList)
      
      // 如果是素材库，查找是否有手动编辑的内容
      if (spaceType === 'materials') {
        const manualEditFile = fileList.find(f => f.isManualEdit)
        if (manualEditFile) {
          setEditorTitle(manualEditFile.title || manualEditFile.name || '')
          setEditorContent(manualEditFile.textContent || '')
          setEditingFileId(manualEditFile.id)
          setIsEditing(true)
        } else if (!isEditing) {
          // 如果没有手动编辑的内容，且当前不在编辑状态，清空编辑器
          setEditorTitle('')
          setEditorContent('')
          setEditingFileId(null)
        }
      }
    } catch (error) {
      console.error('加载文件失败:', error)
    }
  }

  useEffect(() => {
    loadFiles()
  }, [spaceType])

  // 处理文件上传
  const handleFileUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return

    setIsUploading(true)
    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        try {
          await uploadFile(spaceType, file)
        } catch (error) {
          // 单个文件失败时显示错误，但继续处理其他文件
          alert(`文件 "${file.name}" 上传失败: ${error.message}`)
        }
      }
      await loadFiles()
    } catch (error) {
      console.error('上传文件失败:', error)
      alert('上传文件失败: ' + error.message)
    } finally {
      setIsUploading(false)
    }
  }

  // 处理文件选择
  const handleFileSelect = (e) => {
    handleFileUpload(Array.from(e.target.files))
    e.target.value = '' // 重置input，允许重复选择同一文件
  }

  // 处理拖拽
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(Array.from(e.dataTransfer.files))
    }
  }

  // 删除文件
  const handleDelete = async (fileId) => {
    if (!confirm('确定要删除这个文件吗？')) return

    try {
      await deleteFile(spaceType, fileId)
      await loadFiles()
    } catch (error) {
      console.error('删除文件失败:', error)
      alert('删除文件失败: ' + error.message)
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  // 格式化日期
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 保存在线编辑的内容（仅素材库）
  const handleSaveEditor = async () => {
    if (!editorTitle.trim()) {
      alert('标题不能为空')
      return
    }
    if (!editorContent.trim()) {
      alert('内容不能为空')
      return
    }

    setIsSaving(true)
    try {
      if (editingFileId) {
        // 更新已存在的内容
        await updateTextContent(spaceType, editingFileId, editorTitle, editorContent)
      } else {
        // 创建新内容
        const result = await saveTextContent(spaceType, editorTitle, editorContent)
        setEditingFileId(result.id)
      }
      await loadFiles()
      
      // 保存成功后清空编辑框
      setEditorTitle('')
      setEditorContent('')
      setEditingFileId(null)
      
      alert('保存成功！')
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败: ' + error.message)
    } finally {
      setIsSaving(false)
    }
  }

  // 开始编辑
  const handleStartEdit = () => {
    setIsEditing(true)
    if (!editorTitle && !editorContent) {
      setEditorTitle('')
      setEditorContent('')
    }
  }

  // 取消编辑
  const handleCancelEdit = () => {
    if (confirm('确定要取消编辑吗？未保存的内容将丢失。')) {
      setIsEditing(false)
      // 恢复之前保存的内容
      const manualEditFile = files.find(f => f.isManualEdit)
      if (manualEditFile) {
        setEditorTitle(manualEditFile.title || manualEditFile.name || '')
        setEditorContent(manualEditFile.textContent || '')
        setEditingFileId(manualEditFile.id)
      } else {
        setEditorTitle('')
        setEditorContent('')
        setEditingFileId(null)
      }
    }
  }

  return (
    <>
    <div className="storage-space">
      <div className="storage-header">
        <div className="storage-title">
          <span className="storage-icon">{icon}</span>
          <h2>{title}</h2>
        </div>
        <p className="storage-description">{description}</p>
      </div>

      <div 
        className={`upload-area ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id={`file-input-${spaceType}`}
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <label htmlFor={`file-input-${spaceType}`} className="upload-label">
          <div className="upload-icon">📄</div>
          <div className="upload-text">
            <p>点击或拖拽文件到此处上传</p>
            <p className="upload-hint">支持文本文件、Markdown、JSON、PDF等格式（最大50MB）</p>
          </div>
        </label>
      </div>

      {isUploading && (
        <div className="uploading-indicator">
          <div className="spinner"></div>
          <span>上传中...</span>
        </div>
      )}

      {/* 在线编辑区域（仅素材库显示） */}
      {spaceType === 'materials' && (
        <div className="editor-section">
          <div className="editor-header">
            <h3>在线编辑素材</h3>
            {!isEditing && (
              <button className="edit-button" onClick={handleStartEdit}>
                ✏️ 开始编辑
              </button>
            )}
          </div>
          
          {isEditing && (
            <div className="editor-container">
              <div className="editor-title-input-wrapper">
                <label className="editor-label">标题</label>
                <input
                  type="text"
                  className="editor-title-input"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  placeholder="输入标题..."
                  maxLength={100}
                />
              </div>
              <div className="editor-content-wrapper">
                <label className="editor-label">内容</label>
                <textarea
                  className="editor-textarea"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  placeholder="在这里输入你的素材信息、笔记、想法等..."
                  rows={15}
                />
              </div>
              <div className="editor-actions">
                <button 
                  className="save-button"
                  onClick={handleSaveEditor}
                  disabled={isSaving || !editorTitle.trim() || !editorContent.trim()}
                >
                  {isSaving ? '保存中...' : '💾 保存'}
                </button>
                <button 
                  className="cancel-button"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="files-list">
        <h3>已上传文件 ({files.length})</h3>
        {files.length === 0 ? (
          <div className="empty-state">
            <p>暂无文件，请上传文件以开始使用</p>
          </div>
        ) : (
          <div className="files-grid">
            {files.map((file) => (
              <div key={file.id} className="file-card" onClick={() => setPreviewFile(file)} style={{ cursor: 'pointer' }}>
                <div className="file-icon">
                  {file.isManualEdit ? '📝' : (file.isText ? '📝' : '📎')}
                </div>
                <div className="file-info">
                  <div className="file-name" title={file.title || file.name}>
                    {file.isManualEdit ? (file.title || file.name) : file.name}
                  </div>
                  <div className="file-meta">
                    {file.isManualEdit && <span className="edit-badge">在线编辑</span>}
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span>{formatDate(file.uploadTime)}</span>
                  </div>
                </div>
                <button
                  className="delete-button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(file.id) }}
                  title="删除文件"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

    {previewFile && (
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    )}
  </>
  )
}

export default StorageSpace
