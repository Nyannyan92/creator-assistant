// Embedding 服务 - 向量嵌入与相似度搜索

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const BATCH_SIZE = 20

// 内存向量缓存：fileId → { chunks: [...], vectors: Float32Array[] }
const vectorCache = new Map()

export async function embedTexts(texts) {
  if (!GEMINI_API_KEY) throw new Error('请设置 Gemini API 密钥')
  let results = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const vectors = await window.electronAPI.geminiEmbed({
      apiKey: GEMINI_API_KEY,
      texts: batch
    })
    results = results.concat(vectors)
  }
  return results
}

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function searchSimilar(queryVector, topK = 6) {
  const results = []
  for (const [fileId, entry] of vectorCache) {
    for (let i = 0; i < entry.vectors.length; i++) {
      const score = cosineSimilarity(queryVector, entry.vectors[i])
      results.push({ ...entry.chunks[i], fileId, score })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

export async function rerankChunks(query, chunks, topN = 3) {
  if (!GEMINI_API_KEY) return chunks.slice(0, topN)
  try {
    const candidates = chunks.map(c => c.text)
    const scores = await window.electronAPI.geminiRerank({
      apiKey: GEMINI_API_KEY,
      query,
      candidates
    })
    const scored = chunks.map((chunk, i) => {
      const found = scores.find(s => s.index === i)
      return { ...chunk, rerankScore: found ? found.score : 0 }
    })
    scored.sort((a, b) => b.rerankScore - a.rerankScore)
    return scored.slice(0, topN)
  } catch (e) {
    console.warn('Re-rank 失败，回退到向量排序:', e)
    return chunks.slice(0, topN)
  }
}

export function cacheVectors(fileId, chunks, vectors) {
  vectorCache.set(fileId, { chunks, vectors })
}

export function removeCachedVectors(fileId) {
  vectorCache.delete(fileId)
}

export function clearVectorCache() {
  vectorCache.clear()
}

export function getVectorCache() {
  return vectorCache
}
