import React, { useState, useEffect, useRef } from 'react'
import {
  getKnowledgeBases, createKnowledgeBase, updateKnowledgeBase, deleteKnowledgeBase,
  getFolders, createFolder, updateFolder, deleteFolder,
  deleteVaultMeta
} from '../services/storageService'
import { syncVault, vaultKbId } from '../services/vaultService'

const KBSidebar = ({ selectedKbId, selectedFolderId, onSelect, onScopeChange }) => {
  const [kbs, setKbs] = useState([])
  const [folders, setFolders] = useState({}) // { kbId: [folder, ...] }
  const [expandedKb, setExpandedKb] = useState(null)
  const [editingKb, setEditingKb] = useState(null)   // { id, name }
  const [editingFolder, setEditingFolder] = useState(null) // { id, name }
  const [newKbName, setNewKbName] = useState('')
  const [newFolderKbId, setNewFolderKbId] = useState(null)
  const [newFolderName, setNewFolderName] = useState('')
  const inputRef = useRef(null)

  const [vaults, setVaults] = useState([])
  const [syncingVault, setSyncingVault] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)

  useEffect(() => {
    loadKBs()
    loadVaults()
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onVaultFileChanged) return
    const cleanup = window.electronAPI.onVaultFileChanged(async (event) => {
      try {
        const { indexVaultFile, removeVaultFile } = await import('../services/vaultService')
        if (event.type === 'unlink') {
          await removeVaultFile(event.vaultId, event.file.relativePath)
        } else {
          await indexVaultFile(event.vaultId, event.file)
        }
      } catch (e) {
        console.warn('Vault 文件变动处理失败:', e)
      }
    })
    return () => cleanup?.()
  }, [])

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [editingKb, editingFolder, newKbName !== undefined && newFolderKbId])

  async function loadKBs() {
    const list = await getKnowledgeBases()
    setKbs(list)
  }

  async function loadFolders(kbId) {
    const list = await getFolders(kbId)
    setFolders(prev => ({ ...prev, [kbId]: list }))
  }

  async function loadVaults() {
    if (!window.electronAPI?.vaultList) return
    const list = await window.electronAPI.vaultList()
    setVaults(list)
    for (const vault of list) {
      await window.electronAPI.vaultWatch(vault.id, vault.path)
    }
  }

  async function handleLinkVault() {
    if (!window.electronAPI?.vaultPick) return
    const vault = await window.electronAPI.vaultPick()
    if (!vault) return
    setVaults(prev => [...prev, vault])
    setSyncingVault(vault.id)
    setSyncProgress(null)
    try {
      await syncVault(vault.id, vault.path, (p) => {
        setSyncProgress(p)
      })
    } finally {
      setSyncingVault(null)
      setSyncProgress(null)
    }
    await window.electronAPI.vaultWatch(vault.id, vault.path)
  }

  async function handleUnlinkVault(e, vault) {
    e.stopPropagation()
    if (!confirm(`确认取消链接 "${vault.name}"？（不会删除原始文件）`)) return
    await window.electronAPI.vaultRemove(vault.id)
    await window.electronAPI.vaultUnwatch(vault.id)
    await deleteVaultMeta(vault.id)
    setVaults(prev => prev.filter(v => v.id !== vault.id))
    const kbId = vaultKbId(vault.id)
    if (selectedKbId === kbId) {
      onSelect(null, null)
      onScopeChange({ type: 'none', kbId: null, folderId: null, label: '' })
    }
  }

  function handleVaultClick(vault) {
    const kbId = vaultKbId(vault.id)
    onSelect(kbId, null)
    onScopeChange({ type: 'vault', kbId, folderId: null, label: `Obsidian: ${vault.name}` })
  }

  function handleKbClick(kb) {
    const isExpanding = expandedKb !== kb.id
    setExpandedKb(isExpanding ? kb.id : null)
    if (isExpanding) {
      loadFolders(kb.id)
      onSelect(kb.id, null)
      onScopeChange({ type: 'kb', kbId: kb.id, folderId: null, label: kb.name })
    } else {
      onSelect(null, null)
      onScopeChange({ type: 'none', kbId: null, folderId: null, label: '' })
    }
  }

  function handleFolderClick(e, kb, folder) {
    e.stopPropagation()
    onSelect(kb.id, folder.id)
    onScopeChange({ type: 'folder', kbId: kb.id, folderId: folder.id, label: `${kb.name} / ${folder.name}` })
  }

  // 新建知识库
  async function handleAddKB() {
    setNewKbName('新知识库')
    setEditingKb({ id: null, name: '新知识库' })
  }

  async function commitNewKB(name) {
    if (!name.trim()) { setEditingKb(null); return }
    const kb = await createKnowledgeBase(name.trim())
    await loadKBs()
    setEditingKb(null)
    setExpandedKb(kb.id)
    loadFolders(kb.id)
    onSelect(kb.id, null)
    onScopeChange({ type: 'kb', kbId: kb.id, folderId: null, label: kb.name })
  }

  // 重命名知识库
  async function commitRenameKB(kbId, name) {
    if (!name.trim()) { setEditingKb(null); return }
    await updateKnowledgeBase(kbId, name.trim())
    await loadKBs()
    setEditingKb(null)
  }

  // 删除知识库
  async function handleDeleteKB(e, kbId) {
    e.stopPropagation()
    if (!confirm('确认删除该知识库及其所有内容？')) return
    await deleteKnowledgeBase(kbId)
    await loadKBs()
    if (selectedKbId === kbId) {
      onSelect(null, null)
      onScopeChange({ type: 'none', kbId: null, folderId: null, label: '' })
    }
    if (expandedKb === kbId) setExpandedKb(null)
  }

  // 新建文件夹
  async function handleAddFolder(e, kbId) {
    e.stopPropagation()
    setNewFolderKbId(kbId)
    setNewFolderName('新文件夹')
  }

  async function commitNewFolder(kbId, name) {
    if (!name.trim()) { setNewFolderKbId(null); return }
    await createFolder(kbId, name.trim())
    await loadFolders(kbId)
    setNewFolderKbId(null)
  }

  // 重命名文件夹
  async function commitRenameFolder(folderId, kbId, name) {
    if (!name.trim()) { setEditingFolder(null); return }
    await updateFolder(folderId, name.trim())
    await loadFolders(kbId)
    setEditingFolder(null)
  }

  // 删除文件夹
  async function handleDeleteFolder(e, folder, kbId) {
    e.stopPropagation()
    if (!confirm('确认删除该文件夹及其所有文件？')) return
    await deleteFolder(folder.id)
    await loadFolders(kbId)
    if (selectedFolderId === folder.id) {
      onSelect(kbId, null)
      const kb = kbs.find(k => k.id === kbId)
      onScopeChange({ type: 'kb', kbId, folderId: null, label: kb?.name || '' })
    }
  }

  return (
    <div className="kb-sidebar">
      <div className="kb-sidebar-header">
        <h3>🧠 知识库</h3>
        <button className="kb-add-btn" onClick={handleAddKB}>+ 新建知识库</button>
      </div>

      <div className="kb-list">
        {/* 新建知识库内联输入 */}
        {editingKb && editingKb.id === null && (
          <div className="kb-item">
            <div className="kb-item-header">
              <span className="kb-item-icon">📚</span>
              <input
                ref={inputRef}
                className="kb-inline-input"
                value={editingKb.name}
                onChange={e => setEditingKb({ ...editingKb, name: e.target.value })}
                onBlur={() => commitNewKB(editingKb.name)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitNewKB(editingKb.name)
                  if (e.key === 'Escape') setEditingKb(null)
                }}
              />
            </div>
          </div>
        )}

        {kbs.map(kb => (
          <div key={kb.id} className="kb-item">
            <div
              className={`kb-item-header ${selectedKbId === kb.id ? 'active' : ''}`}
              onClick={() => handleKbClick(kb)}
            >
              <span className="kb-item-icon">{expandedKb === kb.id ? '📖' : '📚'}</span>
              {editingKb && editingKb.id === kb.id ? (
                <input
                  ref={inputRef}
                  className="kb-inline-input"
                  value={editingKb.name}
                  onChange={e => setEditingKb({ ...editingKb, name: e.target.value })}
                  onBlur={() => commitRenameKB(kb.id, editingKb.name)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRenameKB(kb.id, editingKb.name)
                    if (e.key === 'Escape') setEditingKb(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="kb-item-name">{kb.name}</span>
              )}
              <div className="kb-item-actions">
                <button className="kb-icon-btn" title="重命名"
                  onClick={e => { e.stopPropagation(); setEditingKb({ id: kb.id, name: kb.name }) }}>✏️</button>
                <button className="kb-icon-btn" title="删除"
                  onClick={e => handleDeleteKB(e, kb.id)}>🗑️</button>
              </div>
            </div>

            {expandedKb === kb.id && (
              <div className="kb-folder-list">
                {(folders[kb.id] || []).map(folder => (
                  <div
                    key={folder.id}
                    className={`kb-folder-item ${selectedFolderId === folder.id ? 'active' : ''}`}
                    onClick={e => handleFolderClick(e, kb, folder)}
                  >
                    <span>📁</span>
                    {editingFolder && editingFolder.id === folder.id ? (
                      <input
                        ref={inputRef}
                        className="kb-inline-input"
                        value={editingFolder.name}
                        onChange={e => setEditingFolder({ ...editingFolder, name: e.target.value })}
                        onBlur={() => commitRenameFolder(folder.id, kb.id, editingFolder.name)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRenameFolder(folder.id, kb.id, editingFolder.name)
                          if (e.key === 'Escape') setEditingFolder(null)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.name}
                      </span>
                    )}
                    <div className="kb-folder-actions">
                      <button className="kb-icon-btn" title="重命名"
                        onClick={e => { e.stopPropagation(); setEditingFolder({ id: folder.id, name: folder.name }) }}>✏️</button>
                      <button className="kb-icon-btn" title="删除"
                        onClick={e => handleDeleteFolder(e, folder, kb.id)}>🗑️</button>
                    </div>
                  </div>
                ))}

                {/* 新建文件夹内联输入 */}
                {newFolderKbId === kb.id ? (
                  <div className="kb-folder-item">
                    <span>📁</span>
                    <input
                      ref={inputRef}
                      className="kb-inline-input"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onBlur={() => commitNewFolder(kb.id, newFolderName)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitNewFolder(kb.id, newFolderName)
                        if (e.key === 'Escape') setNewFolderKbId(null)
                      }}
                    />
                  </div>
                ) : (
                  <button className="kb-add-folder-btn" onClick={e => handleAddFolder(e, kb.id)}>
                    + 新建文件夹
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {kbs.length === 0 && !editingKb && (
          <div style={{ padding: '1rem', color: '#bbb', fontSize: '0.85rem', textAlign: 'center' }}>
            点击上方按钮创建知识库
          </div>
        )}
      </div>

      <div className="kb-sidebar-header" style={{ marginTop: '1rem' }}>
        <h3>📂 Obsidian 仓库</h3>
        <button className="kb-add-btn" onClick={handleLinkVault}>+ 链接仓库</button>
      </div>

      <div className="kb-list">
        {vaults.map(vault => (
          <div key={vault.id} className="kb-item">
            <div
              className={`kb-item-header ${selectedKbId === vaultKbId(vault.id) ? 'active' : ''}`}
              onClick={() => handleVaultClick(vault)}
            >
              <span className="kb-item-icon">📂</span>
              <span className="kb-item-name">{vault.name}</span>
              {syncingVault === vault.id && (
                <span className="indexing-badge">
                  {syncProgress ? `${syncProgress.indexed}/${syncProgress.total}` : '同步中...'}
                </span>
              )}
              <div className="kb-item-actions">
                <button className="kb-icon-btn" title="取消链接"
                  onClick={e => handleUnlinkVault(e, vault)}>🔗</button>
              </div>
            </div>
          </div>
        ))}

        {vaults.length === 0 && (
          <div style={{ padding: '0.75rem 1rem', color: '#bbb', fontSize: '0.85rem', textAlign: 'center' }}>
            链接本地 Obsidian Vault 目录
          </div>
        )}
      </div>
    </div>
  )
}

export default KBSidebar
