<template>
  <div class="settings-states-tab">
    <p v-if="workshop.store.presetSaveMessage" class="preset-save-feedback" :data-status="workshop.store.presetSaveStatus" role="status" aria-live="polite">{{ workshop.store.presetSaveMessage }}</p>
    <!-- 暖燕麦色当前状态主卡 -->
    <div class="oat-hero-well scroll-reactive">
      <div :ref="workshop.bindPebbleRef" class="oat-hero-pebble" aria-hidden="true" />
      <div class="oat-eyebrow-row">
        <span class="oat-eyebrow">
          {{
            workshop.isCreatingNewPreset
              ? '正在新建预设'
              : `当前选中 · ${workshop.editingSteps.length} 步动作`
          }}
        </span>
        <Transition name="hero-badge-pop" mode="out-in">
          <span
            :key="workshop.currentPresetBadgeText + '-' + workshop.isCurrentPresetPinned"
            class="oat-mode-pill"
            :class="{ pinned: workshop.isCurrentPresetPinned }"
          >
            {{ workshop.currentPresetBadgeText }}
          </span>
        </Transition>
      </div>

      <Transition name="hero-title-flip" mode="out-in">
        <div
          :key="workshop.activePresetId + (workshop.isCreatingNewPreset ? '-new' : '')"
          class="oat-hero-title-wrap"
        >
          <div class="oat-hero-title">
            {{
              workshop.customPresetName ||
              (workshop.isCreatingNewPreset ? '未命名新预设' : '日常待机')
            }}
          </div>
        </div>
      </Transition>

      <div v-if="workshop.displayMode === 'live2d'" class="oat-hero-actions">
        <button
          type="button"
          class="bio-btn-pill accent pressable"
          @click="workshop.openStudioForCurrentPreset"
        >
          进入预设工坊
        </button>
        <button
          v-if="workshop.currentSelectedPreset && workshop.currentSelectedPreset.id !== 'neutral'"
          type="button"
          class="bio-btn-pill pressable"
          :class="{ pinned: workshop.isCurrentPresetPinned }"
          :title="
            workshop.isCurrentPresetPinned
              ? '点击取消常驻（恢复默认待机回退基准，当前选中卡片不跳走）'
              : '将该预设钉为常驻基准（其他「播完恢复」预设演完后将回到此状态）'
          "
          @click="workshop.togglePinPreset(workshop.currentSelectedPreset)"
        >
          {{ workshop.isCurrentPresetPinned ? '已钉为常驻 ×' : '钉为常驻' }}
        </button>
        <button
          v-if="workshop.currentSelectedPreset && workshop.statePresets.length > 1"
          type="button"
          class="bio-btn-pill danger pressable"
          :title="confirmDelete ? '再次点击确认删除这个预设' : '删除当前选中的预设'"
          @click="requestDeletePreset(workshop.currentSelectedPreset.id)"
        >
          {{ confirmDelete ? '确认删除？' : '删除' }}
        </button>
      </div>
    </div>

    <!-- 状态预设：默认双列小胶囊，点击展开组内变体卡片 -->
    <div class="bio-section scroll-reactive">
      <div class="bio-sec-head">
        <span class="bio-sec-label">
          状态预设 ({{ workshop.groupedStatePresets.length }}组 ·
          {{ workshop.statePresets.length }}项)
        </span>
        <div class="bio-sec-links">
          <button
            type="button"
            class="bio-sec-link pressable"
            :title="confirmRestore ? '再次点击确认：将删除自定义预设并恢复模型初始预设' : '恢复模型默认初始预设（会删除自定义预设）'"
            @click="requestRestoreDefaults"
          >
            {{ confirmRestore ? '确认恢复？' : '恢复初始' }}
          </button>
          <span class="bio-sec-dot">·</span>
          <button
            type="button"
            class="bio-sec-link pressable"
            title="将所有开关与滑块还原为模型默认状态"
            @click="workshop.resetAllControls"
          >
            清空还原
          </button>
        </div>
      </div>

      <div class="preset-rows-stack">
        <div
          v-for="(row, rIdx) in workshop.presetGridRows"
          :key="rIdx"
          class="preset-row-block"
        >
          <div class="preset-capsule-grid">
            <template v-for="slot in row" :key="slot.kind === 'group' ? slot.grp.group : '__add_new__'">
              <div
                v-if="slot.kind === 'group'"
                class="preset-capsule group-capsule pressable cascade-item"
                :class="{
                  active: workshop.isGroupActive(slot.grp),
                  pinned: workshop.isGroupPinned(slot.grp),
                  'drawer-open': workshop.expandedGroupName === slot.grp.group,
                }"
                :style="{ '--stagger-i': Math.min(slot.gIdx, 10) }"
                :title="slot.grp.group"
                @click="workshop.onGroupCapsuleClick(slot.grp, slot.gIdx)"
              >
                <button
                  type="button"
                  class="capsule-expand-btn"
                  :class="{ open: workshop.expandedGroupName === slot.grp.group }"
                  :title="
                    workshop.expandedGroupName === slot.grp.group
                      ? `收起「${slot.grp.group}」分组变体`
                      : `展开「${slot.grp.group}」分组变体（共 ${slot.grp.items.length} 项）`
                  "
                  @click.stop="workshop.toggleExpandGroup(slot.grp.group, rIdx, slot.gIdx)"
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span class="preset-capsule-name">{{ slot.grp.group }}</span>
                <div class="preset-capsule-meta">
                  <span
                    v-if="slot.grp.items.length > 1"
                    class="preset-step-tag"
                    :title="`点击展开 ${slot.grp.items.length} 个变体`"
                    @click.stop="workshop.toggleExpandGroup(slot.grp.group, rIdx, slot.gIdx)"
                  >
                    {{ slot.grp.items.length }}
                  </span>
                  <span
                    v-else-if="(slot.grp.items[0]?.steps?.length ?? 1) > 1"
                    class="preset-step-tag"
                  >
                    {{ slot.grp.items[0]?.steps?.length }}步
                  </span>
                  <button
                    v-if="workshop.displayMode === 'live2d' && !(slot.grp.items.length === 1 && slot.grp.items[0]?.id === 'neutral')"
                    type="button"
                    class="capsule-pin-btn"
                    :class="{ active: workshop.isGroupPinned(slot.grp) }"
                    :title="
                      workshop.isGroupPinned(slot.grp)
                        ? '已钉为常驻基准（点击取消常驻）'
                        : '将该组默认预设钉为常驻保持基准'
                    "
                    @click.stop="workshop.togglePinGroup(slot.grp, slot.gIdx)"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                    </svg>
                  </button>
                </div>
              </div>

              <button
                v-else
                type="button"
                class="preset-capsule add-new pressable cascade-item"
                :style="{ '--stagger-i': Math.min(workshop.groupedStatePresets.length, 10) }"
                title="新建一个自定义状态与多步动作预设"
                @click="workshop.startNewPreset()"
              >
                <span class="preset-capsule-name">+ 新建预设</span>
              </button>
            </template>
          </div>

          <!-- 行下方的弹簧手风琴变体抽屉（0fr <-> 1fr 双向物理过渡） -->
          <div
            class="group-drawer-collapse"
            :class="{ open: workshop.isRowDrawerOpen(row) }"
            :inert="!workshop.isRowDrawerOpen(row)"
          >
            <div class="group-drawer-inner">
              <div
                v-if="workshop.getRowDrawerGroup(row, rIdx)"
                :key="workshop.getRowDrawerGroup(row, rIdx)!.grp.group"
                class="preset-group-card"
              >
                <div class="preset-group-head">
                  <div
                    class="preset-group-title-wrap"
                    title="点击收起分组变体"
                    @click="workshop.toggleExpandGroup(workshop.getRowDrawerGroup(row, rIdx)!.grp.group, rIdx, workshop.getRowDrawerGroup(row, rIdx)!.gIdx)"
                  >
                    <span class="preset-group-name">{{ workshop.getRowDrawerGroup(row, rIdx)!.grp.group }}</span>
                    <span class="preset-group-count">{{ workshop.getRowDrawerGroup(row, rIdx)!.grp.items.length }}项</span>
                  </div>
                  <div class="preset-group-actions">
                    <button
                      v-if="workshop.getRowDrawerGroup(row, rIdx)!.grp.items.length > 1"
                      type="button"
                      class="preset-group-btn rand pressable"
                      :title="`在「${workshop.getRowDrawerGroup(row, rIdx)!.grp.group}」组内随机抽取一个预设演出（防连续重复）`"
                      @click="workshop.triggerRandomInGroup(workshop.getRowDrawerGroup(row, rIdx)!.grp.group, workshop.getRowDrawerGroup(row, rIdx)!.gIdx)"
                    >
                      随机抽取
                    </button>
                    <button
                      v-if="workshop.displayMode === 'live2d'"
                      type="button"
                      class="preset-group-btn pressable"
                      :title="`在「${workshop.getRowDrawerGroup(row, rIdx)!.grp.group}」组下新建一个变体预设`"
                      @click="workshop.startNewPreset(workshop.getRowDrawerGroup(row, rIdx)!.grp.group, workshop.getRowDrawerGroup(row, rIdx)!.grp.emotion)"
                    >
                      + 变体
                    </button>
                    <button
                      type="button"
                      class="preset-group-btn pressable"
                      title="收起当前分组"
                      @click="workshop.toggleExpandGroup(workshop.getRowDrawerGroup(row, rIdx)!.grp.group, rIdx, workshop.getRowDrawerGroup(row, rIdx)!.gIdx)"
                    >
                      收起
                    </button>
                  </div>
                </div>

                <div class="preset-capsule-grid">
                  <div
                    v-for="(preset, idx) in workshop.getRowDrawerGroup(row, rIdx)!.grp.items"
                    :key="preset.id"
                    class="preset-capsule inner-variant pressable"
                    :class="{
                      active: !workshop.isCreatingNewPreset && workshop.activePresetId === preset.id,
                      pinned: workshop.store.effectiveHoldPresetId === preset.id,
                    }"
                    :style="{ '--variant-i': idx }"
                    :title="preset.label"
                    @click="workshop.applyStatePreset(preset, idx)"
                  >
                    <span class="preset-capsule-name">
                      {{ workshop.formatGroupPresetLabel(preset, workshop.getRowDrawerGroup(row, rIdx)!.grp.group) }}
                    </span>
                    <div class="preset-capsule-meta">
                      <span
                        v-if="(preset.steps?.length ?? 1) > 1"
                        class="preset-step-tag"
                      >
                        {{ preset.steps?.length }}步
                      </span>
                      <button
                        v-if="workshop.displayMode === 'live2d' && preset.id !== 'neutral'"
                        type="button"
                        class="capsule-pin-btn"
                        :class="{ active: workshop.store.effectiveHoldPresetId === preset.id }"
                        :title="
                          workshop.store.effectiveHoldPresetId === preset.id
                            ? '已钉为常驻基准（点击取消常驻）'
                            : '钉为常驻保持基准'
                        "
                        @click.stop="workshop.togglePinPreset(preset, idx)"
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="workshop.displayMode !== 'live2d'"
      class="oat-well scroll-reactive"
    >
      <span class="oat-eyebrow">静态立绘模式</span>
      <p class="bio-hint">
        当前为静态立绘模式，点击上方胶囊可立即切换立绘表情。切换至 Live2D 模型后可解锁「预设工坊」编排多步分镜、部件穿搭与五官微调。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsWorkshop } from './settings-workshop'
import { useConfirmAction } from '@/composables/useConfirmAction'

const workshop = useSettingsWorkshop()
const { armed: confirmRestore, arm: armRestore } = useConfirmAction()
const { armed: confirmDelete, arm: armDelete } = useConfirmAction()

function requestRestoreDefaults(): void {
  if (armRestore('restore-defaults')) workshop.onRestoreDefaultPresets()
}

function requestDeletePreset(presetId: string): void {
  if (armDelete(`delete-${presetId}`)) workshop.removeCustomPreset(presetId)
}
</script>
