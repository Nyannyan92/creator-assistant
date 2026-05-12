import React from 'react'
import MainLayout from './components/MainLayout'
import './styles/App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-mark" aria-hidden>✦</span>
          <div className="app-header-text">
            <h1>创作者 AI 助手</h1>
            <p>知识库 × 文风学习，和你一起把想法落成文字</p>
          </div>
        </div>
      </header>
      <main className="app-main">
        <MainLayout />
      </main>
    </div>
  )
}

export default App
