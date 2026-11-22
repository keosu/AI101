<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const PAD = 168 // 画板尺寸
const S = 14 // 模型输入边长
const BOX = 10 // 数字长边缩放到的像素数
const GEN = 56 // 合成训练图的画布尺寸
const IN = S * S
const HID = 64
const OUT = 10
const EPOCH_N = 2000
const BATCH = 32
const MAX_EPOCH = 20
const MIN_EPOCH = 6
const TARGET_ACC = 0.98

// ---------- 共用预处理:包围盒 → 等比缩放到 10px → 按质心放进 14×14 ----------
function preprocess(gray: Float32Array, W: number, H: number): Float32Array | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (gray[y * W + x] > 0.15) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const s = BOX / Math.max(bw, bh)
  const tw = Math.max(1, Math.round(bw * s))
  const th = Math.max(1, Math.round(bh * s))
  // 区域平均缩放
  const small = new Float32Array(tw * th)
  let mx = 0
  for (let ty = 0; ty < th; ty++) {
    const iy0 = Math.min(y1, Math.floor(y0 + ty / s))
    const iy1 = Math.min(y1 + 1, Math.max(iy0 + 1, Math.ceil(y0 + (ty + 1) / s)))
    for (let tx = 0; tx < tw; tx++) {
      const ix0 = Math.min(x1, Math.floor(x0 + tx / s))
      const ix1 = Math.min(x1 + 1, Math.max(ix0 + 1, Math.ceil(x0 + (tx + 1) / s)))
      let sum = 0
      for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) sum += gray[y * W + x]
      const v = sum / ((iy1 - iy0) * (ix1 - ix0))
      small[ty * tw + tx] = v
      if (v > mx) mx = v
    }
  }
  if (mx <= 0) return null
  // 质心
  let m = 0, cx = 0, cy = 0
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      const v = (small[ty * tw + tx] /= mx)
      m += v
      cx += v * (tx + 0.5)
      cy += v * (ty + 0.5)
    }
  const ox = Math.round(S / 2 - cx / m)
  const oy = Math.round(S / 2 - cy / m)
  const out = new Float32Array(IN)
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      const X = tx + ox, Y = ty + oy
      if (X >= 0 && X < S && Y >= 0 && Y < S) out[Y * S + X] = small[ty * tw + tx]
    }
  return out
}

// ---------- 合成训练数据 ----------
const FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Arial, Helvetica, sans-serif',
  'Georgia, serif',
  '"Courier New", Courier, monospace',
  '"Comic Sans MS", "Comic Sans", sans-serif',
  '"Trebuchet MS", sans-serif',
  'Verdana, sans-serif',
  '"Times New Roman", Times, serif',
  'Tahoma, sans-serif',
  '"Segoe UI", Roboto, sans-serif'
]
const WEIGHTS = ['normal', 'bold']

// 模拟手写笔画模板:坐标在 [0,1] 方框内,[x0,y0,x1,y1,...]
function ellipse(n: number): number[] {
  const p: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2
    p.push(0.5 + 0.42 * Math.cos(t), 0.5 + 0.5 * Math.sin(t))
  }
  return p
}
const STROKES: number[][][][] = [
  [[ellipse(20)]],
  [[[0.5, 0, 0.5, 1]], [[0.25, 0.22, 0.55, 0, 0.55, 1]], [[0.3, 0.2, 0.55, 0, 0.55, 1], [0.3, 1, 0.8, 1]]],
  [[[0.12, 0.25, 0.3, 0.03, 0.65, 0, 0.88, 0.22, 0.8, 0.48, 0.1, 1, 0.95, 1]]],
  [[[0.1, 0.1, 0.5, 0, 0.85, 0.15, 0.8, 0.38, 0.4, 0.5, 0.85, 0.62, 0.9, 0.85, 0.5, 1, 0.1, 0.9]]],
  [[[0.7, 1, 0.7, 0, 0.05, 0.68, 0.95, 0.68]], [[0.15, 0, 0.08, 0.6, 0.92, 0.6], [0.72, 0.25, 0.72, 1]]],
  [[[0.2, 0.02, 0.15, 0.45, 0.5, 0.38, 0.85, 0.55, 0.85, 0.85, 0.5, 1, 0.1, 0.9], [0.2, 0.02, 0.85, 0.02]]],
  [[[0.75, 0, 0.35, 0.25, 0.12, 0.65, 0.25, 0.95, 0.6, 1, 0.88, 0.78, 0.7, 0.5, 0.35, 0.5, 0.15, 0.7]]],
  [[[0.05, 0, 0.95, 0, 0.4, 1]], [[0.05, 0, 0.95, 0, 0.4, 1], [0.3, 0.5, 0.8, 0.5]]],
  [[[0.5, 0.5, 0.15, 0.3, 0.2, 0.05, 0.5, 0, 0.8, 0.05, 0.85, 0.3, 0.5, 0.5, 0.12, 0.72, 0.2, 0.95, 0.5, 1, 0.8, 0.95, 0.88, 0.72, 0.5, 0.5]]],
  [
    [[0.85, 0.3, 0.6, 0.5, 0.25, 0.45, 0.12, 0.22, 0.35, 0, 0.7, 0.02, 0.85, 0.3, 0.82, 0.7, 0.6, 1]],
    [[0.85, 0.25, 0.6, 0.48, 0.25, 0.45, 0.12, 0.22, 0.35, 0, 0.7, 0.02, 0.85, 0.25, 0.85, 1]]
  ]
]
const STRAIGHT = [1, 4, 7] // 这些数字用直线段,不做平滑

function rnd(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function drawStrokeDigit(c: CanvasRenderingContext2D, d: number) {
  const vars = STROKES[d]
  const polys = vars[Math.floor(Math.random() * vars.length)]
  const w = 22, h = 34
  c.lineWidth = rnd(3, 6.5)
  for (const poly of polys) {
    const pts: number[] = []
    for (let i = 0; i < poly.length; i += 2)
      pts.push((poly[i] - 0.5 + rnd(-0.06, 0.06)) * w, (poly[i + 1] - 0.5 + rnd(-0.05, 0.05)) * h)
    const n = pts.length / 2
    c.beginPath()
    c.moveTo(pts[0], pts[1])
    if (STRAIGHT.includes(d) || n < 3) {
      for (let i = 1; i < n; i++) c.lineTo(pts[i * 2], pts[i * 2 + 1])
    } else {
      // 经过中点的二次曲线,让笔画圆滑
      for (let i = 1; i < n - 1; i++) {
        const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2
        const my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2
        c.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my)
      }
      c.lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
    }
    c.stroke()
  }
}

// ---------- 小型 MLP:196 → 64(ReLU) → 10(softmax) ----------
const W1 = new Float32Array(HID * IN), b1 = new Float32Array(HID)
const W2 = new Float32Array(OUT * HID), b2 = new Float32Array(OUT)
const vW1 = new Float32Array(HID * IN), vb1 = new Float32Array(HID)
const vW2 = new Float32Array(OUT * HID), vb2 = new Float32Array(OUT)
const gW1 = new Float32Array(HID * IN), gb1 = new Float32Array(HID)
const gW2 = new Float32Array(OUT * HID), gb2 = new Float32Array(OUT)
const hBuf = new Float32Array(HID), pBuf = new Float32Array(OUT), dz = new Float32Array(OUT)

function randn() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random())
}
function initNet() {
  const s1 = Math.sqrt(2 / IN), s2 = Math.sqrt(2 / HID)
  for (let i = 0; i < W1.length; i++) W1[i] = randn() * s1
  for (let i = 0; i < W2.length; i++) W2[i] = randn() * s2
  for (const a of [b1, b2, vW1, vb1, vW2, vb2]) a.fill(0)
}

function forward(x: Float32Array, xo: number) {
  for (let j = 0; j < HID; j++) {
    let s = b1[j]
    const o = j * IN
    for (let i = 0; i < IN; i++) s += W1[o + i] * x[xo + i]
    hBuf[j] = s > 0 ? s : 0
  }
  let mx = -Infinity
  for (let k = 0; k < OUT; k++) {
    let s = b2[k]
    const o = k * HID
    for (let j = 0; j < HID; j++) s += W2[o + j] * hBuf[j]
    pBuf[k] = s
    if (s > mx) mx = s
  }
  let z = 0
  for (let k = 0; k < OUT; k++) z += pBuf[k] = Math.exp(pBuf[k] - mx)
  for (let k = 0; k < OUT; k++) pBuf[k] /= z
}

const X = new Float32Array(EPOCH_N * IN)
const Y = new Uint8Array(EPOCH_N)
const order = new Int32Array(EPOCH_N)

// 训练一个小批量(带动量的 SGD),返回损失和与正确数
function trainBatch(from: number, to: number, lr: number) {
  gW1.fill(0); gb1.fill(0); gW2.fill(0); gb2.fill(0)
  let loss = 0, correct = 0
  for (let n = from; n < to; n++) {
    const id = order[n]
    const xo = id * IN
    const y = Y[id]
    forward(X, xo)
    loss -= Math.log(pBuf[y] + 1e-9)
    let best = 0
    for (let k = 1; k < OUT; k++) if (pBuf[k] > pBuf[best]) best = k
    if (best === y) correct++
    for (let k = 0; k < OUT; k++) {
      dz[k] = pBuf[k] - (k === y ? 1 : 0)
      gb2[k] += dz[k]
      const o = k * HID
      for (let j = 0; j < HID; j++) gW2[o + j] += dz[k] * hBuf[j]
    }
    for (let j = 0; j < HID; j++) {
      if (hBuf[j] <= 0) continue
      let dh = 0
      for (let k = 0; k < OUT; k++) dh += W2[k * HID + j] * dz[k]
      gb1[j] += dh
      const o = j * IN
      for (let i = 0; i < IN; i++) {
        const xv = X[xo + i]
        if (xv !== 0) gW1[o + i] += dh * xv
      }
    }
  }
  const sc = lr / (to - from), mom = 0.9
  for (let i = 0; i < W1.length; i++) W1[i] += vW1[i] = mom * vW1[i] - sc * gW1[i]
  for (let i = 0; i < HID; i++) b1[i] += vb1[i] = mom * vb1[i] - sc * gb1[i]
  for (let i = 0; i < W2.length; i++) W2[i] += vW2[i] = mom * vW2[i] - sc * gW2[i]
  for (let i = 0; i < OUT; i++) b2[i] += vb2[i] = mom * vb2[i] - sc * gb2[i]
  return { loss, correct }
}

// ---------- 状态 ----------
const padCv = ref<HTMLCanvasElement | null>(null)
const seeCv = ref<HTMLCanvasElement | null>(null)
const training = ref(false)
const trained = ref(false)
const epoch = ref(0)
const progress = ref(0)
const acc = ref(0)
const loss = ref(0)
const probs = ref<number[] | null>(null)
const hasInk = ref(false)

const best = computed(() => {
  if (!probs.value) return -1
  let b = 0
  probs.value.forEach((p, i) => {
    if (p > probs.value![b]) b = i
  })
  return b
})

let padCtx: CanvasRenderingContext2D | null = null
let genCtx: CanvasRenderingContext2D | null = null
let genGray = new Float32Array(GEN * GEN)
let raf = 0

// 合成一张数字 d 的训练图(字体或模拟笔画 + 随机仿射增广 + 噪声)
function synth(d: number): Float32Array | null {
  const c = genCtx!
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.fillStyle = '#000'
  c.fillRect(0, 0, GEN, GEN)
  c.translate(GEN / 2 + rnd(-2, 2), GEN / 2 + rnd(-2, 2))
  c.rotate((rnd(-12, 12) * Math.PI) / 180)
  c.transform(1, 0, rnd(-0.2, 0.2), 1, 0, 0)
  c.scale(rnd(0.8, 1.15), rnd(0.8, 1.15))
  c.fillStyle = '#fff'
  c.strokeStyle = '#fff'
  c.lineCap = 'round'
  c.lineJoin = 'round'
  if (Math.random() < 0.55) {
    const fam = FONTS[Math.floor(Math.random() * FONTS.length)]
    const wt = WEIGHTS[Math.floor(Math.random() * WEIGHTS.length)]
    c.font = `${wt} 36px ${fam}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(d), 0, 0)
    const lw = rnd(0, 4)
    if (lw > 1) {
      c.lineWidth = lw
      c.strokeText(String(d), 0, 0)
    }
  } else {
    drawStrokeDigit(c, d)
  }
  const data = c.getImageData(0, 0, GEN, GEN).data
  for (let i = 0; i < GEN * GEN; i++) genGray[i] = data[i * 4] / 255
  const v = preprocess(genGray, GEN, GEN)
  if (!v) return null
  for (let i = 0; i < IN; i++) {
    let t = v[i] + rnd(-0.04, 0.04)
    if (Math.random() < 0.03) t += rnd(0, 0.4)
    v[i] = t < 0 ? 0 : t > 1 ? 1 : t
  }
  return v
}

// 分帧训练:每帧最多占用约 12ms,其余时间让给页面
let genCount = 0, batchPos = 0, epLoss = 0, epCorrect = 0, epSeen = 0
function tick() {
  const t0 = performance.now()
  while (performance.now() - t0 < 12) {
    if (genCount < EPOCH_N) {
      const d = genCount % 10
      const v = synth(d)
      if (!v) continue
      X.set(v, genCount * IN)
      Y[genCount] = d
      genCount++
    } else if (batchPos < EPOCH_N) {
      if (batchPos === 0) {
        for (let i = 0; i < EPOCH_N; i++) order[i] = i
        for (let i = EPOCH_N - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const t = order[i]; order[i] = order[j]; order[j] = t
        }
      }
      const end = Math.min(EPOCH_N, batchPos + BATCH)
      const r = trainBatch(batchPos, end, 0.08 * Math.pow(0.88, epoch.value))
      epLoss += r.loss
      epCorrect += r.correct
      epSeen += end - batchPos
      batchPos = end
    } else {
      epoch.value++
      acc.value = epCorrect / epSeen
      loss.value = epLoss / epSeen
      if (epoch.value >= MAX_EPOCH || (epoch.value >= MIN_EPOCH && acc.value >= TARGET_ACC)) {
        finishTraining()
        return
      }
      genCount = batchPos = epLoss = epCorrect = epSeen = 0
    }
  }
  if (epSeen > 0) {
    acc.value = epCorrect / epSeen
    loss.value = epLoss / epSeen
  }
  progress.value = Math.min(1, (epoch.value + (genCount + batchPos) / (2 * EPOCH_N)) / MAX_EPOCH)
  raf = requestAnimationFrame(tick)
}

function startTraining() {
  if (training.value) return
  if (!genCtx) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = GEN
    genCtx = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D
  }
  initNet()
  trained.value = false
  probs.value = null
  training.value = true
  epoch.value = 0
  progress.value = 0
  acc.value = 0
  loss.value = 0
  genCount = batchPos = epLoss = epCorrect = epSeen = 0
  raf = requestAnimationFrame(tick)
}

function finishTraining() {
  training.value = false
  trained.value = true
  progress.value = 1
  raf = 0
  if (hasInk.value) recognize()
}

// ---------- 画板 ----------
function resetPad() {
  if (!padCtx) return
  padCtx.fillStyle = '#000'
  padCtx.fillRect(0, 0, PAD, PAD)
}
function clearPad() {
  resetPad()
  hasInk.value = false
  probs.value = null
  drawSeen(null)
}

let drawing = false, lastX = 0, lastY = 0
function toCanvas(e: PointerEvent) {
  const cv = padCv.value!
  const r = cv.getBoundingClientRect()
  return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]
}
function onDown(e: PointerEvent) {
  if (!padCtx) return
  drawing = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  ;[lastX, lastY] = toCanvas(e)
  padCtx.fillStyle = '#fff'
  padCtx.beginPath()
  padCtx.arc(lastX, lastY, 7, 0, Math.PI * 2)
  padCtx.fill()
  hasInk.value = true
}
function onMove(e: PointerEvent) {
  if (!drawing || !padCtx) return
  const [x, y] = toCanvas(e)
  padCtx.strokeStyle = '#fff'
  padCtx.lineWidth = 14
  padCtx.lineCap = 'round'
  padCtx.lineJoin = 'round'
  padCtx.beginPath()
  padCtx.moveTo(lastX, lastY)
  padCtx.lineTo(x, y)
  padCtx.stroke()
  lastX = x
  lastY = y
}
function onUp() {
  if (!drawing) return
  drawing = false
  recognize()
}

// 把模型"看到"的 14×14 图放大显示
function drawSeen(v: Float32Array | null) {
  const cv = seeCv.value
  if (!cv) return
  const c = cv.getContext('2d')!
  const cell = cv.width / S
  c.fillStyle = '#000'
  c.fillRect(0, 0, cv.width, cv.height)
  if (v)
    for (let i = 0; i < IN; i++) {
      const g = Math.round(v[i] * 255)
      if (!g) continue
      c.fillStyle = `rgb(${g},${g},${g})`
      c.fillRect((i % S) * cell, Math.floor(i / S) * cell, cell, cell)
    }
  c.strokeStyle = 'rgba(128,128,128,0.25)'
  c.lineWidth = 1
  c.beginPath()
  for (let i = 1; i < S; i++) {
    c.moveTo(i * cell + 0.5, 0)
    c.lineTo(i * cell + 0.5, cv.height)
    c.moveTo(0, i * cell + 0.5)
    c.lineTo(cv.width, i * cell + 0.5)
  }
  c.stroke()
}

function recognize() {
  if (!padCtx) return
  const data = padCtx.getImageData(0, 0, PAD, PAD).data
  const gray = new Float32Array(PAD * PAD)
  for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4] / 255
  const v = preprocess(gray, PAD, PAD)
  drawSeen(v)
  if (!v || !trained.value) {
    probs.value = null
    return
  }
  forward(v, 0)
  probs.value = Array.from(pBuf)
}

onMounted(() => {
  const cv = padCv.value
  if (cv) padCtx = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D
  resetPad()
  drawSeen(null)
})
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">手写数字识别:在浏览器里现场训练一个小神经网络</div>
    <p class="demo-desc">先点"训练模型",等进度条走完;然后在黑色画板上写一个 0~9 的数字,松开手指/鼠标就会自动识别。</p>

    <div class="demo-controls">
      <button class="btn" :disabled="training" @click="startTraining">
        {{ training ? '训练中…' : trained ? '重新训练' : '训练模型' }}
      </button>
      <span class="hint">约需几秒钟</span>
      <button class="btn ghost" @click="clearPad">清空画板</button>
    </div>

    <div v-if="training || trained" class="train-box">
      <div class="bar"><div class="bar-fill" :style="{ width: (progress * 100).toFixed(1) + '%' }"></div></div>
      <div class="demo-stat">
        {{ trained ? '训练完成' : '训练中' }}:第 <b>{{ epoch }}</b> / {{ MAX_EPOCH }} 轮 · 训练准确率
        <b>{{ (acc * 100).toFixed(1) }}%</b> · 损失 <b>{{ loss.toFixed(3) }}</b>
      </div>
    </div>

    <div class="demo-row digit-row">
      <div class="col">
        <div class="col-label">在这里写一个数字</div>
        <canvas
          ref="padCv"
          :width="PAD"
          :height="PAD"
          class="pad"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        ></canvas>
      </div>
      <div class="col">
        <div class="col-label">模型实际"看到"的 14×14</div>
        <canvas ref="seeCv" width="140" height="140"></canvas>
      </div>
      <div class="col probs">
        <div class="col-label">每个数字的概率</div>
        <div v-if="!trained" class="placeholder">{{ training ? '训练中,请稍候…' : '请先点"训练模型"' }}</div>
        <div v-else-if="!probs" class="placeholder">写一个数字试试吧</div>
        <template v-else>
          <div class="answer">
            我猜是 <b class="big">{{ best }}</b>
            <span class="demo-stat">(把握 {{ (probs[best] * 100).toFixed(1) }}%)</span>
          </div>
          <div v-for="(p, i) in probs" :key="i" class="prob-row" :class="{ top: i === best }">
            <span class="digit">{{ i }}</span>
            <div class="track"><div class="fill" :style="{ width: (p * 100).toFixed(1) + '%' }"></div></div>
            <span class="pct">{{ (p * 100).toFixed(1) }}%</span>
          </div>
        </template>
      </div>
    </div>

    <p class="demo-note">
      说实话:这是个"玩具模型",只用电脑字体和简单的模拟笔画合成的图片训练,从没见过真人笔迹,所以对你的手写体可能认不准。
      如果认错了,试试把数字写得大一点、居中、笔画粗一点。这恰好说明了"训练数据的类型决定了模型的本领"——喂给模型什么样的数据,它就学会什么样的本事;数据和实际情况差得远,结果自然打折扣(垃圾进,垃圾出)。
    </p>
  </div>
</template>

<style scoped>
.hint {
  font-size: 13px;
  color: var(--demo-muted);
}
.train-box {
  margin: 6px 0 10px;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--demo-border);
  overflow: hidden;
  margin-bottom: 4px;
}
.bar-fill {
  height: 100%;
  background: var(--demo-accent);
  transition: width 0.2s;
}
.digit-row {
  margin-top: 6px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.col-label {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.demo canvas.pad {
  background: #000;
  cursor: crosshair;
}
.probs {
  flex: 1;
  min-width: 220px;
}
.placeholder {
  color: var(--demo-muted);
  font-size: 13px;
  padding: 8px 0;
}
.answer {
  margin-bottom: 4px;
}
.answer .big {
  font-size: 26px;
  color: var(--demo-accent);
  margin: 0 4px;
}
.prob-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.digit {
  width: 14px;
  text-align: right;
  color: var(--vp-c-text-2);
}
.track {
  flex: 1;
  height: 12px;
  background: var(--demo-border);
  border-radius: 4px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--demo-muted);
  opacity: 0.6;
}
.pct {
  width: 52px;
  text-align: right;
  color: var(--demo-muted);
}
.prob-row.top .fill {
  background: var(--demo-accent);
  opacity: 1;
}
.prob-row.top .digit,
.prob-row.top .pct {
  color: var(--vp-c-text-1);
  font-weight: 700;
}
</style>
