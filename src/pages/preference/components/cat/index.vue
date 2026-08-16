<script setup lang="ts">
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Button, Divider, Flex, InputNumber, Select, Slider, Switch } from 'ant-design-vue'
import { reactive, ref, watch } from 'vue'

import type { GamePreset } from '@/composables/useChatSync'

import ProListItem from '@/components/pro-list-item/index.vue'
import ProList from '@/components/pro-list/index.vue'
import { LISTEN_KEY, WINDOW_LABEL } from '@/constants'
import { useCatStore } from '@/stores/cat'
import { CHAT_SOUND_OPTIONS, getChatSoundUrl } from '@/utils/chatSounds'
import { isWindows } from '@/utils/platform'

const catStore = useCatStore()
const settingsKey = 'bongocat-chat-settings-v1'
let savedChat: Record<string, unknown> = {}
try {
  savedChat = JSON.parse(localStorage.getItem(settingsKey) || '{}')
} catch {
  savedChat = {}
}
const chatSettings = reactive({
  showRemoteCat: savedChat.showRemoteCat !== false,
  bubbleScale: Number(savedChat.bubbleScale) || 100,
  bubbleWidth: Number(savedChat.bubbleWidth) || 360,
  bubbleHeight: Number(savedChat.bubbleHeight) || 470,
  bubbleMessageCount: Number(savedChat.bubbleMessageCount) || 30,
  bubbleX: Number(savedChat.bubbleX) || 7,
  bubbleY: Number(savedChat.bubbleY) || 7,
  bubbleLocked: savedChat.bubbleLocked === true,
  bubbleFollowCat: savedChat.bubbleFollowCat !== false,
  bubblePassThrough: savedChat.bubblePassThrough === true,
  messageSoundEnabled: savedChat.messageSoundEnabled !== false,
  messageSoundVolume: Number.isFinite(savedChat.messageSoundVolume) ? Number(savedChat.messageSoundVolume) : 35,
  messageSoundChoice: String(savedChat.messageSoundChoice || 'original-drop-cute').startsWith('original-') ? String(savedChat.messageSoundChoice || 'original-drop-cute') : 'original-drop-cute',
  keySoundEnabled: savedChat.keySoundEnabled !== false,
  keySoundVolume: Number.isFinite(savedChat.keySoundVolume) ? Number(savedChat.keySoundVolume) : 22,
  keySoundChoice: String(savedChat.keySoundChoice || 'original-boop-soft').startsWith('original-') ? String(savedChat.keySoundChoice || 'original-boop-soft') : 'original-boop-soft',
  gamePresets: (Array.isArray(savedChat.gamePresets) ? savedChat.gamePresets : []) as GamePreset[],
  statsDisplay: String(savedChat.statsDisplay || 'both'),
})
const selectedPresetId = ref(chatSettings.gamePresets[0]?.id || '')

function previewChatSound(id: string, volume: number, fallbackId: string) {
  const audio = new Audio(getChatSoundUrl(id, fallbackId))
  audio.volume = Math.max(0, Math.min(1, volume / 100))
  void audio.play()
}

async function saveCurrentPreset() {
  const name = window.prompt('给这套方案起个名字', selectedPresetId.value ? chatSettings.gamePresets.find(item => item.id === selectedPresetId.value)?.name : '日常使用')?.trim()
  if (!name) return
  const main = await WebviewWindow.getByLabel(WINDOW_LABEL.MAIN)
  const bubble = await WebviewWindow.getByLabel(WINDOW_LABEL.BUBBLE)
  const [catPosition, bubblePosition, bubbleSize] = await Promise.all([main?.outerPosition(), bubble?.outerPosition(), bubble?.outerSize()])
  const existing = chatSettings.gamePresets.find(item => item.id === selectedPresetId.value)
  const preset: GamePreset = {
    id: existing?.id || crypto.randomUUID(),
    name,
    showRemoteCat: chatSettings.showRemoteCat,
    catScale: catStore.window.scale,
    catX: catPosition?.x || 0,
    catY: catPosition?.y || 0,
    bubbleWidth: bubbleSize?.width || chatSettings.bubbleWidth,
    bubbleHeight: bubbleSize?.height || chatSettings.bubbleHeight,
    bubbleX: bubblePosition?.x || chatSettings.bubbleX,
    bubbleY: bubblePosition?.y || chatSettings.bubbleY,
    bubbleScale: chatSettings.bubbleScale,
    bubbleMessageCount: chatSettings.bubbleMessageCount,
    catPassThrough: catStore.window.passThrough,
    bubblePassThrough: chatSettings.bubblePassThrough,
    alwaysOnTop: catStore.window.alwaysOnTop,
    showBubble: true,
    fps: catStore.model.maxFPS || 60,
  }
  if (existing) Object.assign(existing, preset); else chatSettings.gamePresets.push(preset)
  selectedPresetId.value = preset.id
}

async function applyPreset(id = selectedPresetId.value) {
  const preset = chatSettings.gamePresets.find(item => item.id === id)
  if (!preset) return
  chatSettings.showRemoteCat = preset.showRemoteCat !== false
  catStore.window.scale = preset.catScale
  catStore.window.passThrough = preset.catPassThrough
  catStore.window.alwaysOnTop = preset.alwaysOnTop
  catStore.model.maxFPS = preset.fps
  Object.assign(chatSettings, {
    bubbleWidth: preset.bubbleWidth,
    bubbleHeight: preset.bubbleHeight,
    bubbleX: preset.bubbleX,
    bubbleY: preset.bubbleY,
    bubbleScale: preset.bubbleScale,
    bubbleMessageCount: preset.bubbleMessageCount,
    bubblePassThrough: preset.bubblePassThrough,
  })
  const main = await WebviewWindow.getByLabel(WINDOW_LABEL.MAIN)
  const bubble = await WebviewWindow.getByLabel(WINDOW_LABEL.BUBBLE)
  await main?.setPosition(new PhysicalPosition(preset.catX, preset.catY))
  await bubble?.setPosition(new PhysicalPosition(preset.bubbleX, preset.bubbleY))
  await bubble?.setSize(new PhysicalSize(preset.bubbleWidth, preset.bubbleHeight))
  if (preset.showBubble) await bubble?.show(); else await bubble?.hide()
}

function deletePreset() {
  const index = chatSettings.gamePresets.findIndex(item => item.id === selectedPresetId.value)
  if (index < 0) return
  chatSettings.gamePresets.splice(index, 1)
  selectedPresetId.value = chatSettings.gamePresets[0]?.id || ''
}
watch(chatSettings, (value) => {
  localStorage.setItem(settingsKey, JSON.stringify({ ...savedChat, ...value }))
  emit(LISTEN_KEY.CHAT_SETTINGS_CHANGED, value)
}, { deep: true })
</script>

<template>
  <ProList title="猫咪显示">
    <ProListItem
      description="窗口只显示对方的操作，模型外观沿用原来的猫咪设置。"
      title="显示对方的猫咪"
    >
      <Switch v-model:checked="chatSettings.showRemoteCat" />
    </ProListItem>
  </ProList>

  <ProList title="气泡显示">
    <ProListItem title="聊天气泡大小">
      <InputNumber
        v-model:value="chatSettings.bubbleScale"
        addon-after="%"
        class="w-28"
        :max="200"
        :min="60"
      />
    </ProListItem>
    <ProListItem
      description="直接拖动聊天框顶部把手移动；拖动右下角蓝色标记自由拉伸。"
      title="聊天框位置与大小"
    />
    <ProListItem
      description="独立气泡窗口最多保留多少条，可使用滚轮平滑回看。"
      title="气泡保留条数"
    >
      <InputNumber
        v-model:value="chatSettings.bubbleMessageCount"
        addon-after="条"
        class="w-28"
        :max="30"
        :min="1"
      />
    </ProListItem>
    <ProListItem
      description="锁定后不能在猫咪窗口里误拖动气泡。"
      title="锁定气泡位置"
    >
      <Switch v-model:checked="chatSettings.bubbleLocked" />
    </ProListItem>
    <ProListItem
      description="开启后，猫咪窗口缩放时气泡会按相同比例缩放；关闭后气泡保持独立大小。"
      title="气泡跟随猫咪缩放"
    >
      <Switch v-model:checked="chatSettings.bubbleFollowCat" />
    </ProListItem>
    <ProListItem
      description="开启后鼠标点击会穿过气泡；需要移动或缩放时请先在设置中关闭。"
      title="气泡窗口穿透"
    >
      <Switch v-model:checked="chatSettings.bubblePassThrough" />
    </ProListItem>
    <ProListItem title="气泡水平位置">
      <InputNumber
        v-model:value="chatSettings.bubbleX"
        addon-after="px"
        class="w-28"
        :min="0"
      />
    </ProListItem>
    <ProListItem title="气泡垂直位置">
      <InputNumber
        v-model:value="chatSettings.bubbleY"
        addon-after="px"
        class="w-28"
        :min="0"
      />
    </ProListItem>
  </ProList>

  <ProList title="输入统计">
    <ProListItem title="底部输入统计">
      <Select
        v-model:value="chatSettings.statsDisplay"
        class="w-36"
      >
        <Select.Option value="today">
          仅今日
        </Select.Option>
        <Select.Option value="total">
          仅总计
        </Select.Option>
        <Select.Option value="both">
          今日和总计
        </Select.Option>
        <Select.Option value="none">
          都不显示
        </Select.Option>
      </Select>
    </ProListItem>
  </ProList>

  <ProList title="消息提醒">
    <ProListItem
      description="对方每次敲击键盘时播放已选定的短促啵声。"
      title="对方敲击啵声"
    >
      <Switch v-model:checked="chatSettings.keySoundEnabled" />
    </ProListItem>
    <ProListItem
      description="两个视频里的音效均已拆分，可逐个试听。"
      title="敲击音效"
    >
      <Flex gap="small">
        <Select
          v-model:value="chatSettings.keySoundChoice"
          class="w-64"
        >
          <Select.Option
            v-for="sound in CHAT_SOUND_OPTIONS"
            :key="sound.id"
            :value="sound.id"
          >
            {{ sound.label }}
          </Select.Option>
        </Select>
        <Button @click="previewChatSound(chatSettings.keySoundChoice, chatSettings.keySoundVolume, 'original-boop-soft')">
          试听
        </Button>
      </Flex>
    </ProListItem>
    <ProListItem
      description="连续打字时建议保持较低音量。"
      title="敲击啵声音量"
    >
      <div class="w-52">
        <Slider
          v-model:value="chatSettings.keySoundVolume"
          :max="100"
          :min="0"
        />
      </div>
    </ProListItem>
    <ProListItem
      description="收到对方文字、图片、文件或语音时播放已选定的 Drop 002。"
      title="新消息Q弹提示音"
    >
      <Switch v-model:checked="chatSettings.messageSoundEnabled" />
    </ProListItem>
    <ProListItem
      description="可与敲击音选择相同或不同的声音。"
      title="新消息音效"
    >
      <Flex gap="small">
        <Select
          v-model:value="chatSettings.messageSoundChoice"
          class="w-64"
        >
          <Select.Option
            v-for="sound in CHAT_SOUND_OPTIONS"
            :key="sound.id"
            :value="sound.id"
          >
            {{ sound.label }}
          </Select.Option>
        </Select>
        <Button @click="previewChatSound(chatSettings.messageSoundChoice, chatSettings.messageSoundVolume, 'original-drop-cute')">
          试听
        </Button>
      </Flex>
    </ProListItem>
    <ProListItem title="新消息提示音量">
      <div class="w-52">
        <Slider
          v-model:value="chatSettings.messageSoundVolume"
          :max="100"
          :min="0"
        />
      </div>
    </ProListItem>
  </ProList>

  <ProList title="布局预设">
    <ProListItem
      description="先把猫咪和气泡调到满意的位置与大小，再保存为日常或游戏方案。"
      title="我的显示方案"
      vertical
    >
      <Flex
        gap="small"
        wrap="wrap"
      >
        <Select
          v-model:value="selectedPresetId"
          class="min-w-48"
          placeholder="选择已保存方案"
        >
          <Select.Option
            v-for="preset in chatSettings.gamePresets"
            :key="preset.id"
            :value="preset.id"
          >
            {{ preset.name }}
          </Select.Option>
        </Select>
        <Button
          type="primary"
          @click="saveCurrentPreset"
        >
          保存当前布局
        </Button>
        <Button
          :disabled="!selectedPresetId"
          @click="applyPreset()"
        >
          立即应用
        </Button>
        <Button
          danger
          :disabled="!selectedPresetId"
          @click="deletePreset"
        >
          删除
        </Button>
      </Flex>
    </ProListItem>
  </ProList>

  <ProList :title="$t('pages.preference.cat.labels.modelSettings')">
    <ProListItem
      :description="$t('pages.preference.cat.hints.mirrorMode')"
      :title="$t('pages.preference.cat.labels.mirrorMode')"
    >
      <Switch v-model:checked="catStore.model.mirror" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.mouseMirror')"
      :title="$t('pages.preference.cat.labels.mouseMirror')"
    >
      <Switch v-model:checked="catStore.model.mouseMirror" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.ignoreMouse')"
      :title="$t('pages.preference.cat.labels.ignoreMouse')"
    >
      <Switch v-model:checked="catStore.model.ignoreMouse" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.motionSound')"
      :title="$t('pages.preference.cat.labels.motionSound')"
    >
      <Switch v-model:checked="catStore.model.motionSound" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.behavior')"
      :title="$t('pages.preference.cat.labels.behavior')"
    >
      <Switch v-model:checked="catStore.model.behavior" />
    </ProListItem>

    <ProListItem
      v-if="isWindows"
      :description="$t('pages.preference.cat.hints.autoReleaseDelay')"
      :title="$t('pages.preference.cat.labels.autoReleaseDelay')"
    >
      <InputNumber
        v-model:value="catStore.model.autoReleaseDelay"
        addon-after="s"
        class="w-28"
      />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.maxFPS')"
      :title="$t('pages.preference.cat.labels.maxFPS')"
    >
      <InputNumber
        v-model:value="catStore.model.maxFPS"
        class="w-20"
        :min="0"
      />
    </ProListItem>
  </ProList>

  <ProList :title="$t('pages.preference.cat.labels.windowSettings')">
    <ProListItem
      :description="$t('pages.preference.cat.hints.passThrough')"
      :title="$t('pages.preference.cat.labels.passThrough')"
    >
      <Switch v-model:checked="catStore.window.passThrough" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.alwaysOnTop')"
      :title="$t('pages.preference.cat.labels.alwaysOnTop')"
    >
      <Switch v-model:checked="catStore.window.alwaysOnTop" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.hideOnHover')"
      :title="$t('pages.preference.cat.labels.hideOnHover')"
    >
      <Flex align="center">
        <Switch v-model:checked="catStore.window.hideOnHover" />

        <Flex
          align="center"
          class="overflow-hidden transition-all"
          :class="[catStore.window.hideOnHover ? 'w-28 opacity-100' : 'w-0 opacity-0']"
        >
          <Divider type="vertical" />

          <InputNumber
            v-model:value="catStore.window.hideOnHoverDelay"
            addon-after="s"
            class="w-24"
            :min="0"
          />
        </Flex>
      </Flex>
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.keepInScreen')"
      :title="$t('pages.preference.cat.labels.keepInScreen')"
    >
      <Switch v-model:checked="catStore.window.keepInScreen" />
    </ProListItem>

    <ProListItem
      :description="$t('pages.preference.cat.hints.windowSize')"
      :title="$t('pages.preference.cat.labels.windowSize')"
    >
      <InputNumber
        v-model:value="catStore.window.scale"
        addon-after="%"
        class="w-28"
        :max="500"
        :min="1"
      />
    </ProListItem>

    <ProListItem :title="$t('pages.preference.cat.labels.windowRadius')">
      <InputNumber
        v-model:value="catStore.window.radius"
        addon-after="%"
        class="w-28"
        :min="0"
      />
    </ProListItem>

    <ProListItem
      :title="$t('pages.preference.cat.labels.opacity')"
      vertical
    >
      <Slider
        v-model:value="catStore.window.opacity"
        class="m-[0]!"
        :max="100"
        :min="10"
        :tip-formatter="(value) => `${value}%`"
      />
    </ProListItem>
  </ProList>
</template>
