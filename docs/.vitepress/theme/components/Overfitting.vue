<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

type P = { x: number; y: number }

const W = 560
const H = 340
const PAD = 20
const XR = 1.08
const YMIN = -1.6
const YMAX = 1.6
const NOISE = 0.15

// 隐藏的真实规律(读者看不到,除非勾选)
const truth = (x: number) => 0.8 * Math.sin(3 * x) + 0.3 * x * x - 0.1

// 固定种子的随机数,保证服务端/客户端生成一致
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(r: () => number) {
  let u = 0
  while (u === 0) u = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}
function genPts(r: () => number, n: number): P[] {
  return Array.from({ length: n }, () => {
    const x = r() * 2 - 1
    return { x, y: truth(x) + NOISE * gauss(r) }
  })
}

let seed = 1
const train = ref<P[]>([])
const test = ref<P[]>([])
const degree = ref(3)
const drawMode = ref(false)
const showTruth = ref(false)
const cv = ref<HTMLCanvasElement | null>(null)
let observer: MutationObserver | null = null

function regenerate() {
  const r = mulberry32(seed++ * 9973 + 7)
  train.value = genPts(r, 12)
  test.value = genPts(r, 12)
  drawMode.value = false
}
regenerate()

function startDrawing() {
  train.value = []
  drawMode.value = true
}

// 勒让德多项式 P_0..P_d(在 [-1,1] 上数值稳定)
function legendre(x: number, d: number): number[] {
  const p = [1]
  if (d >= 1) p.push(x)
  for (let n = 1; n < d; n++) p.push(((2 * n + 1) * x * p[n] - n * p[n - 1]) / (n + 1))
  return p
}

// 最小二乘:解 (ΦᵀΦ + λI) c = Φᵀy,高斯消元(部分主元)
function fit(pts: P[], d: number): number[] | null {
  if (!pts.length) return null
  const m = d + 1
  const A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0))
  for (const p of pts) {
    const phi = legendre(p.x, d)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) A[i][j] += phi[i] * phi[j]
      A[i][m] += phi[i] * p.y
    }
  }
  for (let i = 0; i < m; i++) A[i][i] += 1e-8
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    ;[A[c], A[piv]] = [A[piv], A[c]]
    const v = A[c][c]
    if (Math.abs(v) < 1e-300) continue
    for (let r = c + 1; r < m; r++) {
      const k = A[r][c] / v
      if (k === 0) continue
      for (let j = c; j <= m; j++) A[r][j] -= k * A[c][j]
    }
  }
  const coef = new Array<number>(m).fill(0)
  for (let i = m - 1; i >= 0; i--) {
    let s = A[i][m]
    for (let k = i + 1; k < m; k++) s -= A[i][k] * coef[k]
    coef[i] = Math.abs(A[i][i]) < 1e-300 ? 0 : s / A[i][i]
  }
  return coef
}

const predict = (c: number[], x: number) => legendre(x, c.length - 1).reduce((s, v, i) => s + v * c[i], 0)
const mse = (c: number[], pts: P[]) =>
  pts.length ? pts.reduce((s, p) => s + (predict(c, p.x) - p.y) ** 2, 0) / pts.length : 0

const coef = computed(() => fit(train.value, degree.value))
const trainMSE = computed(() => (coef.value ? mse(coef.value, train.value) : NaN))
const testMSE = computed(() => (coef.value ? mse(coef.value, test.value) : NaN))

const fmt = (v: number) => (isNaN(v) ? '—' : v >= 1000 ? v.toExponential(1) : v.toFixed(3))

const verdict = computed(() => {
  if (!coef.value) return { text: '先在画布上点几个训练点吧。', color: 'var(--demo-muted)' }
  const tr = trainMSE.value
  const te = testMSE.value
  if (tr > 0.08 && te > 0.08)
    return { text: '欠拟合:曲线太"僵硬",连平时作业都没做好(训练误差和测试误差都高)。', color: 'var(--demo-bad)' }
  if (te > 0.08 && te > 2 * tr)
    return { text: '过拟合:平时作业几乎满分,期末考却考砸了——它把噪声也死记硬背了下来。', color: 'var(--demo-bad)' }
  return { text: '恰到好处:训练误差和测试误差都比较低,学到了真正的规律。', color: 'var(--demo-good)' }
})

const toPx = (x: number) => PAD + ((x + XR) / (2 * XR)) * (W - 2 * PAD)
const toPy = (y: number) => H - PAD - ((y - YMIN) / (YMAX - YMIN)) * (H - 2 * PAD)
const clampPy = (py: number) => Math.max(-50, Math.min(H + 50, py))

function drawCurve(ctx: CanvasRenderingContext2D, fn: (x: number) => number) {
  ctx.beginPath()
  for (let i = 0; i <= 400; i++) {
    const x = -1 + (2 * i) / 400
    const py = clampPy(toPy(fn(x)))
    i === 0 ? ctx.moveTo(toPx(x), py) : ctx.lineTo(toPx(x), py)
  }
  ctx.stroke()
}

function draw() {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')!
  const fg = getComputedStyle(c).color
  ctx.clearRect(0, 0, W, H)

  // 坐标轴
  ctx.strokeStyle = fg
  ctx.globalAlpha = 0.25
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, toPy(0))
  ctx.lineTo(W - PAD, toPy(0))
  ctx.moveTo(toPx(0), PAD)
  ctx.lineTo(toPx(0), H - PAD)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  ctx.clip()

  if (showTruth.value) {
    ctx.setLineDash([6, 5])
    ctx.strokeStyle = fg
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.5
    drawCurve(ctx, truth)
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const cf = coef.value
  if (cf) {
    // 测试点到拟合曲线的误差竖线
    ctx.strokeStyle = 'rgba(245,158,11,0.45)'
    ctx.lineWidth = 1
    for (const p of test.value) {
      ctx.beginPath()
      ctx.moveTo(toPx(p.x), toPy(p.y))
      ctx.lineTo(toPx(p.x), clampPy(toPy(predict(cf, p.x))))
      ctx.stroke()
    }
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 2.5
    drawCurve(ctx, (x) => predict(cf, x))
  }
  ctx.restore()

  // 测试点:空心琥珀色
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2
  for (const p of test.value) {
    ctx.beginPath()
    ctx.arc(toPx(p.x), toPy(p.y), 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  // 训练点:实心靛蓝
  ctx.fillStyle = '#6366f1'
  for (const p of train.value) {
    ctx.beginPath()
    ctx.arc(toPx(p.x), toPy(p.y), 5, 0, Math.PI * 2)
    ctx.fill()
  }

  if (drawMode.value && !train.value.length) {
    ctx.fillStyle = fg
    ctx.globalAlpha = 0.6
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('点击画布添加训练点', W / 2, 28)
    ctx.globalAlpha = 1
  }
}

function onPointerDown(e: PointerEvent) {
  const c = cv.value
  if (!c || !drawMode.value) return
  const r = c.getBoundingClientRect()
  const px = ((e.clientX - r.left) * c.width) / r.width
  const py = ((e.clientY - r.top) * c.height) / r.height
  const x = -XR + ((px - PAD) / (W - 2 * PAD)) * 2 * XR
  const y = YMIN + ((H - PAD - py) / (H - 2 * PAD)) * (YMAX - YMIN)
  if (Math.abs(x) > 1 || train.value.length >= 40) return
  train.value.push({ x, y: Math.max(YMIN, Math.min(YMAX, y)) })
}

watch([train, test, degree, showTruth, drawMode], draw, { deep: true })

onMounted(() => {
  draw()
  observer = new MutationObserver(draw)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="demo">
    <div class="demo-title">拟合与过拟合:平时作业 vs 期末考</div>
    <p class="demo-desc">拖动"多项式次数"滑块,看绿色曲线如何用训练点学规律,再看它在测试点上考得怎么样。</p>
    <div class="demo-controls">
      <label>
        多项式次数
        <input v-model.number="degree" type="range" min="1" max="12" step="1" />
        <b>{{ degree }}</b>
      </label>
      <button class="btn ghost" @click="regenerate">重新生成数据</button>
      <button class="btn ghost" @click="startDrawing">清空训练点,自己点画</button>
      <label><input v-model="showTruth" type="checkbox" /> 显示隐藏规律</label>
    </div>
    <div class="demo-controls">
      <span class="demo-stat">
        <span class="dot" style="background: #6366f1"></span> 训练集 = 平时作业(用来学)
      </span>
      <span class="demo-stat">
        <span class="dot ring"></span> 测试集 = 期末考(从没见过,用来检验)
      </span>
    </div>
    <canvas
      ref="cv"
      :width="W"
      :height="H"
      :style="{ cursor: drawMode ? 'crosshair' : 'default' }"
      @pointerdown="onPointerDown"
    />
    <div class="demo-controls">
      <span class="demo-stat">训练误差 MSE <b>{{ fmt(trainMSE) }}</b></span>
      <span class="demo-stat">测试误差 MSE <b>{{ fmt(testMSE) }}</b></span>
      <span class="demo-stat"><b :style="{ color: verdict.color }">{{ verdict.text }}</b></span>
    </div>
    <p v-if="drawMode" class="demo-note">
      自画模式:测试点仍按隐藏规律生成。你画的训练点越偏离这条规律,学出来的曲线期末考就越难考好。
    </p>
    <p class="demo-note">
      观察:次数 1~2 时曲线太简单,两种误差都高(欠拟合);3~6 次左右两者都低;次数调到 10 以上,曲线几乎穿过每个训练点,训练误差接近 0,测试误差却猛涨——这就是过拟合:把数据里的偶然噪声当成了规律。
    </p>
  </div>
</template>

<style scoped>
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  vertical-align: -1px;
  margin-right: 2px;
}
.dot.ring {
  border: 2px solid #f59e0b;
  width: 8px;
  height: 8px;
}
</style>
