import React, { useState } from 'react'
import {
  generatePKCE, buildAuthUrl, exchangeToken,
  getNotebooks, getSections, getPages, getPageContent, htmlToText
} from '../services/oneNoteService'
import { uploadKBFile } from '../services/storageService'

const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID

export default function OneNoteImport({ kbId, folderId, onClose, onImported }) {
  const [step, setStep] = useState('idle') // idle | auth | browse | importing
  const [token, setToken] = useState(null)
  const [notebooks, setNotebooks] = useState([])
  const [sections, setSections] = useState({})   // notebookId -> []
  const [pages, setPages] = useState({})          // sectionId -> []
  const [selected, setSelected] = useState({})    // pageId -> { title, sectionId }
  const [expandedNB, setExpandedNB] = useState({})
  const [expandedSec, setExpandedSec] = useState({})
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  async function handleConnect() {
    if (!CLIENT_ID) {
      setError('未配置 VITE_MS_CLIENT_ID，请在 .env.local 中添加')
      return
    }
    setError('')
    setStep('auth')
    try {
      const { codeVerifier, codeChallenge } = await generatePKCE()
      const authUrl = buildAuthUrl(CLIENT_ID, codeChallenge)
      const code = await window.electronAPI.startOAuth(authUrl)
      const tokenData = await exchangeToken(CLIENT_ID, code, codeVerifier)
      setToken(tokenData.access_token)
      const nbs = await getNotebooks(tokenData.access_token)
      setNotebooks(nbs)
      setStep('browse')
    } catch (e) {
      setError(e.message)
      setStep('idle')
    }
  }

  async function handleExpandNotebook(nb) {
    setExpandedNB(prev => ({ ...prev, [nb.id]: !prev[nb.id] }))
    if (!sections[nb.id]) {
      try {
        const secs = await getSections(token, nb.id)
        setSections(prev => ({ ...prev, [nb.id]: secs }))
      } catch (e) {
        setError(e.message)
      }
    }
  }

  async function handleExpandSection(sec) {
    setExpandedSec(prev => ({ ...prev, [sec.id]: !prev[sec.id] }))
    if (!pages[sec.id]) {
      try {
        const pgs = await getPages(token, sec.id)
        setPages(prev => ({ ...prev, [sec.id]: pgs }))
      } catch (e) {
        setError(e.message)
      }
    }
  }

  async function toggleSelectSection(e, sec) {
    e.stopPropagation()
    // 确保页面已加载
    let pgs = pages[sec.id]
    if (!pgs) {
      try {
        pgs = await getPages(token, sec.id)
        setPages(prev => ({ ...prev, [sec.id]: pgs }))
        setExpandedSec(prev => ({ ...prev, [sec.id]: true }))
      } catch (err) {
        setError(err.message)
        return
      }
    }
    // 判断是否全部已选
    const allSelected = pgs.every(p => selected[p.id])
    setSelected(prev => {
      const next = { ...prev }
      if (allSelected) {
        pgs.forEach(p => delete next[p.id])
      } else {
        pgs.forEach(p => { next[p.id] = { title: p.title, id: p.id } })
      }
      return next
    })
  }

  function togglePage(page) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[page.id]) delete next[page.id]
      else next[page.id] = { title: page.title, id: page.id }
      return next
    })
  }

  async function handleImport() {
    const pageList = Object.values(selected)
    if (pageList.length === 0) return
    setStep('importing')
    setError('')
    let done = 0
    for (const page of pageList) {
      try {
        setProgress(`正在导入 ${page.title}（${done + 1}/${pageList.length}）`)
        const html = await getPageContent(token, page.id)
        const text = htmlToText(html)
        // 构造 File 对象复用 uploadKBFile
        const blob = new Blob([text], { type: 'text/plain' })
        const file = new File([blob], `${page.title}.txt`, { type: 'text/plain' })
        await uploadKBFile(kbId, folderId ?? null, file)
        done++
      } catch (e) {
        setError(`导入"${page.title}"失败: ${e.message}`)
      }
    }
    setProgress(`已导入 ${done} 个页面`)
    onImported?.()
    setTimeout(onClose, 1500)
  }

  return (
    <div className="onenote-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="onenote-modal">
        <div className="onenote-modal-header">
          <h3>从 OneNote 导入</h3>
          <button className="onenote-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="onenote-error">{error}</div>}

        {step === 'idle' && (
          <div className="onenote-idle">
            <p>连接你的 Microsoft 账号，选择要导入的 OneNote 页面。</p>
            <button className="onenote-btn-primary" onClick={handleConnect}>
              连接 OneNote
            </button>
          </div>
        )}

        {step === 'auth' && (
          <div className="onenote-loading">
            <div className="spinner" />
            <p>正在打开 Microsoft 登录窗口...</p>
          </div>
        )}

        {step === 'browse' && (
          <>
            <div className="onenote-tree">
              {notebooks.length === 0 && <p className="onenote-empty">未找到笔记本</p>}
              {notebooks.map(nb => (
                <div key={nb.id} className="onenote-nb">
                  <div className="onenote-nb-title" onClick={() => handleExpandNotebook(nb)}>
                    {expandedNB[nb.id] ? '▾' : '▸'} 📓 {nb.displayName}
                  </div>
                  {expandedNB[nb.id] && (sections[nb.id] || []).map(sec => (
                    <div key={sec.id} className="onenote-sec">
                      <div className="onenote-sec-title" onClick={() => handleExpandSection(sec)}>
                        <span>{expandedSec[sec.id] ? '▾' : '▸'} 📑 {sec.displayName}</span>
                        <button
                          className="onenote-select-all-btn"
                          onClick={e => toggleSelectSection(e, sec)}
                          title="全选/取消全选该分区所有页面"
                        >
                          {pages[sec.id] && pages[sec.id].every(p => selected[p.id]) ? '取消全选' : '全选'}
                        </button>
                      </div>
                      {expandedSec[sec.id] && (pages[sec.id] || []).map(page => (
                        <label key={page.id} className="onenote-page">
                          <input
                            type="checkbox"
                            checked={!!selected[page.id]}
                            onChange={() => togglePage(page)}
                          />
                          📄 {page.title}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="onenote-footer">
              <span>{Object.keys(selected).length} 个页面已选</span>
              <button
                className="onenote-btn-primary"
                disabled={Object.keys(selected).length === 0}
                onClick={handleImport}
              >
                导入选中页面
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="onenote-loading">
            <div className="spinner" />
            <p>{progress}</p>
          </div>
        )}
      </div>
    </div>
  )
}
