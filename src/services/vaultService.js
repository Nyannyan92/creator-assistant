import { chunkDocument } from './chunker'
import { embedTexts, cacheVectors, removeCachedVectors } from './embeddingService'
import { saveChunks, deleteChunksByFile, saveWikiLinks, deleteVaultMeta } from './storageService'

const VAULT_KB_PREFIX = 'vault:'

export function vaultKbId(vaultId) {
  return `${VAULT_KB_PREFIX}${vaultId}`
}

export function vaultFileId(vaultId, relativePath) {
  return `${vaultId}:${relativePath}`
}

export async function indexVaultFile(vaultId, file) {
  const content = await window.electronAPI.vaultReadFile(file.path)
  const parsed = await window.electronAPI.vaultParseFile(file.path)

  const fileId = vaultFileId(vaultId, file.relativePath)
  const kbId = vaultKbId(vaultId)

  await deleteChunksByFile(fileId)

  const chunks = chunkDocument(parsed.body, file.name)
  if (chunks.length > 0) {
    const texts = chunks.map(c => c.text)
    const vectors = await embedTexts(texts)
    await saveChunks(fileId, kbId, chunks, vectors)
    cacheVectors(fileId, chunks, vectors)
  }

  if (parsed.links.length > 0) {
    await saveWikiLinks(vaultId, file.relativePath, parsed.links)
  }

  return { chunksCount: chunks.length, linksCount: parsed.links.length }
}

export async function removeVaultFile(vaultId, relativePath) {
  const fileId = vaultFileId(vaultId, relativePath)
  await deleteChunksByFile(fileId)
  removeCachedVectors(fileId)
}

export async function syncVault(vaultId, vaultPath, onProgress) {
  const files = await window.electronAPI.vaultScan(vaultPath)
  let indexed = 0
  for (const file of files) {
    try {
      await indexVaultFile(vaultId, file)
      indexed++
      onProgress?.({ indexed, total: files.length, current: file.name })
    } catch (e) {
      console.warn(`Vault 索引失败: ${file.relativePath}`, e)
    }
  }
  return { total: files.length, indexed }
}
