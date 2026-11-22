<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'

type Cand = [string, number]
type Table = Record<string, Cand[]>
const END = '<结束>'
const MAX_STEPS = 40

// 键可以是一个或多个"已生成序列"(token 用 | 连接),值是下一个 token 的候选与概率
function T(entries: [string | string[], Cand[]][]): Table {
  const t: Table = {}
  for (const [k, v] of entries) for (const kk of Array.isArray(k) ? k : [k]) t[kk] = v
  return t
}

// 为讲解手写的小概率表(不是真实模型的输出)
const PROMPTS: { text: string; table: Table }[] = [
  {
    text: '请用一句话介绍猫。',
    table: T([
      ['', [['猫', 0.6], ['猫咪', 0.28], ['小猫', 0.1], [END, 0.02]]],
      ['猫', [['是', 0.83], ['有', 0.15], [END, 0.02]]],
      ['猫咪', [['是', 0.86], ['有', 0.12], [END, 0.02]]],
      ['小猫', [['是', 0.76], ['有', 0.22], [END, 0.02]]],
      ['是', [['一种', 0.64], ['人类', 0.25], ['很', 0.1], [END, 0.01]]],
      ['是|一种', [['可爱', 0.4], ['独立', 0.3], ['温顺', 0.2], ['聪明', 0.08], [END, 0.02]]],
      ['是|很', [['可爱', 0.5], ['独立', 0.3], ['聪明', 0.2]]],
      [['可爱', '独立'], [['的', 0.85], ['又', 0.12], [END, 0.03]]],
      [['温顺', '聪明'], [['的', 0.9], ['又', 0.07], [END, 0.03]]],
      ['可爱|又', [['独立', 0.5], ['聪明', 0.3], ['温顺', 0.2]]],
      ['独立|又', [['可爱', 0.6], ['聪明', 0.25], ['温顺', 0.15]]],
      ['温顺|又', [['可爱', 0.5], ['聪明', 0.3], ['独立', 0.2]]],
      ['聪明|又', [['可爱', 0.5], ['独立', 0.3], ['温顺', 0.2]]],
      ['的', [['小型', 0.45], ['宠物', 0.3], ['哺乳动物', 0.2], [END, 0.05]]],
      ['小型', [['哺乳动物', 0.6], ['宠物', 0.25], ['猫科动物', 0.15]]],
      ['是|人类', [['的', 0.6], ['喜爱的', 0.3], ['最好的', 0.1]]],
      ['人类|的', [['好朋友', 0.6], ['伙伴', 0.3], ['宠物', 0.1]]],
      ['喜爱的', [['宠物', 0.6], ['动物', 0.3], ['伙伴', 0.1]]],
      ['最好的', [['朋友', 0.7], ['伙伴', 0.28], [END, 0.02]]],
      [['哺乳动物', '宠物', '猫科动物', '好朋友', '伙伴', '动物', '朋友'], [['。', 0.62], [',', 0.32], [END, 0.06]]],
      ['有', [['柔软的', 0.5], ['锋利的', 0.3], ['灵敏的', 0.2]]],
      ['柔软的', [['毛', 0.7], ['身体', 0.2], ['肉垫', 0.1]]],
      ['锋利的', [['爪子', 0.78], ['牙齿', 0.2], [END, 0.02]]],
      ['灵敏的', [['耳朵', 0.5], ['鼻子', 0.3], ['胡须', 0.2]]],
      [['毛', '身体', '肉垫', '爪子', '牙齿', '耳朵', '鼻子', '胡须'], [['。', 0.55], [',', 0.4], [END, 0.05]]],
      [',', [['喜欢', 0.5], ['擅长', 0.3], ['常常', 0.2]]],
      ['喜欢', [['睡觉', 0.4], ['晒太阳', 0.35], ['抓老鼠', 0.25]]],
      ['擅长', [['抓老鼠', 0.6], ['爬树', 0.3], ['跳跃', 0.1]]],
      ['常常', [['睡觉', 0.5], ['发呆', 0.3], ['撒娇', 0.2]]],
      [['睡觉', '晒太阳', '抓老鼠', '爬树', '跳跃', '发呆', '撒娇'], [['。', 0.82], ['和', 0.13], [END, 0.05]]],
      ['和', [['睡觉', 0.35], ['晒太阳', 0.35], ['撒娇', 0.3]]],
      ['。', [[END, 0.95], ['喵', 0.05]]],
      ['喵', [['!', 0.6], ['~', 0.25], [END, 0.15]]],
      [['!', '~'], [[END, 1]]]
    ])
  },
  {
    text: '从前有一座山,山里有座庙,庙里有一个',
    table: T([
      ['', [['老和尚', 0.7], ['小和尚', 0.2], ['和尚', 0.08], [END, 0.02]]],
      ['老和尚', [['在', 0.52], ['和', 0.25], ['正在', 0.22], [END, 0.01]]],
      ['小和尚', [['在', 0.52], ['和', 0.2], ['正在', 0.27], [END, 0.01]]],
      ['和尚', [['在', 0.65], ['正在', 0.33], [END, 0.02]]],
      [['在', '正在'], [['给', 0.55], ['讲', 0.25], ['念经', 0.2]]],
      ['给', [['小和尚', 0.8], ['徒弟们', 0.2]]],
      ['给|小和尚', [['讲故事', 0.78], ['讲', 0.2], [END, 0.02]]],
      ['给|徒弟们', [['讲故事', 0.8], ['讲', 0.18], [END, 0.02]]],
      [['小和尚|在|给', '小和尚|正在|给'], [['师弟', 0.6], ['老和尚', 0.3], ['小猫', 0.1]]],
      [['给|师弟', '给|老和尚'], [['讲故事', 0.75], ['讲', 0.23], [END, 0.02]]],
      ['给|小猫', [['讲故事', 0.6], ['念经', 0.4]]],
      ['讲', [['故事', 0.6], ['经', 0.25], ['道理', 0.15]]],
      [['讲故事', '故事'], [[',', 0.6], ['。', 0.37], [END, 0.03]]],
      [['讲故事|,', '故事|,'], [['讲的是', 0.9], [END, 0.1]]],
      ['讲的是', [['从前有座山', 0.68], ['什么呢', 0.28], [END, 0.04]]],
      ['从前有座山', [[',', 0.95], [END, 0.05]]],
      ['从前有座山|,', [['山里有座庙', 0.95], [END, 0.05]]],
      ['山里有座庙', [[',', 0.6], ['……', 0.4]]],
      ['山里有座庙|,', [['庙里有一个', 0.8], ['……', 0.2]]],
      ['庙里有一个', [['老和尚', 0.9], [END, 0.1]]],
      ['……', [[END, 1]]],
      ['什么呢', [['?', 0.95], [END, 0.05]]],
      ['?', [[END, 1]]],
      [['经', '道理'], [['。', 0.95], [END, 0.05]]],
      ['念经', [['。', 0.6], [',', 0.3], [END, 0.1]]],
      ['念经|,', [['敲着木鱼', 0.9], [END, 0.1]]],
      ['敲着木鱼', [['。', 0.9], [END, 0.1]]],
      ['老和尚|和', [['小和尚', 0.8], ['徒弟们', 0.2]]],
      ['小和尚|和', [['老和尚', 0.8], ['师兄', 0.2]]],
      ['和|小和尚', [['一起', 0.7], ['在', 0.3]]],
      ['和|老和尚', [['一起', 0.6], ['在', 0.3], [END, 0.1]]],
      [['和|徒弟们', '和|师兄'], [['一起', 0.7], ['在', 0.3]]],
      ['一起', [['念经', 0.6], ['吃饭', 0.2], ['扫地', 0.2]]],
      [['吃饭', '扫地'], [['。', 0.95], [END, 0.05]]],
      ['。', [[END, 1]]]
    ])
  },
  {
    text: '中国的首都是',
    table: T([
      ['', [['北京', 0.9], ['北京市', 0.07], [END, 0.03]]],
      [['北京', '北京市'], [['。', 0.6], [',', 0.35], [END, 0.05]]],
      [',', [['它', 0.4], ['也是', 0.3], ['一座', 0.3]]],
      ['它', [['是', 0.6], ['有', 0.4]]],
      ['它|是', [['一座', 0.5], ['中国的', 0.3], ['全国的', 0.2]]],
      ['一座', [['历史悠久的', 0.6], ['现代化的', 0.3], ['美丽的', 0.1]]],
      [['历史悠久的', '现代化的', '美丽的'], [['城市', 0.5], ['古都', 0.3], ['国际大都市', 0.2]]],
      [['城市', '古都', '国际大都市'], [['。', 0.85], [',', 0.1], [END, 0.05]]],
      ['也是', [['中国的', 0.5], ['全国的', 0.3], ['一座', 0.2]]],
      [['中国的', '全国的'], [['政治中心', 0.5], ['文化中心', 0.35], ['心脏', 0.15]]],
      [['政治中心', '文化中心'], [['。', 0.5], ['和', 0.3], [',', 0.15], [END, 0.05]]],
      ['政治中心|和', [['文化中心', 0.8], ['经济中心', 0.2]]],
      ['文化中心|和', [['政治中心', 0.5], ['国际交往中心', 0.5]]],
      [['心脏', '经济中心', '国际交往中心'], [['。', 0.95], [END, 0.05]]],
      ['它|有', [['故宫', 0.5], ['长城', 0.3], ['很多名胜古迹', 0.2]]],
      [['故宫', '长城'], [['。', 0.45], ['和', 0.4], [',', 0.12], [END, 0.03]]],
      ['故宫|和', [['长城', 0.7], ['天安门', 0.3]]],
      ['长城|和', [['故宫', 0.7], ['天安门', 0.3]]],
      [['天安门', '很多名胜古迹'], [['。', 0.95], [END, 0.05]]],
      ['。', [[END, 1]]]
    ])
  }
]

// 查表:优先匹配最长的"已生成后缀",都查不到就结束
function lookup(table: Table, seq: string[]): Cand[] {
  if (!seq.length) return table[''] ?? [[END, 1]]
  for (let s = 0; s < seq.length; s++) {
    const key = seq.slice(s).join('|')
    if (table[key]) return table[key]
  }
  return [[END, 1]]
}

const pi = ref(0)
const seq = ref<{ t: string; p: number }[]>([])
const done = ref(false)
const hitMax = ref(false)
const temp = ref(1)
let timer: ReturnType<typeof setInterval> | null = null
const auto = ref(false)

// 温度:p^(1/T) 后重新归一化
const cands = computed(() => {
  const raw = lookup(PROMPTS[pi.value].table, seq.value.map((x) => x.t))
  const ws = raw.map(([, p]) => Math.pow(p, 1 / temp.value))
  const sum = ws.reduce((a, b) => a + b, 0)
  return raw.map(([t, p], i) => ({ t, raw: p, p: ws[i] / sum })).sort((a, b) => b.p - a.p)
})

function choose(t: string) {
  if (done.value) return
  const c = cands.value.find((x) => x.t === t)
  if (t === END) {
    done.value = true
  } else {
    seq.value.push({ t, p: c ? c.p : 0 })
    if (seq.value.length >= MAX_STEPS) { done.value = true; hitMax.value = true }
  }
  if (done.value) stopAuto()
}
function sampleStep() {
  const cs = cands.value
  let r = Math.random()
  for (const c of cs) {
    r -= c.p
    if (r <= 0) return choose(c.t)
  }
  choose(cs[cs.length - 1].t)
}
function greedyStep() {
  choose(cands.value[0].t)
}
function stopAuto() {
  if (timer) clearInterval(timer)
  timer = null
  auto.value = false
}
function toggleAuto() {
  if (auto.value) return stopAuto()
  if (done.value) reset()
  auto.value = true
  timer = setInterval(() => (done.value ? stopAuto() : sampleStep()), 500)
}
function reset() {
  stopAuto()
  seq.value = []
  done.value = false
  hitMax.value = false
}
watch(pi, reset)
onBeforeUnmount(stopAuto)

const showTok = (t: string) => (t === END ? '⏹ 结束' : t)
const tempHint = computed(() =>
  temp.value < 0.8 ? '偏保守:高概率的更突出' : temp.value > 1.2 ? '偏放飞:小概率的也有机会' : '接近原始概率'
)
</script>

<template>
  <div class="demo">
    <div class="demo-title">大模型是怎样"一个词一个词"写出句子的</div>
    <p class="demo-desc">选一个提示词,然后一步一步生成:每一步模型都会给所有候选 token 打分,你可以按概率抽、选最高的,或者直接点某个候选。</p>

    <div class="demo-controls">
      <span class="lbl">提示词:</span>
      <button
        v-for="(p, k) in PROMPTS"
        :key="k"
        class="btn"
        :class="{ ghost: pi !== k }"
        @click="pi = k"
      >{{ p.text }}</button>
    </div>

    <div class="screen">
      <span class="prompt">{{ PROMPTS[pi].text }}</span>
      <span
        v-for="(x, i) in seq"
        :key="i"
        class="tok"
        :title="`选中时的概率:${(x.p * 100).toFixed(1)}%`"
      >{{ x.t }}<sub>{{ Math.round(x.p * 100) }}%</sub></span>
      <span v-if="!done" class="cursor">▍</span>
      <span v-else class="end-tag">{{ hitMax ? '(到长度上限,强制停止)' : '⏹ 结束' }}</span>
    </div>

    <div class="demo-controls">
      <button class="btn" :disabled="done" @click="sampleStep">🎲 按概率抽样一步</button>
      <button class="btn" :disabled="done" @click="greedyStep">⬆️ 选概率最高的一步</button>
      <button class="btn ghost" @click="toggleAuto">{{ auto ? '⏸ 暂停' : '▶ 自动生成' }}</button>
      <button class="btn ghost" @click="reset">重置</button>
      <span class="demo-stat">已生成 <b>{{ seq.length }}</b> 步</span>
    </div>
    <div class="demo-controls">
      <label>
        温度 {{ temp.toFixed(1) }}
        <input v-model.number="temp" type="range" min="0.2" max="2" step="0.1" />
      </label>
      <span class="demo-stat">{{ tempHint }}</span>
    </div>

    <div class="cand-title">{{ done ? '生成已结束,点"重置"再来一次' : '下一个 token 的候选(点击直接选它):' }}</div>
    <div class="bars" :class="{ off: done }">
      <button
        v-for="c in cands"
        :key="c.t"
        class="row"
        :class="{ end: c.t === END }"
        :disabled="done"
        @click="choose(c.t)"
      >
        <span class="w">{{ showTok(c.t) }}</span>
        <span class="track"><span class="fill" :style="{ width: c.p * 100 + '%' }"></span></span>
        <span class="pct">{{ (c.p * 100).toFixed(1) }}%</span>
        <span v-if="temp !== 1" class="raw">原始 {{ (c.raw * 100).toFixed(0) }}%</span>
      </button>
    </div>

    <p class="demo-note">
      💡 大模型每次只做一件事:给所有可能的下一个 token 打分(变成概率),选出一个接上去,再重复。你看到的整段回答,
      就是这样一个 token 一个 token"蹦"出来的。温度调高,小概率的词更容易被抽中——更有创意,也更容易跑偏;
      总选概率最高的会更稳,但也更死板、每次都一样。试试第二个提示词,看看会不会陷入"讲故事"的无限循环!
      说明:这里的概率表是为讲解手写的,真实模型的词表有几万到十几万个 token,概率由神经网络实时算出来。
    </p>
  </div>
</template>

<style scoped>
.lbl {
  color: var(--vp-c-text-2);
}
.screen {
  margin: 10px 0;
  padding: 12px 14px;
  min-height: 60px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background: var(--demo-canvas-bg);
  line-height: 2.2;
  font-size: 16px;
}
.prompt {
  color: var(--demo-muted);
  margin-right: 4px;
}
.tok {
  display: inline-block;
  margin: 0 2px;
  padding: 0 6px;
  line-height: 1.6;
  border-radius: 6px;
  border: 1px solid var(--demo-accent);
  color: var(--vp-c-text-1);
  animation: pop 0.25s ease;
}
.tok sub {
  font-size: 10px;
  margin-left: 2px;
  color: var(--demo-muted);
}
.cursor {
  color: var(--demo-accent);
  animation: blink 1s steps(1) infinite;
}
.end-tag {
  margin-left: 6px;
  font-size: 13px;
  color: var(--demo-muted);
}
.cand-title {
  margin-top: 8px;
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0;
}
.bars.off {
  opacity: 0.45;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 560px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  font: inherit;
  color: var(--vp-c-text-1);
  cursor: pointer;
  text-align: left;
}
.row:not(:disabled):hover {
  border-color: var(--demo-accent);
}
.row:disabled {
  cursor: default;
}
.w {
  width: 110px;
  flex-shrink: 0;
  font-weight: 600;
}
.row.end .w {
  color: var(--demo-muted);
}
.track {
  flex: 1;
  height: 14px;
  border-radius: 7px;
  background: var(--demo-border);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--demo-accent);
  transition: width 0.3s;
}
.row.end .fill {
  background: var(--demo-muted);
}
.pct {
  width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.raw {
  width: 64px;
  font-size: 12px;
  color: var(--demo-muted);
  font-variant-numeric: tabular-nums;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
