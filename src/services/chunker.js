const TARGET_SIZE = 400   // 目标 chunk 大小（字符）
const MIN_SIZE = 200
const MAX_SIZE = 600
const OVERLAP = 50

export function chunkMarkdown(text, fileName) {
  const sections = splitByHeadings(text)
  const chunks = []
  for (const section of sections) {
    if (section.content.length <= MAX_SIZE) {
      chunks.push({ text: section.content, heading: section.heading, fileName })
    } else {
      const sub = splitBySize(section.content, TARGET_SIZE, OVERLAP)
      sub.forEach(t => chunks.push({ text: t, heading: section.heading, fileName }))
    }
  }
  return chunks
}

export function chunkPlainText(text, fileName) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())
  const chunks = []
  let buffer = ''

  for (const para of paragraphs) {
    if (buffer.length + para.length > MAX_SIZE && buffer.length >= MIN_SIZE) {
      chunks.push({ text: buffer.trim(), heading: null, fileName })
      const overlapText = buffer.slice(-OVERLAP)
      buffer = overlapText + para
    } else {
      buffer += (buffer ? '\n\n' : '') + para
    }
  }
  if (buffer.trim()) {
    chunks.push({ text: buffer.trim(), heading: null, fileName })
  }
  return chunks
}

export function chunkDocument(text, fileName) {
  const ext = fileName.toLowerCase()
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) {
    return chunkMarkdown(text, fileName)
  }
  return chunkPlainText(text, fileName)
}

function splitByHeadings(text) {
  const lines = text.split('\n')
  const sections = []
  let current = { heading: null, content: '' }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      if (current.content.trim()) sections.push(current)
      current = { heading: headingMatch[2].trim(), content: line + '\n' }
    } else {
      current.content += line + '\n'
    }
  }
  if (current.content.trim()) sections.push(current)
  return sections
}

function splitBySize(text, targetSize, overlap) {
  const result = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + targetSize + 100, text.length)
    if (end < text.length) {
      const slice = text.slice(start, end)
      const breakPoint = Math.max(
        slice.lastIndexOf('。'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？')
      )
      if (breakPoint > targetSize * 0.5) {
        end = start + breakPoint + 1
      }
    }
    result.push(text.slice(start, end))
    const nextStart = end - overlap
    start = nextStart > start ? nextStart : end
  }
  return result
}
