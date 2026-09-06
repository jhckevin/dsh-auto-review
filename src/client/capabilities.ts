export const REQUIRED_UI_SLOTS = ['settings.section.icon', 'tool.call.badges', 'conversation.chat.turnTail'] as const
/** 使用原生 inject 声明屏障确认能力，声明卸载时撤销；不是注册成功就假定可用。 */
export class UiCapabilities {
  private active = new Set<string>()
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = (): string => REQUIRED_UI_SLOTS.filter(name => !this.active.has(name)).join(', ')
  set(name: string, present: boolean): void {
    const before = this.snapshot()
    if (present) this.active.add(name); else this.active.delete(name)
    if (before !== this.snapshot()) for (const listener of this.listeners) listener()
  }
}
