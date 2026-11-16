/**
 * Microphone access follows the trusted pet window, not the data profile.
 * Candidate and development profiles use isolated data but still need voice input.
 */
export function shouldAllowMediaPermission(permission: string, isPetWindow: boolean): boolean {
  return permission === 'media' && isPetWindow
}
