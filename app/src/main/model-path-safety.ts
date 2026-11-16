/**
 * 模型资源路径收口。
 *
 * 词法 normalize + startsWith 挡不住 junction/符号链接；
 * 这里统一用 realpath 校验真实路径仍位于模型根内，并限制可读取的扩展名。
 */
import { realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

export const MODEL_ASSET_EXTENSIONS = new Set([
  '.json',
  '.moc3',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.wav',
  '.mp3',
  '.ogg',
  '.m4a',
  '.aac',
  '.bin',
  '.dat',
])

export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isAllowedModelAsset(file: string): boolean {
  return MODEL_ASSET_EXTENSIONS.has(extname(file).toLowerCase())
}

/**
 * 把相对路径解析成真实文件；越界、目录、未知扩展名一律返回 null。
 */
export function resolveContainedModelFile(
  roots: string[],
  relativePath: string,
): string | null {
  if (!relativePath || relativePath.includes('\0')) return null

  for (const root of roots) {
    let rootReal = ''
    try {
      rootReal = realpathSync(root)
    } catch {
      continue
    }
    const candidate = normalize(join(rootReal, relativePath))
    let real = ''
    try {
      real = realpathSync(candidate)
    } catch {
      continue
    }
    if (!isPathInside(rootReal, real)) continue
    try {
      if (!statSync(real).isFile()) continue
    } catch {
      continue
    }
    if (!isAllowedModelAsset(real)) continue
    return real
  }
  return null
}

/**
 * 预设文件固定写在模型文件同目录。若目标已存在且是指向外部的链接，则拒绝。
 */
export function isSafePresetTarget(modelFile: string, targetFile: string): boolean {
  let dirReal = ''
  try {
    dirReal = realpathSync(dirname(modelFile))
  } catch {
    return false
  }
  let targetReal: string | null = null
  try {
    targetReal = realpathSync(targetFile)
  } catch {
    // 目标还不存在：目录已确认在模型根内，可以创建
    return true
  }
  if (!isPathInside(dirReal, targetReal)) return false
  try {
    return statSync(targetReal).isFile()
  } catch {
    return false
  }
}
