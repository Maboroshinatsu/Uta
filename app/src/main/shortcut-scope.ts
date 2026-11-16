export interface EndpointOwner {
  file: string
  pid: unknown
}

/**
 * 系统热键是全局唯一的：只要还有另一个存活实例发布了端点，
 * 非 stable 的开发实例就不该接管，否则会把日常桌宠的快捷键抢走。
 */
export function findForeignLiveEndpoint(
  owners: readonly EndpointOwner[],
  ownPid: number,
  isAlive: (pid: number) => boolean,
): string | null {
  for (const owner of owners) {
    if (typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue
    if (owner.pid === ownPid) continue
    if (isAlive(owner.pid)) return owner.file
  }
  return null
}
