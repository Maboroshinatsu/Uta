/** 页面切换即卸载的场景下，用 sessionStorage 保住尚未提交的输入。 */
const PREFIX = 'uta:draft:'

export function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(PREFIX + key, value)
    else sessionStorage.removeItem(PREFIX + key)
  } catch {
    /* 存储不可用时只影响草稿保留 */
  }
}
