const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startOAuth: (authUrl) => ipcRenderer.invoke('oauth:start', authUrl),
  claudeChat: (params) => ipcRenderer.invoke('claude:chat', params),
  geminiChat: (params) => ipcRenderer.invoke('gemini:chat', params),
  geminiEmbed: (params) => ipcRenderer.invoke('gemini:embed', params),
  geminiRerank: (params) => ipcRenderer.invoke('gemini:rerank', params),
  vaultPick: () => ipcRenderer.invoke('vault:pick'),
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultRemove: (vaultId) => ipcRenderer.invoke('vault:remove', vaultId),
  vaultScan: (vaultPath) => ipcRenderer.invoke('vault:scan', vaultPath),
  vaultReadFile: (filePath) => ipcRenderer.invoke('vault:readFile', filePath),
  vaultParseFile: (filePath) => ipcRenderer.invoke('vault:parseFile', filePath),
  vaultWatch: (vaultId, vaultPath) => ipcRenderer.invoke('vault:watch', vaultId, vaultPath),
  vaultUnwatch: (vaultId) => ipcRenderer.invoke('vault:unwatch', vaultId),
  onVaultFileChanged: (callback) => {
    ipcRenderer.on('vault:fileChanged', (event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('vault:fileChanged')
  },
})
