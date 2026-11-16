<template>
  <section class="settings-panel diagnostics-panel" aria-label="运行环境身份与诊断">
    <div class="panel-head">
      <div class="panel-head-copy">
        <span class="panel-kicker">运行环境</span>
        <h3 class="panel-title">诊断信息</h3>
        <p class="panel-hint">确认当前启动的是哪份 Uta。内部路径默认折叠，只显示实例信息，不代表宿主已连接。</p>
      </div>
      <div class="diag-actions">
        <span v-if="diagnostics.data" class="panel-badge" :class="{ 'is-positive': isStable, 'is-warning': !isStable }">
          {{ profileBadge.label }}
        </span>
        <button type="button" class="uta-button is-secondary" :disabled="diagnostics.status === 'loading'" @click="loadDiagnostics">
          {{ diagnostics.status === 'loading' ? '正在检测…' : '重新检测' }}
        </button>
      </div>
    </div>

    <div v-if="diagnostics.status === 'loading' && !diagnostics.data" class="diag-state">
      <span class="status-dot is-warn" />
      <span>正在读取运行环境身份与隔离诊断…</span>
    </div>

    <div v-else-if="diagnostics.status === 'error'" class="diag-state is-error">
      <span class="status-dot" />
      <span>{{ diagnostics.errorMessage || '获取环境诊断信息失败，请重试。' }}</span>
      <button type="button" class="uta-button is-ghost" @click="loadDiagnostics">重试</button>
    </div>

    <div v-else-if="diagnostics.status === 'no-api'" class="diag-state">
      <span class="status-dot" />
      <span>{{ diagnostics.errorMessage || '未检测到桌面运行环境 API' }}</span>
    </div>

    <div v-if="diagnostics.data" class="diag-body">
      <div class="spec-grid">
        <div class="spec-cell">
          <span class="spec-label">Profile 标识</span>
          <span class="spec-value" :title="diagnostics.data.profile">{{ diagnostics.data.profile || '未命名' }}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">交付模式</span>
          <span class="spec-value">{{ formatPackaged(diagnostics.data.packaged) }}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">应用版本</span>
          <span class="spec-value">{{ diagnostics.data.version ? `v${diagnostics.data.version}` : '未知' }}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">构建提交</span>
          <span class="spec-value is-mono">{{ formatCommit(diagnostics.data.build.commit) }}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">工作区状态</span>
          <span class="spec-value">{{ formatDirty(diagnostics.data.build.dirty) }}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">构建时间</span>
          <span class="spec-value is-mono">{{ formatBuiltAt(diagnostics.data.build.builtAt) }}</span>
        </div>
      </div>

      <button
        type="button"
        class="paths-toggle"
        :aria-expanded="pathsExpanded"
        @click="togglePaths"
      >
        <span>内部路径与端点配置</span>
        <span class="paths-toggle-state">{{ pathsExpanded ? '已展开' : '已折叠' }}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      <div v-if="pathsExpanded" class="paths-panel">
        <div class="path-item">
          <span class="path-title">用户数据目录</span>
          <div class="path-value">{{ diagnostics.data.userData || '未设定' }}</div>
        </div>
        <div class="path-item">
          <span class="path-title">运行态目录</span>
          <div class="path-value">{{ diagnostics.data.runtimeDir || '未设定' }}</div>
        </div>
        <div class="path-item">
          <span class="path-title">实例端点文件</span>
          <div class="path-value">{{ diagnostics.data.endpointFile || '未设定' }}</div>
        </div>
        <div class="path-item">
          <span class="path-title">源码或解压根目录</span>
          <div class="path-value">{{ diagnostics.data.sourceDir || '未设定' }}</div>
        </div>
        <p class="paths-security-note">这里只显示实例信息与路径，不代表宿主已经连接。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  fetchEnvironmentDiagnostics,
  formatBuiltAt,
  formatCommit,
  formatDirty,
  formatPackaged,
  formatProfileBadge,
  isStableProfile,
  shouldDefaultExpandPaths,
  type DiagnosticsState,
} from '@/services/runtime-diagnostics'

const diagnostics = ref<DiagnosticsState>({
  status: 'idle',
  data: null,
  errorMessage: null,
})

const pathsExpanded = ref(false)
const userInteractedWithPaths = ref(false)

let isMounted = false
let currentReqId = 0

const isStable = computed(() => isStableProfile(diagnostics.value.data?.profile))
const profileBadge = computed(() => formatProfileBadge(diagnostics.value.data?.profile))

function togglePaths() {
  userInteractedWithPaths.value = true
  pathsExpanded.value = !pathsExpanded.value
}

async function loadDiagnostics() {
  const reqId = ++currentReqId
  diagnostics.value = {
    status: 'loading',
    data: diagnostics.value.data,
    errorMessage: null,
  }

  const result = await fetchEnvironmentDiagnostics(window.utaAPI)

  if (!isMounted || reqId !== currentReqId) return

  diagnostics.value = result

  if (result.status === 'success' && result.data) {
    if (!userInteractedWithPaths.value) {
      pathsExpanded.value = shouldDefaultExpandPaths(result.data.profile)
    }
  }
}

onMounted(() => {
  isMounted = true
  void loadDiagnostics()
})

onUnmounted(() => {
  isMounted = false
})
</script>

<style scoped>
.diag-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.diag-state {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 12px;
  padding: 11px 12px;
  border-radius: 10px;
  background-color: var(--uta-canvas);
  color: var(--uta-secondary);
  font-size: 12.5px;
  line-height: 1.5;
  flex-wrap: wrap;
}

.diag-state.is-error {
  background-color: var(--uta-error-bg);
  color: var(--uta-error);
}

.diag-body {
  margin-top: 14px;
}

.spec-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.spec-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 9px;
  background-color: var(--uta-canvas);
}

.spec-label {
  font-size: 11px;
  color: var(--uta-secondary);
}

.spec-value {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uta-ink);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.spec-value.is-mono {
  font-family: var(--uta-font-mono);
  font-size: 11.5px;
}

.paths-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  margin-top: 12px;
  padding: 0 11px;
  border: 1px solid var(--uta-separator);
  border-radius: 9px;
  background-color: var(--uta-surface);
  color: var(--uta-ink);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.paths-toggle-state {
  margin-left: auto;
  font-size: 11px;
  color: var(--uta-secondary);
}

.paths-toggle svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.paths-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 8px;
  padding: 11px;
  border-radius: 9px;
  background-color: var(--uta-canvas);
}

.path-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.path-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--uta-secondary);
}

.path-value {
  padding: 5px 8px;
  border: 1px solid var(--uta-separator);
  border-radius: 7px;
  background-color: var(--uta-surface);
  color: var(--uta-ink);
  font-family: var(--uta-font-mono);
  font-size: 11px;
  line-height: 1.45;
  word-break: break-all;
  overflow-wrap: anywhere;
  user-select: text;
}

.paths-security-note {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--uta-secondary);
}

@media (max-width: 700px) {
  .spec-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .spec-grid {
    grid-template-columns: 1fr;
  }
}
</style>
