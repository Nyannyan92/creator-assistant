import React, { useEffect } from 'react'

export default function FilePreviewModal({ file, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const content = file.textContent || file.content || ''
  const hasText = typeof content === 'string' && !content.startsWith('data:')

  return (
    <div className="fp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fp-modal">
        <div className="fp-header">
          <span className="fp-title" title={file.name}>{file.title || file.name}</span>
          <button className="fp-close" onClick={onClose}>✕</button>
        </div>
        <div className="fp-body">
          {hasText ? (
            <pre className="fp-content">{content}</pre>
          ) : (
            <div className="fp-no-preview">该文件类型暂不支持预览</div>
          )}
        </div>
      </div>
    </div>
  )
}
