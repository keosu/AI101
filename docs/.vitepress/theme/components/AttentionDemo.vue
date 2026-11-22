<script setup lang="ts">
import { ref, computed, watch } from 'vue'

type Sentence = { label: string; toks: string[]; focus: number; special: Record<number, Record<number, number>> }
// special:手工设计的若干行(查询词序号 -> {被关注词序号: 原始权重}),没写到的词给一点点权重,最后归一化
const SENTENCES: Sentence[] = [
  {
    label: '小猫没有跳上桌子,因为它太累了',
    toks: ['小猫', '没有', '跳上', '桌子', ',', '因为', '它', '太', '累', '了'],
    focus: 6,
    special: {
      6: { 0: 0.48, 8: 0.22, 6: 0.08, 3: 0.05, 7: 0.04 },
      8: { 0: 0.35, 6: 0.25, 7: 0.15, 8: 0.12 },
      2: { 0: 0.3, 3: 0.35, 2: 0.15 }
    }
  },
  {
    label: '小猫没有跳上桌子,因为它太高了',
    toks: ['小猫', '没有', '跳上', '桌子', ',', '因为', '它', '太', '高', '了'],
    focus: 6,
    special: {
      6: { 3: 0.46, 8: 0.24, 6: 0.08, 0: 0.06, 7: 0.04 },
      8: { 3: 0.38, 6: 0.25, 7: 0.15, 8: 0.12 },
      2: { 0: 0.3, 3: 0.35, 2: 0.15 }
    }
  },
  {
    label: '小明把苹果给了小红,因为她饿了',
    toks: ['小明', '把', '苹果', '给', '了', '小红', ',', '因为', '她', '饿', '了'],
    focus: 8,
    special: {
      8: { 5: 0.46, 9: 0.22, 8: 0.08, 0: 0.05, 2: 0.03 },
      9: { 5: 0.32, 8: 0.28, 9: 0.12, 2: 0.06 },
      3: { 0: 0.25, 2: 0.25, 5: 0.25, 3: 0.1 }
    }
  }
]

// 生成整张注意力矩阵:特殊行用手写权重,其余行是"自己 + 邻近词"型
function buildMatrix(s: Sentence): number[][] {
  return s.toks.map((_, i) => {
    const sp = s.special[i]
    const raw = s.toks.map((__, j) =>
      sp ? (sp[j] ?? 0.02) : (j === i ? 2.2 : Math.exp(-Math.abs(i - j) * 1.1) * 1.6) + 0.08
    )
    const sum = raw.reduce((a, b) => a + b, 0)
    return raw.map((x) => x / sum)
  })
}
const MATS = SENTENCES.map(buildMatrix)

const si = ref(0)
const sent = computed(() => SENTENCES[si.value])
const mat = computed(() => MATS[si.value])
const N = computed(() => sent.value.toks.length)
const selQ = ref(SENTENCES[0].focus)
const hoverQ = ref<number | null>(null)
const q = computed(() => hoverQ.value ?? selQ.value)
const row = computed(() => mat.value[q.value] || [])
const rowMax = computed(() => Math.max(...row.value))
const showHeat = ref(false)
watch(si, () => { selQ.value = sent.value.focus; hoverQ.value = null })
function onEnter(e: PointerEvent, i: number) {
  if (e.pointerType === 'mouse') hoverQ.value = i
}

const topList = computed(() =>
  row.value
    .map((w, j) => ({ j, w }))
    .filter((o) => o.j !== q.value)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
)

// ---------- SVG 布局 ----------
const STEP = 64, BOX = 56, TOP = 112, BH = 38
const svgW = computed(() => N.value * STEP + 16)
const cx = (i: number) => 8 + i * STEP + STEP / 2
const arcs = computed(() =>
  row.value
    .map((w, j) => ({ j, w }))
    .filter((o) => o.j !== q.value && o.w >= 0.03)
    .map(({ j, w }) => {
      const x1 = cx(q.value), x2 = cx(j)
      const h = Math.min(100, 18 + Math.abs(x1 - x2) * 0.32)
      return {
        j,
        d: `M ${x1} ${TOP - 2} Q ${(x1 + x2) / 2} ${TOP - 2 - h * 2} ${x2} ${TOP - 2}`,
        width: 1 + w * 14,
        opacity: Math.min(0.95, 0.2 + w * 1.6)
      }
    })
)
const boxOpacity = (w: number) => (rowMax.value ? (w / rowMax.value) * 0.85 : 0)
const heatMax = computed(() => Math.max(...mat.value.flat()))
const pct = (w: number) => Math.round(w * 100) + '%'
</script>

<template>
  <div class="demo">
    <div class="demo-title">注意力:每个词在"看"谁?</div>
    <p class="demo-desc">点击(或把鼠标移到)句子里的任意一个词,看看它最"关注"句子里的哪些词——颜色越深、连线越粗,关注度越高。</p>

    <div class="demo-controls">
      <label>
        句子
        <select v-model.number="si">
          <option v-for="(s, k) in SENTENCES" :key="k" :value="k">{{ s.label }}</option>
        </select>
      </label>
      <button class="btn" :class="{ ghost: !showHeat }" @click="showHeat = !showHeat">
        {{ showHeat ? '隐藏完整热力图' : '显示完整热力图' }}
      </button>
    </div>

    <div class="svg-wrap">
      <svg :viewBox="`0 0 ${svgW} ${TOP + BH + 30}`" :style="{ maxWidth: svgW + 'px' }" class="att">
        <path
          v-for="a in arcs"
          :key="'a' + a.j"
          :d="a.d"
          class="arc"
          :stroke-width="a.width"
          :stroke-opacity="a.opacity"
        />
        <g
          v-for="(t, i) in sent.toks"
          :key="si + '-' + i"
          class="tokg"
          @pointerenter="onEnter($event, i)"
          @pointerleave="hoverQ = null"
          @click="selQ = i"
        >
          <rect :x="cx(i) - BOX / 2" :y="TOP" :width="BOX" :height="BH" rx="7" class="box-bg" />
          <rect
            :x="cx(i) - BOX / 2"
            :y="TOP"
            :width="BOX"
            :height="BH"
            rx="7"
            class="box-fill"
            :fill-opacity="boxOpacity(row[i])"
          />
          <rect
            v-if="i === q"
            :x="cx(i) - BOX / 2 - 3"
            :y="TOP - 3"
            :width="BOX + 6"
            :height="BH + 6"
            rx="9"
            class="box-q"
          />
          <text
            :x="cx(i)"
            :y="TOP + BH / 2 + 1"
            class="tok-text"
            :class="{ light: boxOpacity(row[i]) > 0.55 }"
          >{{ t }}</text>
          <text :x="cx(i)" :y="TOP + BH + 18" class="pct-text">{{ pct(row[i]) }}</text>
        </g>
      </svg>
    </div>

    <div class="demo-stat">
      查询词「<b>{{ sent.toks[q] }}</b>」最关注:
      <span v-for="(o, k) in topList" :key="o.j">{{ k ? '、' : '' }}<b>{{ sent.toks[o.j] }}</b> {{ pct(o.w) }}</span>
      (这一行所有百分比加起来是 100%)
    </div>

    <div v-if="showHeat" class="heat-wrap">
      <table class="heat">
        <thead>
          <tr>
            <th class="corner">查询 ↓ / 被关注 →</th>
            <th v-for="(t, j) in sent.toks" :key="j">{{ t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in mat" :key="i" :class="{ cur: i === q }" @click="selQ = i">
            <th>{{ sent.toks[i] }}</th>
            <td v-for="(w, j) in r" :key="j" :title="`${sent.toks[i]} → ${sent.toks[j]}:${pct(w)}`">
              <span class="cell-bg" :style="{ opacity: (w / heatMax) * 0.9 }"></span>
              <span class="cell-num" :class="{ light: w / heatMax > 0.55 }">{{ Math.round(w * 100) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="demo-stat">每一行是一个查询词,格子里的数字是百分比;点击某一行可以把它设为查询词。</div>
    </div>

    <p class="demo-note">
      💡 观察:前两句只差一个字("累"和"高"),"它"关注的对象就从"小猫"变成了"桌子"——模型正是靠这种"回头看上下文"的能力弄清代词指的是谁。
      诚实说明:这里的权重是为了讲解<b>手工设计</b>的示意,不是真实模型的输出。真实模型里有几十上百个"注意力头",
      各自关注不同的关系:有的看语法搭配,有的看指代,有的只看相邻的词。
    </p>
  </div>
</template>

<style scoped>
.svg-wrap {
  overflow-x: auto;
  margin: 6px 0;
}
.att {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
}
.arc {
  fill: none;
  stroke: var(--demo-accent);
  stroke-linecap: round;
  transition: stroke-width 0.2s;
}
.tokg {
  cursor: pointer;
}
.box-bg {
  fill: var(--demo-canvas-bg);
  stroke: var(--demo-border);
}
.box-fill {
  fill: var(--demo-accent);
  transition: fill-opacity 0.2s;
}
.box-q {
  fill: none;
  stroke: var(--vp-c-text-1);
  stroke-width: 2;
  stroke-dasharray: 4 3;
}
.tok-text {
  fill: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: middle;
}
.tok-text.light {
  fill: #fff;
}
.pct-text {
  fill: var(--vp-c-text-2);
  font-size: 12px;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.heat-wrap {
  overflow-x: auto;
  margin-top: 10px;
}
.heat {
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 0;
  display: table;
}
.heat th,
.heat td {
  border: 1px solid var(--demo-border);
  padding: 0;
  text-align: center;
  min-width: 38px;
  height: 30px;
}
.heat th {
  background: var(--demo-canvas-bg);
  color: var(--vp-c-text-1);
  padding: 0 4px;
  font-weight: 600;
}
.heat th.corner {
  font-size: 11px;
  color: var(--demo-muted);
  font-weight: 400;
  white-space: nowrap;
}
.heat tbody tr {
  cursor: pointer;
}
.heat tbody tr.cur th {
  color: var(--demo-accent);
  outline: 2px solid var(--demo-accent);
  outline-offset: -2px;
}
.heat td {
  position: relative;
  background: var(--demo-canvas-bg);
}
.cell-bg {
  position: absolute;
  inset: 0;
  background: var(--demo-accent);
}
.cell-num {
  position: relative;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.cell-num.light {
  color: #fff;
  font-weight: 600;
}
</style>
