<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'

type Pt = { x: number; y: number; t: number } // t=1 类 A(蓝),t=0 类 B(橙)
type Net = {
  sizes: number[]
  relu: boolean
  W: Float64Array[]
  B: Float64Array[]
  GW: Float64Array[]
  GB: Float64Array[]
  A: Float64Array[] // 各层输出
  Z: Float64Array[] // 各层加权和
  D: Float64Array[] // 各层误差项
}

const MAP = 300
const LW = 300
const LH = 90
const G = 60 // 热力图网格分辨率
const N_PER_CLASS = 100
const BATCH = 10
const EPOCHS_PER_FRAME = 5
const BLUE = [59, 130, 246]
const ORANGE = [249, 115, 22]

const FEATS = [
  { key: 'x2', label: 'x²' },
  { key: 'y2', label: 'y²' },
  { key: 'xy', label: 'x·y' },
  { key: 'sx', label: 'sin(πx)' },
  { key: 'sy', label: 'sin(πy)' }
]

const dataset = ref('circle')
const seed = ref(1)
const layers = ref(1)
const neurons = ref(4)
const act = ref('tanh')
const lr = ref(0.03)
const feat = reactive<Record<string, boolean>>({ x2: false, y2: false, xy: false, sx: false, sy: false })
const running = ref(false)
const epoch = ref(0)
const trainLoss = ref(NaN)
const testLoss = ref(NaN)
const testAcc = ref(NaN)
const msg = ref('')
const cvMap = ref<HTMLCanvasElement | null>(null)
const cvLoss = ref<HTMLCanvasElement | null>(null)

let trainPts: Pt[] = []
let testPts: Pt[] = []
let trainF: Float64Array[] = []
let testF: Float64Array[] = []
let gridF: Float64Array[] = []
let net: Net | null = null
let history: { tr: number; te: number }[] = []
let histStride = 1
let frameCount = 0
let raf = 0
let off: HTMLCanvasElement | null = null
let observer: MutationObserver | null = null

const structure = computed(() => {
  const nIn = 2 + FEATS.filter((f) => feat[f.key]).length
  const hidden = Array.from({ length: layers.value }, () => neurons.value)
  return ['输入 ' + nIn, ...hidden.map(String), '输出 1'].join(' → ')
})

// ---------- 数据 ----------
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genData(kind: string, s: number): Pt[] {
  const r = mulberry32(s * 104729 + 17)
  const g = () => {
    let u = 0
    while (u === 0) u = r()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
  }
  const pts: Pt[] = []
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < N_PER_CLASS; i++) {
      let x = 0
      let y = 0
      if (kind === 'blobs') {
        x = (c ? 0.45 : -0.45) + 0.2 * g()
        y = (c ? -0.4 : 0.4) + 0.2 * g()
      } else if (kind === 'circle') {
        const rad = c ? 0.68 + 0.27 * r() : 0.45 * Math.sqrt(r())
        const ang = 2 * Math.PI * r()
        x = rad * Math.cos(ang) + 0.02 * g()
        y = rad * Math.sin(ang) + 0.02 * g()
      } else if (kind === 'xor') {
        const sx = r() < 0.5 ? -1 : 1
        const sy = c ? -sx : sx // 类 A 在一、三象限,类 B 在二、四象限
        x = sx * (0.08 + 0.88 * r())
        y = sy * (0.08 + 0.88 * r())
      } else {
        const t = i / N_PER_CLASS
        const rad = 0.06 + 0.88 * t
        const ang = t * 3.5 * Math.PI + c * Math.PI
        x = rad * Math.cos(ang) + 0.035 * g()
        y = rad * Math.sin(ang) + 0.035 * g()
      }
      pts.push({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), t: c === 0 ? 1 : 0 })
    }
  }
  // 打乱后取 20% 作为测试集
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[pts[i], pts[j]] = [pts[j], pts[i]]
  }
  return pts
}

function featurize(x: number, y: number): Float64Array {
  const v = [x, y]
  if (feat.x2) v.push(x * x)
  if (feat.y2) v.push(y * y)
  if (feat.xy) v.push(x * y)
  if (feat.sx) v.push(Math.sin(Math.PI * x))
  if (feat.sy) v.push(Math.sin(Math.PI * y))
  return Float64Array.from(v)
}

function regenData() {
  const pts = genData(dataset.value, seed.value)
  const nTest = Math.round(pts.length * 0.2)
  testPts = pts.slice(0, nTest)
  trainPts = pts.slice(nTest)
}

function prepareFeatures() {
  trainF = trainPts.map((p) => featurize(p.x, p.y))
  testF = testPts.map((p) => featurize(p.x, p.y))
  gridF = []
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) gridF.push(featurize(-1 + ((gx + 0.5) * 2) / G, 1 - ((gy + 0.5) * 2) / G))
}

// ---------- 网络:前向 / 反向传播 ----------
function makeNet(sizes: number[], relu: boolean): Net {
  const L = sizes.length - 1
  const n: Net = { sizes, relu, W: [], B: [], GW: [], GB: [], A: [], Z: [], D: [] }
  for (let l = 0; l < L; l++) {
    const w = new Float64Array(sizes[l + 1] * sizes[l])
    const lim = Math.sqrt(6 / (sizes[l] + sizes[l + 1])) // Xavier 均匀初始化
    for (let k = 0; k < w.length; k++) w[k] = (Math.random() * 2 - 1) * lim
    n.W.push(w)
    n.B.push(new Float64Array(sizes[l + 1]))
    n.GW.push(new Float64Array(w.length))
    n.GB.push(new Float64Array(sizes[l + 1]))
  }
  for (let l = 0; l <= L; l++) {
    n.A.push(new Float64Array(sizes[l]))
    n.Z.push(new Float64Array(sizes[l]))
    n.D.push(new Float64Array(sizes[l]))
  }
  return n
}

const sigmoid = (s: number) => (s >= 0 ? 1 / (1 + Math.exp(-s)) : Math.exp(s) / (1 + Math.exp(s)))

function forward(n: Net, inp: Float64Array): number {
  const L = n.sizes.length - 1
  n.A[0].set(inp)
  for (let l = 0; l < L; l++) {
    const nin = n.sizes[l]
    const nout = n.sizes[l + 1]
    const W = n.W[l]
    const a = n.A[l]
    const z = n.Z[l + 1]
    const o = n.A[l + 1]
    for (let j = 0; j < nout; j++) {
      let s = n.B[l][j]
      const off0 = j * nin
      for (let i = 0; i < nin; i++) s += W[off0 + i] * a[i]
      z[j] = s
      o[j] = l === L - 1 ? sigmoid(s) : n.relu ? Math.max(0, s) : Math.tanh(s)
    }
  }
  return n.A[L][0]
}

// 交叉熵 + sigmoid 时,输出层误差恰好是 p - t;再逐层向后传
function backward(n: Net, t: number) {
  const L = n.sizes.length - 1
  n.D[L][0] = n.A[L][0] - t
  for (let l = L - 1; l >= 0; l--) {
    const nin = n.sizes[l]
    const nout = n.sizes[l + 1]
    const W = n.W[l]
    const GW = n.GW[l]
    const a = n.A[l]
    const d = n.D[l + 1]
    for (let j = 0; j < nout; j++) {
      n.GB[l][j] += d[j]
      const off0 = j * nin
      for (let i = 0; i < nin; i++) GW[off0 + i] += d[j] * a[i]
    }
    if (l > 0) {
      const dp = n.D[l]
      const zp = n.Z[l]
      for (let i = 0; i < nin; i++) {
        let s = 0
        for (let j = 0; j < nout; j++) s += W[j * nin + i] * d[j]
        dp[i] = s * (n.relu ? (zp[i] > 0 ? 1 : 0) : 1 - a[i] * a[i])
      }
    }
  }
}

// 一个 epoch:打乱训练集,按小批量做梯度下降
function trainEpoch() {
  if (!net) return
  const n = net
  const idx = trainPts.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  for (let s = 0; s < idx.length; s += BATCH) {
    n.GW.forEach((g) => g.fill(0))
    n.GB.forEach((g) => g.fill(0))
    const end = Math.min(idx.length, s + BATCH)
    for (let k = s; k < end; k++) {
      forward(n, trainF[idx[k]])
      backward(n, trainPts[idx[k]].t)
    }
    const step = lr.value / (end - s)
    for (let l = 0; l < n.W.length; l++) {
      const W = n.W[l]
      const GW = n.GW[l]
      for (let k = 0; k < W.length; k++) W[k] -= step * GW[k]
      const B = n.B[l]
      const GB = n.GB[l]
      for (let k = 0; k < B.length; k++) B[k] -= step * GB[k]
    }
  }
  epoch.value++
}

function evaluate(F: Float64Array[], pts: Pt[]) {
  let loss = 0
  let right = 0
  for (let i = 0; i < pts.length; i++) {
    const p = Math.min(1 - 1e-7, Math.max(1e-7, forward(net!, F[i])))
    const t = pts[i].t
    loss -= t * Math.log(p) + (1 - t) * Math.log(1 - p)
    if ((p > 0.5 ? 1 : 0) === t) right++
  }
  return { loss: loss / pts.length, acc: right / pts.length }
}

function updateStats(record: boolean) {
  if (!net) return
  const tr = evaluate(trainF, trainPts)
  const te = evaluate(testF, testPts)
  trainLoss.value = tr.loss
  testLoss.value = te.loss
  testAcc.value = te.acc
  if (record && frameCount++ % histStride === 0) {
    history.push({ tr: tr.loss, te: te.loss })
    // 记录太多时抽稀一半,保持曲线点数有限
    if (history.length > 300) {
      history = history.filter((_, i) => i % 2 === 0)
      histStride *= 2
    }
  }
}

// ---------- 绘图 ----------
function render() {
  const c = cvMap.value
  if (!c || !net || !off) return
  const ctx = c.getContext('2d')!
  const fg = getComputedStyle(c).color
  const octx = off.getContext('2d')!
  const img = octx.createImageData(G, G)
  const d = img.data
  for (let k = 0; k < G * G; k++) {
    const p = forward(net, gridF[k])
    const col = p > 0.5 ? BLUE : ORANGE
    d[k * 4] = col[0]
    d[k * 4 + 1] = col[1]
    d[k * 4 + 2] = col[2]
    d[k * 4 + 3] = Math.round(25 + 175 * Math.abs(2 * p - 1))
  }
  octx.putImageData(img, 0, 0)
  ctx.clearRect(0, 0, MAP, MAP)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(off, 0, 0, MAP, MAP)

  ctx.strokeStyle = fg
  ctx.globalAlpha = 0.2
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MAP / 2, 0)
  ctx.lineTo(MAP / 2, MAP)
  ctx.moveTo(0, MAP / 2)
  ctx.lineTo(MAP, MAP / 2)
  ctx.stroke()
  ctx.globalAlpha = 1

  const toX = (x: number) => ((x + 1) / 2) * MAP
  const toY = (y: number) => ((1 - y) / 2) * MAP
  const color = (t: number) => (t ? '#3b82f6' : '#f97316')
  // 训练点:实心
  ctx.lineWidth = 1
  for (const p of trainPts) {
    ctx.beginPath()
    ctx.arc(toX(p.x), toY(p.y), 3.5, 0, Math.PI * 2)
    ctx.fillStyle = color(p.t)
    ctx.fill()
    ctx.strokeStyle = fg
    ctx.stroke()
  }
  // 测试点:空心圈
  for (const p of testPts) {
    ctx.beginPath()
    ctx.arc(toX(p.x), toY(p.y), 4.5, 0, Math.PI * 2)
    ctx.strokeStyle = fg
    ctx.lineWidth = 3.5
    ctx.stroke()
    ctx.strokeStyle = color(p.t)
    ctx.lineWidth = 2
    ctx.stroke()
  }
  renderLoss()
}

function renderLoss() {
  const c = cvLoss.value
  if (!c) return
  const ctx = c.getContext('2d')!
  const fg = getComputedStyle(c).color
  ctx.clearRect(0, 0, LW, LH)
  ctx.fillStyle = fg
  ctx.globalAlpha = 0.7
  ctx.font = '11px sans-serif'
  ctx.fillText('损失随训练变化', 6, 13)
  ctx.globalAlpha = 1
  if (history.length < 2) return
  let ymax = 0.1
  for (const h of history) ymax = Math.max(ymax, isFinite(h.tr) ? h.tr : 0, isFinite(h.te) ? h.te : 0)
  ctx.globalAlpha = 0.7
  ctx.textAlign = 'right'
  ctx.fillText(ymax.toFixed(2), LW - 4, 13)
  ctx.textAlign = 'left'
  ctx.globalAlpha = 1
  const top = 18
  const bottom = LH - 6
  const line = (key: 'tr' | 'te', col: string) => {
    ctx.beginPath()
    history.forEach((h, i) => {
      const X = 4 + (i / (history.length - 1)) * (LW - 8)
      const Y = bottom - (Math.min(h[key], ymax) / ymax) * (bottom - top)
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y)
    })
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    ctx.stroke()
  }
  line('tr', '#6366f1')
  line('te', '#f59e0b')
}

// ---------- 控制 ----------
function resetNet() {
  if (!trainF.length) return
  const sizes = [trainF[0].length, ...Array.from({ length: layers.value }, () => neurons.value), 1]
  net = makeNet(sizes, act.value === 'relu')
  epoch.value = 0
  history = []
  histStride = 1
  frameCount = 0
  msg.value = ''
  updateStats(true)
  render()
}

function frame() {
  raf = 0
  if (!running.value) return
  for (let k = 0; k < EPOCHS_PER_FRAME; k++) trainEpoch()
  updateStats(true)
  render()
  if (!isFinite(trainLoss.value)) {
    msg.value = '训练发散了(损失变成无穷大):学习率太大,请调小后点"重置权重"。'
    running.value = false
    return
  }
  raf = requestAnimationFrame(frame)
}

function toggle() {
  running.value = !running.value
  if (running.value && !raf) raf = requestAnimationFrame(frame)
}

function stop() {
  running.value = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function stepOnce() {
  trainEpoch()
  updateStats(true)
  render()
}

function onVisibility() {
  if (document.hidden) stop()
}

const fmt = (v: number, k = 3) => (isFinite(v) ? v.toFixed(k) : '—')
const accText = computed(() => (isFinite(testAcc.value) ? (testAcc.value * 100).toFixed(1) + '%' : '—'))

watch([dataset, seed], () => {
  regenData()
  prepareFeatures()
  resetNet()
})
watch([layers, neurons, act], resetNet)
watch(feat, () => {
  prepareFeatures()
  resetNet()
})

onMounted(() => {
  off = document.createElement('canvas')
  off.width = G
  off.height = G
  regenData()
  prepareFeatures()
  resetNet()
  document.addEventListener('visibilitychange', onVisibility)
  observer = new MutationObserver(render)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  stop()
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">神经网络游乐场:在浏览器里真的训练一个小网络</div>
    <p class="demo-desc">
      选数据集和网络结构,点"训练",看网络如何一点点学会把蓝点和橙点分开。背景颜色就是网络的判断(蓝=类 A,橙=类 B)。
    </p>
    <div class="demo-controls">
      <label>
        数据集
        <select v-model="dataset">
          <option value="blobs">两团(直线可分)</option>
          <option value="circle">圆环(内圈 vs 外圈)</option>
          <option value="xor">异或(四象限)</option>
          <option value="spiral">螺旋(两条旋臂)</option>
        </select>
      </label>
      <button class="btn ghost" @click="seed++">重新生成数据</button>
    </div>
    <div class="demo-controls">
      <label>
        隐藏层数
        <select v-model.number="layers">
          <option :value="0">0(只有一个神经元)</option>
          <option :value="1">1</option>
          <option :value="2">2</option>
        </select>
      </label>
      <label :style="{ opacity: layers === 0 ? 0.5 : 1 }">
        每层神经元
        <input v-model.number="neurons" type="range" min="1" max="8" step="1" :disabled="layers === 0" />
        <b>{{ neurons }}</b>
      </label>
      <label>
        激活函数
        <select v-model="act">
          <option value="tanh">tanh</option>
          <option value="relu">ReLU</option>
        </select>
      </label>
      <label>
        学习率
        <select v-model.number="lr">
          <option :value="0.003">0.003</option>
          <option :value="0.01">0.01</option>
          <option :value="0.03">0.03</option>
          <option :value="0.1">0.1</option>
          <option :value="0.3">0.3</option>
        </select>
      </label>
    </div>
    <div class="demo-controls">
      <span>额外输入特征(x、y 总是有):</span>
      <label v-for="f in FEATS" :key="f.key"><input v-model="feat[f.key]" type="checkbox" />{{ f.label }}</label>
    </div>
    <div class="demo-controls">
      <button class="btn" @click="toggle">{{ running ? '暂停' : '训练' }}</button>
      <button class="btn ghost" :disabled="running" @click="stepOnce">单步</button>
      <button class="btn ghost" @click="resetNet">重置权重</button>
      <span class="demo-stat">结构:<b>{{ structure }}</b></span>
    </div>
    <div class="demo-row">
      <canvas ref="cvMap" :width="MAP" :height="MAP" />
      <div style="min-width: 220px">
        <canvas ref="cvLoss" :width="LW" :height="LH" />
        <div class="demo-stat" style="font-size: 12.5px">
          <span style="color: #6366f1">━ 训练损失</span>
          <span style="color: #f59e0b; margin-left: 12px">━ 测试损失</span>
        </div>
        <div class="demo-stat">轮次(epoch) <b>{{ epoch }}</b></div>
        <div class="demo-stat">训练损失 <b>{{ fmt(trainLoss) }}</b></div>
        <div class="demo-stat">测试损失 <b>{{ fmt(testLoss) }}</b></div>
        <div class="demo-stat">
          测试准确率 <b>{{ accText }}</b>
        </div>
        <div class="demo-stat" style="font-size: 12.5px">实心点 = 训练数据,空心圈 = 测试数据</div>
      </div>
    </div>
    <p v-if="msg" class="demo-note" style="color: var(--demo-bad)">{{ msg }}</p>
    <p class="demo-note">
      试一试:先在"圆环"或"螺旋"上选 0 个隐藏层,无论训练多久,背景都只能被一条直线切成两半——一个神经元只会画直线。再加 1~2 个隐藏层、多几个神经元,边界就能弯曲、包围,真正学会这些形状。也可以只用 0 层、但勾上 x² 和 y²:人工设计好的特征,同样能让"一条直线"分开圆环。
    </p>
  </div>
</template>
