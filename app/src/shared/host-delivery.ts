/** Input delivery is separate from the host turn's success, failure or cancellation. */
export type HostDeliveryState = 'not-sent' | 'queued' | 'accepted' | 'completed' | 'unknown'

export interface HostDeliveryReceipt {
  ok: boolean
  delivery?: HostDeliveryState
  accepted?: boolean
}

export function deliveryPresentation(receipt: HostDeliveryReceipt | null): {
  delivery: 'sent' | 'failed' | 'unknown'
  deliveryStage?: 'queued'
  restoreDraft: boolean
} {
  if (!receipt || receipt.delivery === 'unknown') return { delivery: 'unknown', restoreDraft: false }
  if (receipt.delivery === 'queued') return { delivery: 'sent', deliveryStage: 'queued', restoreDraft: false }
  if (receipt.ok || receipt.delivery === 'accepted' || receipt.delivery === 'completed') {
    return { delivery: 'sent', restoreDraft: false }
  }
  return { delivery: 'failed', restoreDraft: true }
}

export function deliveryLabel(delivery: 'pending' | 'sent' | 'failed' | 'unknown', stage?: 'queued'): string {
  return stage === 'queued' && delivery === 'sent'
    ? '已排队'
    : { pending: '发送中', sent: '已发送', failed: '未发送', unknown: '未确认' }[delivery]
}
