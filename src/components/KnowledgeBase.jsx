import React, { useState } from 'react'
import KBSidebar from './KBSidebar'
import KBFileList from './KBFileList'
import '../styles/KnowledgeBase.css'

const KnowledgeBase = ({ onScopeChange }) => {
  const [selectedKbId, setSelectedKbId] = useState(null)
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [kbName, setKbName] = useState('')
  const [folderName, setFolderName] = useState('')

  function handleSelect(kbId, folderId) {
    setSelectedKbId(kbId)
    setSelectedFolderId(folderId)
  }

  function handleScopeChange(scope) {
    if (scope.type === 'kb') {
      setKbName(scope.label)
      setFolderName('')
    } else if (scope.type === 'folder') {
      const parts = scope.label.split(' / ')
      setKbName(parts[0] || '')
      setFolderName(parts[1] || '')
    } else {
      setKbName('')
      setFolderName('')
    }
    onScopeChange(scope)
  }

  return (
    <div className="kb-container">
      <KBSidebar
        selectedKbId={selectedKbId}
        selectedFolderId={selectedFolderId}
        onSelect={handleSelect}
        onScopeChange={handleScopeChange}
      />

      {selectedKbId != null ? (
        <KBFileList
          kbId={selectedKbId}
          folderId={selectedFolderId}
          kbName={kbName}
          folderName={folderName}
        />
      ) : (
        <div className="kb-main">
          <div className="kb-empty-hint">
            <span>🧠</span>
            <span>从左侧选择或创建知识库</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default KnowledgeBase
