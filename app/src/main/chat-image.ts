import type { ChatImage } from '../shared/chat-history-contracts'

const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_ENCODED_IMAGE = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
export const MAX_CHAT_IMAGE_BODY = MAX_ENCODED_IMAGE + 8192

export function decodeChatImage(base64: unknown): ChatImage | null {
  if (typeof base64 !== 'string' || base64.length > MAX_ENCODED_IMAGE) return null
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== base64) return null
  let mimeType: ChatImage['mimeType']
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') mimeType = 'image/png'
  else if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') mimeType = 'image/jpeg'
  else if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) mimeType = 'image/gif'
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp'
  else return null
  return { mimeType, base64 }
}
