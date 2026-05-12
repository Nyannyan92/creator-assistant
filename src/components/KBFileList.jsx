import React, { useState, useEffect, useRef } from 'react'
import { getKBFiles, uploadKBFile, deleteKBFile } from '../services/storageService'
import OneNoteImport from './OneNoteImport'
import FilePreviewModal from './FilePreviewModal'

function fileIcon(name) {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return '📄'
  if (n.endsWith('.md') || n.endsWith('.markdown')) return '📝'
  if (n.endsWith('.html') || n.endsWith('.htm')) return '🌐'
  return '📃'
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const KBFileList = ({ kbId, folderId, kbName, folderName }) => {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [showOneNote, setShowOneNote] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [indexingFiles, setIndexingFiles] = useState(new Set())
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (kbId != null) loadFiles()
  }, [kbId, folderId])

  async function loadFiles() {
    const list = await getKBFiles(kbId, folderId ?? null)
    setFiles(list)
  }

  async function handleFiles(fileList) {
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const saved = await uploadKBFile(kbId, folderId ?? null, file)
        setIndexingFiles(prev => new Set([...prev, saved.id]))
        setTimeout(() => {
          setIndexingFiles(prev => {
            const next = new Set(prev)
            next.delete(saved.id)
            return next
          })
        }, 5000)
      }
      await loadFiles()
    } catch (err) {
      alert(`上传失败：${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  async function handleDelete(fileId) {
    if (!confirm('确认删除该文件？')) return
    await deleteKBFile(fileId)
    await loadFiles()
  }

  const title = folderName ? `${kbName} / ${folderName}` : kbName

  return (
    <>
    <div className="kb-main">
      <div className="kb-main-header">
        <h2>{title}</h2>
      </div>

      {/* 上传区域 */}
      <div
        className={`kb-upload-area ${dragActive ? 'drag-active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <p>📂 点击或拖拽文件到此处上传</p>
        <p className="kb-upload-hint">支持 PDF、TXT、MD、HTML 格式，最大 50MB</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.html,.htm"
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      <div className="kb-import-actions">
        <button className="kb-onenote-btn" onClick={e => { e.stopPropagation(); setShowOneNote(true) }}>
          🔗 从 OneNote 导入
        </button>
      </div>

      {showOneNote && (
        <OneNoteImport
          kbId={kbId}
          folderId={folderId}
          onClose={() => setShowOneNote(false)}
          onImported={() => loadFiles()}
        />
      )}

      {uploading && (
        <div className="kb-uploading">
          <div className="spinner" />
          正在上传并解析文件...
        </div>
      )}

      <div className="kb-files-section">
        {files.length === 0 ? (
          <div className="kb-no-files">暂无文件，上传后即可在 AI 对话中引用</div>
        ) : (
          <>
            <h4>{files.length} 个文件</h4>
            <div className="kb-files-grid">
              {files.map(file => (
                <div key={file.id} className="kb-file-card" onClick={() => setPreviewFile(file)} style={{ cursor: 'pointer' }}>
                  <span className="kb-file-icon">{fileIcon(file.name)}</span>
                  <div className="kb-file-info">
                    <div className="kb-file-name" title={file.name}>{file.name}</div>
                    <div className="kb-file-meta">
                      {formatSize(file.size)} · {new Date(file.uploadTime).toLocaleDateString('zh-CN')}
                      {indexingFiles.has(file.id) && <span className="indexing-badge">索引中...</span>}
                    </div>
                  </div>
                  <button className="kb-file-delete" onClick={e => { e.stopPropagation(); handleDelete(file.id) }} title="删除">🗑️</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>

    {previewFile && (
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    )}
  </>
  )
}

export default KBFileList
