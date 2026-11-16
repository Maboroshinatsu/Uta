import path from 'node:path'

export interface HostEndpointScope {
  /** stable 日常数据目录：允许发布共享的宿主专属端点。 */
  isStable: boolean
  /** Pets 启动器会显式传入 UTA_BOUND_HOST；也允许共享发现。 */
  explicitBoundHost?: string
  /** 用户在当前实例中手动配对的宿主；普通测试 profile 不自动发布。 */
  pairedHost?: string
}

/**
 * 日常、Pets 启动器和用户明确配对的实例发布 `host-pets/<host>` 共享端点。
 * 普通开发/候选 profile 使用私有端点；仅手动切换或重连才启用共享发现。
 */
export function resolveHostEndpointFile(
  appData: string,
  hostId: string,
  scope: HostEndpointScope,
): string {
  if (!scope.isStable && !scope.explicitBoundHost && scope.pairedHost !== hostId) return ''
  return path.join(appData, 'uta', 'host-pets', hostId, 'runtime-endpoint.json')
}
