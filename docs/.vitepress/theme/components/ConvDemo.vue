<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const N = 16 // 输入边长
const M = 14 // 输出边长(valid 卷积)
const LAST = M * M - 1
const IN_CELL = 14 // 输入每格像素
const OUT_CELL = 16 // 输出每格像素

const PATTERNS = [
  { id: 'square', name: '方块' },
  { id: 'H', name: '字母 H' },
  { id: 'diag', name: '斜线' },
  { id: 'ring', name: '圆环' },
  { id: 'smile', name: '笑脸' }
]

// 生成预设图案(16×16,值 0/1)
function makePattern(p: string): number[] {
  const a: number[] = new Array(N * N).fill(0)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const d = Math.hypot(r - 7.5, c - 7.5)
      let on = false
      if (p === 'square') on = r >= 5 && r <= 10 && c >= 5 && c <= 10
      else if (p === 'H')
        on =
          (r >= 3 && r <= 12 && ((c >= 3 && c <= 4) || (c >= 11 && c <= 12))) ||
          (r >= 7 && r <= 8 && c >= 3 && c <= 12)
      else if (p === 'diag') on = r >= 2 && r <= 14 && (c === r || c === r - 1)
      else if (p === 'ring') on = d >= 3.6 && d <= 5.6
      else if (p === 'smile')
        on =
          (d >= 5.8 && d <= 7.4) ||
          (r >= 4 && r <= 5 && ((c >= 5 && c <= 6) || (c >= 9 && c <= 10))) ||
          (r >= 9 && r <= 11 && d >= 2.8 && d <= 4.3 && Math.abs(c - 7.5) <= 3.5)
      a[r * N + c] = on ? 1 : 0
    }
  }
  return a
}

const KERNELS = [
  { id: 'vert', name: '竖直边缘' },
  { id: 'horiz', name: '水平边缘' },
  { id: 'blur', name: '模糊' },
  { id: 'sharpen', name: '锐化' },
  { id: 'custom', name: '自定义(可编辑)' }
]
const PRESETS: Record<string, number[]> = {
  vert: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  horiz: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  blur: new Array(9).fill(1 / 9),
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0]
}

const pattern = ref('square')
const image = ref<number[]>(makePattern('square'))
const tool = ref<'pen' | 'eraser'>('pen')
const kernelType = ref('vert')
const kernel = ref<any[]>(PRESETS.vert.slice())
const actMode = ref<'relu' | 'abs' | 'none'>('relu')
const pos = ref(0)
const playing = ref(false)

const inCv = ref<HTMLCanvasElement | null>(null)
const outCv = ref<HTMLCanvasElement | null>(null)

watch(pattern, (p) => {
  image.value = makePattern(p)
})
watch(kernelType, (t) => {
  if (t !== 'custom') kernel.value = PRESETS[t].slice()
})

// 自定义输入框可能为空字符串,统一转成数字
const kVals = computed<number[]>(() => kernel.value.map((v) => Number(v) || 0))
const kMax = computed(() => Math.max(1e-9, ...kVals.value.map(Math.abs)))

function act(x: number): number {
  if (actMode.value === 'relu') return Math.max(0, x)
  if (actMode.value === 'abs') return Math.abs(x)
  return x
}
const actLabel = computed(() =>
  actMode.value === 'relu' ? 'ReLU 后' : actMode.value === 'abs' ? '取绝对值后' : '不处理'
)

// 完整的卷积输出(未激活)
const rawOut = computed<number[]>(() => {
  const img = image.value
  const k = kVals.value
  const out: number[] = new Array(M * M)
  for (let r = 0; r < M; r++) {
    for (let c = 0; c < M; c++) {
      let s = 0
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += img[(r + i) * N + c + j] * k[i * 3 + j]
      out[r * M + c] = s
    }
  }
  return out
})
const outVals = computed(() => rawOut.value.map(act))
const outMax = computed(() => Math.max(1e-9, ...outVals.value.map(Math.abs)))

const row = computed(() => Math.floor(pos.value / M))
const col = computed(() => pos.value % M)
const products = computed(() => {
  const list: { a: number; k: number; p: number }[] = []
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const a = image.value[(row.value + i) * N + col.value + j]
      const k = kVals.value[i * 3 + j]
      list.push({ a, k, p: a * k })
    }
  return list
})
const sum = computed(() => products.value.reduce((s, x) => s + x.p, 0))
const result = computed(() => act(sum.value))

function fmtN(x: number): string {
  const v = Math.round(x * 100) / 100
  return Object.is(v, -0) ? '0' : String(v)
}
function fmtK(v: number): string {
  if (Math.abs(v - 1 / 9) < 1e-9) return '1/9'
  return fmtN(v)
}
function kStyle(v: number) {
  const a = 0.08 + (Math.abs(v) / kMax.value) * 0.5
  const bg = v > 0 ? `rgba(99,102,241,${a})` : v < 0 ? `rgba(239,68,68,${a})` : 'transparent'
  return { background: bg }
}

// ---------- 播放控制 ----------
let timer: ReturnType<typeof setInterval> | null = null
function stopPlay() {
  if (timer) clearInterval(timer)
  timer = null
  playing.value = false
}
function togglePlay() {
  if (playing.value) return stopPlay()
  if (pos.value >= LAST) pos.value = 0
  playing.value = true
  timer = setInterval(() => {
    if (pos.value >= LAST) stopPlay()
    else pos.value++
  }, 150)
}
function finish() {
  stopPlay()
  pos.value = LAST
}
function restart() {
  stopPlay()
  pos.value = 0
}
function clearImage() {
  image.value = new Array(N * N).fill(0)
}

// ---------- 在输入图上绘制 ----------
let painting = false
function paint(e: PointerEvent) {
  const cv = inCv.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const x = ((e.clientX - r.left) * cv.width) / r.width
  const y = ((e.clientY - r.top) * cv.height) / r.height
  const c = Math.floor(x / IN_CELL)
  const rr = Math.floor(y / IN_CELL)
  if (c < 0 || c >= N || rr < 0 || rr >= N) return
  const v = tool.value === 'pen' ? 1 : 0
  if (image.value[rr * N + c] !== v) image.value[rr * N + c] = v
}
function onDown(e: PointerEvent) {
  painting = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  paint(e)
}
function onMove(e: PointerEvent) {
  if (painting) paint(e)
}
function onUp() {
  painting = false
}

// ---------- 绘制 ----------
function isDark() {
  return document.documentElement.classList.contains('dark')
}
function drawGrid(ctx: CanvasRenderingContext2D, n: number, cell: number) {
  ctx.strokeStyle = 'rgba(128,128,128,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < n; i++) {
    ctx.moveTo(i * cell + 0.5, 0)
    ctx.lineTo(i * cell + 0.5, n * cell)
    ctx.moveTo(0, i * cell + 0.5)
    ctx.lineTo(n * cell, i * cell + 0.5)
  }
  ctx.stroke()
}
function draw() {
  const a = inCv.value
  const b = outCv.value
  if (!a || !b) return
  const dark = isDark()

  // 输入图
  const ctx = a.getContext('2d')!
  const img = image.value
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const g = Math.round(img[r * N + c] * 255)
      ctx.fillStyle = `rgb(${g},${g},${g})`
      ctx.fillRect(c * IN_CELL, r * IN_CELL, IN_CELL, IN_CELL)
    }
  drawGrid(ctx, N, IN_CELL)
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 3
  ctx.strokeRect(col.value * IN_CELL + 1.5, row.value * IN_CELL + 1.5, 3 * IN_CELL - 3, 3 * IN_CELL - 3)

  // 输出特征图:已扫过的显示灰度,未扫过的显示占位
  const o = b.getContext('2d')!
  o.clearRect(0, 0, b.width, b.height)
  const vals = outVals.value
  const mx = outMax.value
  for (let i = 0; i < M * M; i++) {
    const x = (i % M) * OUT_CELL
    const y = Math.floor(i / M) * OUT_CELL
    if (i <= pos.value) {
      const v = vals[i]
      const t = actMode.value === 'none' ? 0.5 + (0.5 * v) / mx : Math.min(1, Math.abs(v) / mx)
      const g = Math.round(Math.max(0, Math.min(1, t)) * 255)
      o.fillStyle = `rgb(${g},${g},${g})`
      o.fillRect(x, y, OUT_CELL, OUT_CELL)
    } else {
      o.fillStyle = dark ? '#26262c' : '#eef1f6'
      o.fillRect(x, y, OUT_CELL, OUT_CELL)
      o.fillStyle = 'rgba(128,128,128,0.5)'
      o.fillRect(x + OUT_CELL / 2 - 1, y + OUT_CELL / 2 - 1, 2, 2)
    }
  }
  drawGrid(o, M, OUT_CELL)
  o.strokeStyle = '#f59e0b'
  o.lineWidth = 3
  o.strokeRect(col.value * OUT_CELL + 1.5, row.value * OUT_CELL + 1.5, OUT_CELL - 3, OUT_CELL - 3)
}

watch([image, kVals, pos, actMode], draw, { deep: true })

let themeObs: MutationObserver | null = null
onMounted(() => {
  draw()
  themeObs = new MutationObserver(draw)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  stopPlay()
  themeObs?.disconnect()
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">卷积:用"小放大镜"扫描图片</div>
    <p class="demo-desc">
      选一个图案(或直接在输入图上用手指/鼠标画),再选一个卷积核,点"播放"看 3×3 的小窗口一格一格滑过图片,算出右边的特征图。
    </p>

    <div class="demo-controls">
      <label
        >图案
        <select v-model="pattern">
          <option v-for="p in PATTERNS" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label><input v-model="tool" type="radio" value="pen" /> 画笔(白)</label>
      <label><input v-model="tool" type="radio" value="eraser" /> 橡皮(黑)</label>
      <button class="btn ghost" @click="clearImage">清空</button>
    </div>
    <div class="demo-controls">
      <label
        >卷积核
        <select v-model="kernelType">
          <option v-for="k in KERNELS" :key="k.id" :value="k.id">{{ k.name }}</option>
        </select>
      </label>
      <label
        >输出处理
        <select v-model="actMode">
          <option value="relu">ReLU:max(0, x)</option>
          <option value="abs">取绝对值 |x|</option>
          <option value="none">不处理(灰色 = 0)</option>
        </select>
      </label>
    </div>

    <div class="demo-row conv-row">
      <div class="panel">
        <div class="panel-label">输入图 16×16</div>
        <canvas
          ref="inCv"
          width="224"
          height="224"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        ></canvas>
      </div>
      <div class="panel">
        <div class="panel-label">卷积核 3×3</div>
        <div class="kernel">
          <template v-for="(v, i) in kernel" :key="i">
            <input
              v-if="kernelType === 'custom'"
              v-model.number="kernel[i]"
              type="number"
              step="0.5"
              class="kcell"
              :style="kStyle(kVals[i])"
            />
            <div v-else class="kcell" :style="kStyle(kVals[i])">{{ fmtK(kVals[i]) }}</div>
          </template>
        </div>
        <div class="kernel-legend">蓝色 = 正数,红色 = 负数</div>
      </div>
      <div class="panel">
        <div class="panel-label">输出特征图 14×14</div>
        <canvas ref="outCv" width="224" height="224"></canvas>
      </div>
    </div>

    <div class="demo-controls">
      <button class="btn" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
      <label
        >放大镜位置
        <input v-model.number="pos" type="range" min="0" :max="LAST" @input="stopPlay" />
        <span class="demo-stat"><b>{{ pos }}</b> / {{ LAST }}</span>
      </label>
      <button class="btn ghost" @click="finish">瞬间完成</button>
      <button class="btn ghost" @click="restart">从头开始</button>
    </div>

    <div class="calc">
      <div class="demo-stat">
        当前窗口:输出图第 <b>{{ row + 1 }}</b> 行、第 <b>{{ col + 1 }}</b> 列(橙色框)。窗口里 9 个像素 × 核里对应的数:
      </div>
      <div class="products">
        <span v-for="(p, i) in products" :key="i" class="prod">
          {{ fmtN(p.a) }}×{{ fmtK(p.k) }} = <b>{{ fmtN(p.p) }}</b>
        </span>
      </div>
      <div class="demo-stat">
        9 个乘积求和 = <b>{{ fmtN(sum) }}</b>,{{ actLabel }} = <b>{{ fmtN(result) }}</b>
      </div>
    </div>

    <p class="demo-note">
      观察:选"方块"+"竖直边缘",输出只在方块的左右两条竖边处发亮;换成"水平边缘",亮的变成上下两条横边。卷积核就像一个"特征探测器",只对某种局部图案有强烈反应。
      在真正的卷积神经网络(CNN)里,这些核里的数字不是人设计的,而是训练时自动学出来的——这就是 CNN 的第一层在做的事。
    </p>
  </div>
</template>

<style scoped>
.conv-row {
  align-items: flex-start;
  margin: 8px 0;
}
.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
.panel-label {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.kernel {
  display: grid;
  grid-template-columns: repeat(3, 56px);
  gap: 4px;
  margin-top: 40px;
}
.kcell {
  width: 56px;
  height: 44px;
  box-sizing: border-box;
  border: 1px solid var(--demo-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
  font-size: 15px;
  color: var(--vp-c-text-1);
  text-align: center;
  padding: 0 2px;
}
input.kcell {
  font-family: inherit;
}
.kernel-legend {
  font-size: 12px;
  color: var(--demo-muted);
}
.calc {
  border: 1px dashed var(--demo-border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 4px;
}
.products {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, max-content));
  gap: 2px 18px;
  margin: 6px 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
}
</style>
