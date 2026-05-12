import React, { useState } from 'react'
import AIChat from './AIChat'
import StorageSpace from './StorageSpace'
import KnowledgeBase from './KnowledgeBase'
import '../styles/MainLayout.css'

const MainLayout = () => {
  const [activeTab, setActiveTab] = useState('chat')
  const [kbScope, setKbScope] = useState({ type: 'none', kbId: null, folderId: null, label: '' })

  const tabs = [
    { id: 'chat', label: 'AI 对话', icon: '💬' },
    { id: 'articles', label: '文章库', icon: '📚' },
    { id: 'knowledge', label: '知识库', icon: '🧠' }
  ]

  return (
    <div className="main-layout">
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-brand">
          <span className="sidebar-mark" aria-hidden>◇</span>
          <div>
            <h2 className="sidebar-title">工作台</h2>
            <p className="sidebar-tagline">本地数据 · Gemini / Claude</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon" aria-hidden>{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="main-content">
        {activeTab === 'chat' && <AIChat kbScope={kbScope} onKbScopeChange={setKbScope} />}
        {activeTab === 'articles' && (
          <StorageSpace
            spaceType="articles"
            title="过往文章库"
            description="上传你过往的文章，让 AI 学习并模仿你的行文风格"
            icon="📚"
          />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeBase onScopeChange={setKbScope} />
        )}
      </div>
    </div>
  )
}

export default MainLayout
