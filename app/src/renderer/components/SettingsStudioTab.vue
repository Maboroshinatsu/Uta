<template>
  <div class="settings-studio-tab">
    <p v-if="workshop.store.presetSaveMessage" class="preset-save-feedback" :data-status="workshop.store.presetSaveStatus" role="status" aria-live="polite">
      {{ workshop.store.presetSaveMessage }}
    </p>

    <!-- 一级底板 / 核心双列工作台 (22px Squircle 连续圆角) -->
    <div class="studio-workbench-shell">
      <div class="studio-workbench-board">
      <!-- 左列：动作流分镜栈 + 时间线 + 常用片段 -->
      <div class="studio-stack-col">
        <WorkshopKeyframeStack
          :steps="workshop.editingSteps"
          :active-index="workshop.editingStepIndex"
          :creating="workshop.isCreatingNewPreset"
          @select="workshop.selectEditingStep"
          @add="workshop.addEditingStep"
          @remove="workshop.removeEditingStepAtIndex"
        />

        <!-- 动作节奏流时间线 (Timeline Stream) -->
        <div class="studio-timeline-card">
          <div class="studio-timeline-head">
            <span class="studio-timeline-title">动作节奏流 · TIMELINE</span>
            <span class="studio-timeline-duration">{{ totalSequenceDurationSec }}s 总时长</span>
          </div>
          <div class="studio-timeline-bar" role="img" aria-label="分镜时长比例">
            <div
              v-for="(step, idx) in workshop.editingSteps"
              :key="idx"
              class="timeline-segment"
              :class="[`seg-accent-${idx % 6}`, { active: idx === workshop.editingStepIndex }]"
              :style="{ flex: Math.max(0.12, (step.durationMs + (step.holdMs || 0))) }"
              :title="`第 ${idx + 1} 步: ${step.label || '步骤 ' + (idx + 1)} (${((step.durationMs + (step.holdMs || 0)) / 1000).toFixed(1)}s)`"
              @click="workshop.selectEditingStep(idx)"
            />
          </div>
          <div class="studio-timeline-meta">
            <span>{{ workshop.editingSteps.length }} 个动作分镜</span>
            <span>{{ workshop.finishModeShortLabel }}</span>
          </div>
        </div>

        <!-- 常用动作片段快捷追加 (Quick Snippets) -->
        <div class="studio-snippets-block">
          <span class="studio-section-label">一键追加常用动作片段</span>
          <div class="studio-snippets-grid">
            <button
              type="button"
              class="studio-snippet-btn pressable"
              :disabled="!workshop.canUseQuickSnippet('blink')"
              :title="workshop.quickSnippetTitle('blink')"
              @click="workshop.addQuickSnippet('blink')"
            >
              + 眨眼
            </button>
            <button
              type="button"
              class="studio-snippet-btn pressable"
              :disabled="!workshop.canUseQuickSnippet('nod')"
              :title="workshop.quickSnippetTitle('nod')"
              @click="workshop.addQuickSnippet('nod')"
            >
              + 点头
            </button>
            <button
              type="button"
              class="studio-snippet-btn pressable"
              :disabled="!workshop.canUseQuickSnippet('tilt')"
              :title="workshop.quickSnippetTitle('tilt')"
              @click="workshop.addQuickSnippet('tilt')"
            >
              + 歪头
            </button>
            <button
              type="button"
              class="studio-snippet-btn pressable"
              :disabled="!workshop.canUseQuickSnippet('gasp')"
              :title="workshop.quickSnippetTitle('gasp')"
              @click="workshop.addQuickSnippet('gasp')"
            >
              + 惊讶
            </button>
          </div>
          <span class="studio-snippet-hint">一键追加泛用微动作分镜（眨眼、点头、歪头、惊讶）。</span>
        </div>

        <!-- 收尾恢复方式 -->
        <div class="studio-sub-block">
          <span class="studio-section-label">收尾恢复方式</span>
          <div class="studio-mode-strip">
            <button
              type="button"
              class="studio-mode-btn pressable"
              :class="{ active: workshop.editingFinishMode === 'revert' }"
              @click="workshop.editingFinishMode = 'revert'"
            >
              播完恢复
            </button>
            <button
              type="button"
              class="studio-mode-btn pressable"
              :class="{ active: workshop.editingFinishMode === 'hold' }"
              @click="workshop.editingFinishMode = 'hold'"
            >
              持续保持
            </button>
            <button
              type="button"
              class="studio-mode-btn pressable"
              :class="{ active: workshop.editingFinishMode === 'loop' }"
              @click="workshop.editingFinishMode = 'loop'"
            >
              循环往复
            </button>
          </div>
        </div>

        <!-- 操作栏（撤销 / 重做 / 预览 / 保存） -->
        <div class="studio-action-row">
          <button
            type="button"
            class="bio-btn-pill pressable"
            :disabled="!workshop.canUndoWorkshop"
            title="撤销上一步编辑"
            @click="workshop.undoWorkshop"
          >
            ↶ 撤销
          </button>
          <button
            type="button"
            class="bio-btn-pill pressable"
            :disabled="!workshop.canRedoWorkshop"
            title="重做刚才撤销的编辑"
            @click="workshop.redoWorkshop"
          >
            ↷ 重做
          </button>
          <button
            type="button"
            class="bio-btn-pill clay pressable"
            title="从第 1 步到最后一步完整预览连续动画"
            @click="workshop.previewEditingSequence"
          >
            ▶ 预览序列
          </button>
          <button
            type="button"
            class="bio-btn-pill pressable studio-export-motion-btn"
            title="将当前分镜序列导出为标准 Live2D motion3.json 动作文件（可直接放入 VTube Studio / Cubism 项目）"
            @click="workshop.exportEditingSequenceToMotion3"
          >
            ⤓ 导出 motion3.json
          </button>
          <button
            v-if="workshop.isCreatingNewPreset"
            type="button"
            class="bio-btn-pill pressable"
            title="取消新建并回到上一个预设"
            @click="workshop.cancelNewPreset"
          >
            取消新建
          </button>
          <button
            type="button"
            class="bio-btn-pill accent save-main-btn pressable"
            :disabled="!workshop.customPresetName.trim()"
            @click="workshop.saveCurrentCombo"
          >
            {{ workshop.saveButtonLabel }}
          </button>
        </div>
      </div>

      <!-- 右列：状态预设选择 + 当前帧参数 + FLOWING FORMS 神态微调 -->
      <div class="studio-detail-col">
        <!-- 卡片 1：状态预设选择 (Surface Presets) -->
        <div class="studio-card-panel">
          <div class="studio-panel-header">
            <span class="studio-panel-kicker">SURFACE PRESETS · 状态预设</span>
            <span class="bio-fold-badge" :class="{ accent: workshop.workshopDirty }">
              {{ workshop.workshopDirty ? '未保存草稿' : '预设已就绪' }}
            </span>
          </div>

          <div class="studio-group-chips">
            <button
              v-for="g in workshop.presetGroupOptions()"
              :key="g.group"
              type="button"
              class="studio-group-chip pressable"
              :class="{ active: workshop.editingGroup === g.group }"
              @click="workshop.selectPresetGroupOption(g.group, g.emotion)"
            >
              {{ g.group }}
            </button>
          </div>

          <div class="studio-name-row">
            <input
              v-model="workshop.editingGroup"
              class="bio-pill-input group-name-input"
              placeholder="分组名(如 开心)"
              maxlength="10"
              title="所属情绪分组名"
            />
            <input
              :ref="workshop.bindPresetNameInput"
              v-model="workshop.customPresetName"
              class="bio-pill-input preset-name-input"
              :placeholder="workshop.isCreatingNewPreset ? '输入预设名称(如 开心·歪头笑)...' : '输入预设名称（同名覆盖）...'"
              maxlength="18"
              @keydown.enter.prevent="workshop.saveCurrentCombo"
            />
          </div>
        </div>

        <!-- 卡片 2：当前步骤参数与时间 (Step Parameters) -->
        <div class="studio-card-panel">
          <div class="studio-panel-header">
            <span class="studio-panel-kicker">STEP PARAMETERS · 当前帧参数</span>
            <span class="bio-fold-badge">STEP {{ workshop.editingStepIndex + 1 }}</span>
          </div>

          <div class="studio-timing-row">
            <input
              v-model="workshop.currentEditingStep.label"
              class="bio-pill-input step-label-input"
              :placeholder="`步骤 ${workshop.editingStepIndex + 1}`"
              maxlength="10"
            />
            <label class="bio-time-chip" title="从上一步平滑过渡到本步骤的耗时（秒）">
              <span>过渡</span>
              <input
                type="number"
                min="0.05"
                max="5"
                step="0.05"
                :value="workshop.formatStepSec(workshop.currentEditingStep.durationMs)"
                @change="workshop.onStepDurationChange"
              />
              <span>s</span>
            </label>
            <label class="bio-time-chip" title="到达本步骤姿势后的停留时间（秒）">
              <span>停留</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.05"
                :value="workshop.formatStepSec(workshop.currentEditingStep.holdMs)"
                @change="workshop.onStepHoldChange"
              />
              <span>s</span>
            </label>
          </div>

          <div v-if="workshop.wholeMotionLabel" class="studio-step-motion-banner">
            <span class="studio-step-motion-tag">整段绑定动作：{{ workshop.wholeMotionLabel }}。整段播放以此动作为准，单帧预览可查看分镜姿态。</span>
            <button type="button" class="bio-btn-pill pressable" @click="workshop.clearWholeMotion">解除整段绑定</button>
          </div>
          <!-- 步骤绑定的动作提示 -->
          <div v-if="workshop.currentEditingStep.motion" class="studio-step-motion-banner">
            <span class="studio-step-motion-tag">
              本步骤分镜绑定动作：{{ workshop.currentEditingStep.motion.group }}
            </span>
          </div>

          <!-- 原生动作 -->
          <div class="studio-motion-block">
            <label class="studio-motion-row">
              <span class="studio-motion-label">本步骤原生动作</span>
              <select
                class="bio-pill-input studio-motion-select"
                :value="workshop.motionSelection"
                @change="workshop.onMotionSelect"
              >
                <option value="none">本步骤不另绑定动作</option>
                <option
                  v-for="(option, idx) in workshop.presetMotionOptions"
                  :key="`${option.group}-${option.index}`"
                  :value="String(idx)"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <!-- 当前分镜生效部件与微调参数摘要 -->
          <div class="studio-step-summary-block">
            <div class="studio-step-summary-head">
              <span class="studio-step-summary-kicker">本帧已调参数与部件</span>
            </div>

            <!-- 启用的部件 -->
            <div v-if="workshop.currentStepActiveControls && workshop.currentStepActiveControls.length > 0" class="studio-step-summary-row">
              <span class="studio-step-summary-label">部件</span>
              <div class="studio-step-summary-chips">
                <span
                  v-for="ctrl in workshop.currentStepActiveControls"
                  :key="ctrl.id"
                  class="studio-summary-chip is-control"
                  :title="ctrl.label"
                >
                  <span class="summary-dot" />
                  {{ workshop.formatControlLabel(ctrl.label) }}
                  <span v-if="ctrl.stageLabel" class="summary-stage">{{ ctrl.stageLabel }}</span>
                </span>
              </div>
            </div>

            <!-- 已调参数 -->
            <div v-if="workshop.currentStepModifiedSliders && workshop.currentStepModifiedSliders.length > 0" class="studio-step-summary-row">
              <span class="studio-step-summary-label">参数</span>
              <div class="studio-step-summary-chips">
                <span
                  v-for="slider in workshop.currentStepModifiedSliders"
                  :key="slider.id"
                  class="studio-summary-chip is-param"
                  :title="slider.label"
                >
                  {{ slider.label }}: {{ slider.diffText }}
                </span>
              </div>
            </div>

            <!-- 无特殊改动提示 -->
            <div
              v-if="(!workshop.currentStepActiveControls || workshop.currentStepActiveControls.length === 0) &&
                    (!workshop.currentStepModifiedSliders || workshop.currentStepModifiedSliders.length === 0)"
              class="studio-step-summary-empty"
            >
              自然中位站姿（所有参数处于默认值，无特殊部件）
            </div>
          </div>
        </div>

        <!-- 卡片 3：FLOWING FORMS · 当前神态微调 (Face Sliders) 手风琴收纳 -->
        <div
          v-if="workshop.faceSliders.length > 0"
          class="bio-fold-card scroll-reactive"
          :class="{ open: workshop.expandedSections.face }"
        >
          <div
            class="bio-fold-head"
            role="button"
            tabindex="0"
            :aria-expanded="workshop.expandedSections.face"
            @click="workshop.toggleSection('face')"
            @keydown.enter.prevent="workshop.toggleSection('face')"
            @keydown.space.prevent="workshop.toggleSection('face')"
          >
            <div class="bio-fold-title-wrap">
              <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="bio-fold-title">五官与眼神</span>
              <span class="bio-fold-badge" :class="{ accent: workshop.modifiedFaceSliderCount > 0 }">
                {{ workshop.modifiedFaceSliderCount > 0 ? `已改 ${workshop.modifiedFaceSliderCount}` : `${workshop.faceSliders.length}项` }}
              </span>
            </div>
            <div class="bio-fold-right" @click.stop @keydown.stop>
              <button
                type="button"
                class="bio-sec-link pressable"
                @click="workshop.resetSlidersByGroup('face')"
              >
                五官归零
              </button>
            </div>
          </div>

          <div
            class="bio-fold-collapse"
            :class="{ open: workshop.expandedSections.face }"
            :inert="!workshop.expandedSections.face"
          >
            <div class="bio-fold-inner">
              <div class="bio-fold-body">
                <div class="bio-slider-list">
                  <div
                    v-for="slider in workshop.faceSliders"
                    :key="slider.id"
                    class="bio-scrub"
                  >
                    <div
                      class="bio-scrub-fill"
                      :style="{ left: '0%', width: workshop.getSliderFillPercent(slider) + '%' }"
                    />
                    <div class="bio-scrub-grip" :style="{ left: workshop.getSliderGripLeft(slider) }" />
                    <span class="bio-scrub-label">{{ slider.label }}</span>
                    <button
                      type="button"
                      class="bio-scrub-val"
                      :class="{ modified: workshop.isStepSliderModified(slider) }"
                      title="点击数值复位该参数"
                      @click="workshop.resetSingleSlider(slider)"
                    >
                      {{ workshop.formatSliderValue(workshop.getStepSliderValue(slider), slider.step) }}{{ workshop.isStepSliderModified(slider) ? ' ↺' : '' }}
                    </button>
                    <input
                      type="range"
                      class="bio-range-input"
                      :min="slider.min"
                      :max="slider.max"
                      step="0.01"
                      :value="workshop.getStepSliderValue(slider)"
                      @input="workshop.onSliderInput(slider, $event)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 卡片 4：可选部件快捷开关 (Controls) 手风琴收纳 -->
        <div
          v-if="workshop.totalControlsCount > 0"
          class="bio-fold-card scroll-reactive"
          :class="{ open: workshop.expandedSections.controls }"
        >
          <div
            class="bio-fold-head"
            role="button"
            tabindex="0"
            :aria-expanded="workshop.expandedSections.controls"
            @click="workshop.toggleSection('controls')"
            @keydown.enter.prevent="workshop.toggleSection('controls')"
            @keydown.space.prevent="workshop.toggleSection('controls')"
          >
            <div class="bio-fold-title-wrap">
              <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="bio-fold-title">可选部件</span>
              <span class="bio-fold-badge" :class="{ accent: workshop.activeStepControlsCount > 0 }">
                {{ workshop.activeStepControlsCount }}/{{ workshop.totalControlsCount }}
              </span>
            </div>
            <div class="bio-fold-right" @click.stop @keydown.stop>
              <button
                type="button"
                class="bio-sec-link pressable"
                @click="workshop.resetTransientControls"
              >
                重置部件
              </button>
            </div>
          </div>

          <div
            class="bio-fold-collapse"
            :class="{ open: workshop.expandedSections.controls }"
            :inert="!workshop.expandedSections.controls"
          >
            <div class="bio-fold-inner">
              <div class="bio-fold-body">
                <div
                  v-for="group in workshop.controlGroups"
                  :key="group.category"
                  class="ctrl-group-box"
                >
                  <div class="ctrl-group-header">
                    <span class="ctrl-group-title">{{ group.label }}</span>
                    <span class="ctrl-group-count">{{ group.activeCount }}/{{ group.items.length }}</span>
                  </div>
                  <div class="ctrl-capsule-grid">
                    <button
                      v-for="ctrl in group.items"
                      :key="ctrl.id"
                      type="button"
                      class="ctrl-capsule pressable"
                      :class="{
                        active: workshop.isStepControlActive(ctrl.id),
                        'full-row': workshop.shouldSpanFullRow(ctrl, group.items.length),
                      }"
                      :title="ctrl.label"
                      @click="workshop.toggleSingleControl(ctrl.id)"
                    >
                      <span class="ctrl-dot" />
                      <span class="ctrl-name">{{ workshop.formatControlLabel(ctrl.label) }}</span>
                      <span v-if="ctrl.stages && ctrl.stages.length > 0" class="ctrl-state-tag">{{ ctrl.stages[ctrl.currentStageIndex ?? 0]?.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 卡片 5：头部与身体姿态 (Pose) 手风琴收纳 -->
        <div
          v-if="workshop.poseSliders.length > 0"
          class="bio-fold-card scroll-reactive"
          :class="{ open: workshop.expandedSections.pose }"
        >
          <div
            class="bio-fold-head"
            role="button"
            tabindex="0"
            :aria-expanded="workshop.expandedSections.pose"
            @click="workshop.toggleSection('pose')"
            @keydown.enter.prevent="workshop.toggleSection('pose')"
            @keydown.space.prevent="workshop.toggleSection('pose')"
          >
            <div class="bio-fold-title-wrap">
              <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="bio-fold-title">头部与身体姿态</span>
              <span class="bio-fold-badge" :class="{ accent: workshop.modifiedPoseSliderCount > 0 }">
                {{ workshop.modifiedPoseSliderCount > 0 ? `已改 ${workshop.modifiedPoseSliderCount}` : `${workshop.poseSliders.length}项` }}
              </span>
            </div>
            <div class="bio-fold-right" @click.stop @keydown.stop>
              <button type="button" class="bio-sec-link pressable" @click="workshop.resetSlidersByGroup('pose')">
                归零
              </button>
            </div>
          </div>

          <div
            class="bio-fold-collapse"
            :class="{ open: workshop.expandedSections.pose }"
            :inert="!workshop.expandedSections.pose"
          >
            <div class="bio-fold-inner">
              <div class="bio-fold-body">
                <div class="bio-slider-list">
                  <div v-for="slider in workshop.poseSliders" :key="slider.id" class="bio-scrub">
                    <div class="bio-scrub-fill" :style="{ left: '0%', width: workshop.getSliderFillPercent(slider) + '%' }" />
                    <div class="bio-scrub-grip" :style="{ left: workshop.getSliderGripLeft(slider) }" />
                    <span class="bio-scrub-label">{{ slider.label }}</span>
                    <button
                      type="button"
                      class="bio-scrub-val"
                      :class="{ modified: workshop.isStepSliderModified(slider) }"
                      title="点击数值复位"
                      @click="workshop.resetSingleSlider(slider)"
                    >
                      {{ workshop.formatSliderValue(workshop.getStepSliderValue(slider), slider.step) }}{{ workshop.isStepSliderModified(slider) ? ' ↺' : '' }}
                    </button>
                    <input
                      type="range"
                      class="bio-range-input"
                      :min="slider.min"
                      :max="slider.max"
                      step="0.01"
                      :value="workshop.getStepSliderValue(slider)"
                      @input="workshop.onSliderInput(slider, $event)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 卡片 6：高级参数（发型/道具/特效通道） 手风琴收纳 -->
        <div
          v-if="workshop.extraSliders.length > 0"
          class="bio-fold-card scroll-reactive"
          :class="{ open: workshop.expandedSections.extra }"
        >
          <div
            class="bio-fold-head"
            role="button"
            tabindex="0"
            :aria-expanded="workshop.expandedSections.extra"
            @click="workshop.toggleSection('extra')"
            @keydown.enter.prevent="workshop.toggleSection('extra')"
            @keydown.space.prevent="workshop.toggleSection('extra')"
          >
            <div class="bio-fold-title-wrap">
              <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="bio-fold-title">高级通道微调</span>
              <span class="bio-fold-badge" :class="{ accent: workshop.modifiedExtraSliderCount > 0 }">
                {{ workshop.modifiedExtraSliderCount > 0 ? `已改 ${workshop.modifiedExtraSliderCount}` : `${workshop.extraSliders.length}项` }}
              </span>
            </div>
            <div class="bio-fold-right" @click.stop @keydown.stop>
              <button type="button" class="bio-sec-link pressable" @click="workshop.resetSlidersByGroup('extra')">
                归零
              </button>
            </div>
          </div>

          <div
            class="bio-fold-collapse"
            :class="{ open: workshop.expandedSections.extra }"
            :inert="!workshop.expandedSections.extra"
          >
            <div class="bio-fold-inner">
              <div class="bio-fold-body">
                <div class="bio-slider-list">
                  <div v-for="slider in workshop.extraSliders" :key="slider.id" class="bio-scrub">
                    <div class="bio-scrub-fill" :style="{ left: '0%', width: workshop.getSliderFillPercent(slider) + '%' }" />
                    <div class="bio-scrub-grip" :style="{ left: workshop.getSliderGripLeft(slider) }" />
                    <span class="bio-scrub-label">{{ slider.label }}</span>
                    <button
                      type="button"
                      class="bio-scrub-val"
                      :class="{ modified: workshop.isStepSliderModified(slider) }"
                      title="点击数值复位"
                      @click="workshop.resetSingleSlider(slider)"
                    >
                      {{ workshop.formatSliderValue(workshop.getStepSliderValue(slider), slider.step) }}{{ workshop.isStepSliderModified(slider) ? ' ↺' : '' }}
                    </button>
                    <input
                      type="range"
                      class="bio-range-input"
                      :min="slider.min"
                      :max="slider.max"
                      step="0.01"
                      :value="workshop.getStepSliderValue(slider)"
                      @input="workshop.onSliderInput(slider, $event)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettingsWorkshop } from './settings-workshop'
import WorkshopKeyframeStack from './workshop/WorkshopKeyframeStack.vue'

const workshop = useSettingsWorkshop()

const totalSequenceDurationSec = computed(() => {
  const ms = workshop.editingSteps.reduce((acc, step) => {
    return acc + (Number(step.durationMs) || 0) + (Number(step.holdMs) || 0)
  }, 0)
  return (ms / 1000).toFixed(2)
})
</script>

<style scoped>
.settings-studio-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.studio-workbench-shell {
  width: 100%;
  container-type: inline-size;
}

.studio-workbench-board {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(320px, 1fr);
  gap: 22px;
  align-items: start;
  padding: 20px;
  border-radius: 22px;
  background: var(--dp-panel-bg);
  border: 1px solid var(--dp-border);
  box-shadow: 0 4px 18px rgba(28, 42, 49, 0.04);
  transition:
    background-color 0.28s ease,
    border-color 0.28s ease,
    box-shadow 0.28s ease;
}

.studio-stack-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.studio-detail-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.studio-sub-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.studio-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--dp-text-muted);
}

.studio-card-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--dp-surface);
  border: 1px solid var(--dp-border-subtle);
  box-shadow: 0 1px 3px rgba(28, 42, 49, 0.02);
  transition:
    background-color 0.28s ease,
    border-color 0.28s ease;
}

.studio-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.studio-panel-kicker {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--dp-text-muted);
  text-transform: uppercase;
}

/* 时间流节奏卡片 */
.studio-timeline-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--dp-surface);
  border: 1px solid var(--dp-border-subtle);
}

.studio-timeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.studio-timeline-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--dp-text-muted);
}

.studio-timeline-duration {
  font-family: var(--uta-font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  color: var(--dp-text-main);
  font-variant-numeric: tabular-nums;
}

.studio-timeline-bar {
  display: flex;
  gap: 3px;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px;
}

.timeline-segment {
  height: 100%;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
  opacity: 0.75;
}

.timeline-segment:hover {
  opacity: 1;
  transform: scaleY(1.3);
}

.timeline-segment.active {
  opacity: 1;
  box-shadow: 0 0 0 1px #fff;
}

.timeline-segment.seg-accent-0 { background: #2b6cb0; }
.timeline-segment.seg-accent-1 { background: #b76412; }
.timeline-segment.seg-accent-2 { background: #27795a; }
.timeline-segment.seg-accent-3 { background: #704ea1; }
.timeline-segment.seg-accent-4 { background: #b5475b; }
.timeline-segment.seg-accent-5 { background: #3b5a8f; }

.studio-timeline-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--dp-text-muted);
}

/* 快捷片段网格 */
.studio-snippets-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.studio-snippets-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.studio-snippet-btn {
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--dp-border);
  background: var(--dp-surface);
  color: var(--dp-text-sub);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease, transform 0.14s ease;
}

.studio-snippet-btn:hover {
  background: var(--dp-surface-hover);
  border-color: var(--dp-border-strong);
  color: var(--dp-text-main);
  transform: translateY(-1px);
}

.studio-snippet-btn:active {
  transform: scale(0.96);
}

.studio-snippet-btn:disabled {
  cursor: default;
  opacity: 0.45;
}

.studio-snippet-btn:disabled:hover {
  border-color: var(--dp-border);
  background: var(--dp-surface);
  color: var(--dp-text-sub);
  transform: none;
}

.studio-snippet-hint {
  color: var(--dp-text-muted);
  font-size: 10.5px;
  line-height: 1.45;
}

@container (max-width: 660px) {
  .studio-workbench-board {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding: 14px;
  }
}

@media (max-width: 680px) {
  .studio-workbench-board {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding: 14px;
  }
}


.studio-step-motion-banner {
  margin-bottom: 6px;
}

.studio-step-summary-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--dp-bg-input, rgba(0, 0, 0, 0.2));
  border: 1px solid var(--dp-border, rgba(255, 255, 255, 0.06));
}

.studio-step-summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.studio-step-summary-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dp-text-sub);
}

.studio-step-summary-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
}

.studio-step-summary-label {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--dp-text-sub);
  padding-top: 2px;
  min-width: 28px;
}

.studio-step-summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.studio-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 600;
}

.studio-summary-chip.is-control {
  background: var(--dp-accent-soft, rgba(46, 117, 182, 0.16));
  color: var(--dp-accent-vivid, #58a6ff);
  border: 1px solid var(--dp-accent-border, rgba(88, 166, 255, 0.25));
}

.studio-summary-chip.is-control .summary-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.studio-summary-chip.is-control .summary-stage {
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 9.5px;
}

.studio-summary-chip.is-param {
  background: rgba(255, 255, 255, 0.05);
  color: var(--dp-text, #e6edf3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: var(--uta-font-mono, monospace);
  font-size: 10.5px;
}

.studio-step-summary-empty {
  font-size: 11px;
  color: var(--dp-text-sub);
  font-style: italic;
  padding: 2px 0;
}

.studio-step-motion-tag {
  display: inline-block;
  font-family: var(--uta-font-mono, monospace);
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--uta-accent-soft, rgba(61, 106, 142, 0.12));
  color: var(--uta-accent-read, var(--dp-accent));
}

.studio-export-motion-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--dp-accent-read, #1f4e79);
  border-color: var(--dp-accent-border, rgba(46, 117, 182, 0.28));
  background: var(--dp-bg-card, #ffffff);
}

.studio-export-motion-btn:hover {
  background: var(--dp-accent-soft, rgba(46, 117, 182, 0.08));
  border-color: var(--dp-accent, #2e75b6);
}
</style>
