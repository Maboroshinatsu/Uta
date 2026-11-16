<template>
  <aside class="uta-nav-sidebar" aria-label="设置导航">
    <div class="nav-brand-header">
      <div class="brand-avatar-box" aria-hidden="true">
        <img src="/uta-icon.svg" class="brand-avatar-img" alt="Uta" />
      </div>
      <div class="brand-text">
        <h1 class="brand-title">设置中心</h1>
        <span class="brand-sub">模型、动作与连接</span>
      </div>
    </div>

    <nav class="nav-domains" aria-label="设置领域">
      <ul class="nav-list" role="list">
        <li v-for="item in domains" :key="item.id" class="nav-item">
          <button
            type="button"
            class="nav-tab-btn"
            :class="{ 'is-active': activeDomain === item.id }"
            :aria-current="activeDomain === item.id ? 'page' : undefined"
            @click="selectDomain(item.id)"
          >
            <span class="tab-icon" aria-hidden="true">
              <SettingsIcon :name="item.icon" />
            </span>
            <span class="tab-label">{{ item.label }}</span>
            <span v-if="activeDomain === item.id" class="tab-active-mark" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </nav>

    <div class="nav-footer">
      <button
        type="button"
        class="theme-toggle-btn"
        :aria-label="theme === 'light' ? '切换到深色主题' : '切换到浅色主题'"
        @click="toggleTheme"
      >
        <SettingsIcon :name="theme === 'light' ? 'moon' : 'sun'" :size="16" />
        <span>{{ theme === 'light' ? '切换深色模式' : '切换浅色模式' }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { SETTINGS_DOMAINS, DEFAULT_SETTINGS_DOMAIN, type SettingsDomainId } from '../../settings-window/settings-domains'
import SettingsIcon from './SettingsIcon.vue'

const props = withDefaults(
  defineProps<{
    activeDomain?: SettingsDomainId
    theme?: 'light' | 'dark'
    environmentLabel?: string
  }>(),
  {
    activeDomain: DEFAULT_SETTINGS_DOMAIN,
    theme: 'light',
    environmentLabel: '环境未确认',
  }
)

const emit = defineEmits<{
  (e: 'update:activeDomain', domain: SettingsDomainId): void
  (e: 'update:theme', theme: 'light' | 'dark'): void
}>()

const domains = SETTINGS_DOMAINS

function selectDomain(id: SettingsDomainId) {
  if (props.activeDomain === id) return
  emit('update:activeDomain', id)
}

function toggleTheme() {
  emit('update:theme', props.theme === 'light' ? 'dark' : 'light')
}
</script>

<style scoped>
.uta-nav-sidebar {
  display: flex;
  flex-direction: column;
  width: 228px;
  min-width: 228px;
  background-color: var(--uta-canvas);
  border-right: 1px solid var(--uta-separator);
  padding: 22px 14px 16px;
  box-sizing: border-box;
  user-select: none;
  flex-shrink: 0;
  min-height: 0;
  overflow-y: auto;
  transition:
    background-color 0.28s ease,
    border-color 0.28s ease;
}

.nav-brand-header {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 2px 6px 22px;
}

.brand-avatar-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: transparent;
  flex-shrink: 0;
  overflow: hidden;
}

.brand-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--uta-ink);
  line-height: 1.25;
}

.brand-sub {
  font-size: 11px;
  color: var(--uta-muted);
  margin-top: 2px;
}

.nav-domains {
  flex: 1;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-tab-btn {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 38px;
  padding: 8px 11px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--uta-secondary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--uta-transition-fast),
    color var(--uta-transition-fast),
    transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-tab-btn:hover {
  background-color: var(--uta-surface);
  color: var(--uta-ink);
}

.nav-tab-btn:active {
  transform: scale(0.97);
}

.nav-tab-btn:focus-visible {
  box-shadow: 0 0 0 3px var(--uta-focus-ring);
}

.nav-tab-btn.is-active {
  background-color: var(--uta-accent-soft);
  color: var(--uta-accent-read);
  font-weight: 600;
}

.tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  margin-right: 10px;
  color: currentColor;
  opacity: 0.9;
}

.tab-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-active-mark {
  width: 4px;
  height: 16px;
  border-radius: 999px;
  background-color: var(--uta-accent);
  flex-shrink: 0;
  animation: tab-mark-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes tab-mark-in {
  from {
    transform: scaleY(0.4);
    opacity: 0;
  }
  to {
    transform: scaleY(1);
    opacity: 1;
  }
}

.nav-footer {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--uta-separator);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  background-color: var(--uta-surface);
  border: 1px solid var(--uta-separator);
  border-radius: 10px;
  color: var(--uta-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition:
    color var(--uta-transition-fast),
    border-color var(--uta-transition-fast),
    transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.theme-toggle-btn:hover {
  color: var(--uta-ink);
  border-color: var(--uta-muted);
}

.theme-toggle-btn:active {
  transform: scale(0.97);
}

.theme-toggle-btn:focus-visible {
  outline: 2px solid var(--uta-focus);
  outline-offset: 2px;
}

@media (min-width: 621px) and (max-width: 800px) {
  .uta-nav-sidebar {
    width: 190px;
    min-width: 190px;
    padding: 18px 10px 14px;
  }
  .brand-title { font-size: 14px; }
  .brand-sub { display: none; }
  .nav-tab-btn { padding: 8px 9px; }
  .tab-icon { margin-right: 8px; }
}

@media (max-width: 620px) {
  .uta-nav-sidebar {
    width: 100%;
    min-width: 0;
    padding: 8px 10px 10px;
    border-right: none;
    border-bottom: 1px solid var(--uta-separator);
    overflow: visible;
  }
  .nav-brand-header,
  .nav-footer {
    display: none;
  }
  .nav-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }
  .nav-tab-btn {
    min-height: 36px;
    padding: 7px 7px;
    font-size: 12px;
    justify-content: center;
  }
  .tab-icon {
    margin-right: 5px;
  }
  .tab-active-mark {
    display: none;
  }
}
</style>
