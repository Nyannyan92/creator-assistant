import { chunkDocument } from './chunker'
import { embedTexts, cacheVectors } from './embeddingService'
import { saveChunks, getChunksByKb } from './storageService'

const loadedKbs = new Set()

export async function indexFile(fileId, kbId, fileName, textContent) {
  const chunks = chunkDocument(textContent, fileName)
  if (chunks.length === 0) return

  const texts = chunks.map(c => c.text)
  const vectors = await embedTexts(texts)

  await saveChunks(fileId, kbId, chunks, vectors)
  cacheVectors(fileId, chunks, vectors)
  loadedKbs.add(kbId)

  return { chunksCount: chunks.length }
}

export async function loadKbVectorsToCache(kbId) {
  if (loadedKbs.has(kbId)) return 0

  const { cacheVectors: cache } = await import('./embeddingService')
  const records = await getChunksByKb(kbId)

  const byFile = new Map()
  for (const r of records) {
    if (!byFile.has(r.fileId)) byFile.set(r.fileId, { chunks: [], vectors: [] })
    const entry = byFile.get(r.fileId)
    entry.chunks.push({ text: r.text, heading: r.heading, fileName: r.fileName })
    entry.vectors.push(r.vector)
  }

  for (const [fileId, entry] of byFile) {
    cache(fileId, entry.chunks, entry.vectors)
  }

  loadedKbs.add(kbId)
  return records.length
}
