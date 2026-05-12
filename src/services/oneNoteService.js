// OneNote Graph API 服务
// 使用 OAuth 2.0 Authorization Code + PKCE 流程（无需 client_secret）

const TENANT = 'consumers'
const SCOPE = 'Notes.Read offline_access User.Read'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/**
 * 生成 PKCE code_verifier 和 code_challenge
 */
export async function generatePKCE() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  return { codeVerifier, codeChallenge }
}

/**
 * 构建 Microsoft 授权 URL
 */
export function buildAuthUrl(clientId, codeChallenge) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: 'http://localhost',
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
  })
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params}`
}

/**
 * 用授权码换取 access_token
 */
export async function exchangeToken(clientId, code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'http://localhost',
    code_verifier: codeVerifier,
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error_description || `Token 交换失败: ${res.status}`)
  }
  return res.json()
}

/**
 * 通用分页抓取，自动跟随 @odata.nextLink 直到取完所有数据
 */
async function fetchAllPages(token, url, errorMsg) {
  const results = []
  let nextUrl = url
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`${errorMsg}: ${res.status}`)
    const data = await res.json()
    results.push(...(data.value || []))
    nextUrl = data['@odata.nextLink'] || null
  }
  return results
}

/**
 * 获取笔记本列表
 */
export async function getNotebooks(token) {
  return fetchAllPages(token, `${GRAPH_BASE}/me/onenote/notebooks`, '获取笔记本失败')
}

/**
 * 获取笔记本下的分区列表
 */
export async function getSections(token, notebookId) {
  return fetchAllPages(token, `${GRAPH_BASE}/me/onenote/notebooks/${notebookId}/sections`, '获取分区失败')
}

/**
 * 获取分区下的页面列表
 */
export async function getPages(token, sectionId) {
  return fetchAllPages(token, `${GRAPH_BASE}/me/onenote/sections/${sectionId}/pages`, '获取页面失败')
}

/**
 * 获取页面 HTML 内容
 */
export async function getPageContent(token, pageId) {
  const res = await fetch(`${GRAPH_BASE}/me/onenote/pages/${pageId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`获取页面内容失败: ${res.status}`)
  return res.text()
}

/**
 * HTML 转纯文本（去除 script/style 标签）
 */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style').forEach(el => el.remove())
  return (doc.body?.innerText || doc.body?.textContent || '').trim()
}
