<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

// 画布内部分辨率与坐标范围
const W = 640
const H = 320
const PAD = 32
const XMIN = -4.5
const XMAX = 4.5
const YMIN = 0
const YMAX = 8

// 损失曲线:左边谷更深(全局最小),右边谷较浅(局部最小)
const f = (x: number) => 0.05 * x ** 4 - 0.6 * x * x + 0.3 * x + 3
const df = (x: number) => 0.2 * x ** 3 - 1.2 * x + 0.3

const cv = ref<HTMLCanvasElement | null>(null)
const lr = ref(0.1)
const startX = ref(3.8)
const x = ref(3.8)
const steps = ref(0)
const running = ref(false)
const msg = ref('')
let path: number[] = [x.value]
let timer: ReturnType<typeof setInterval> | undefined
let observer: MutationObserver | null = null

const toPx = (vx: number) => PAD + ((vx - XMIN) / (XMAX - XMIN)) * (W - 2 * PAD)
const toPy = (vy: number) => H - PAD - ((vy - YMIN) / (YMAX - YMIN)) * (H - 2 * PAD)
const clampPy = (py: number) => Math.max(10, Math.min(H - PAD, py))

function draw() {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')!
  const fg = getComputedStyle(c).color
  ctx.clearRect(0, 0, W, H)

  // 坐标轴与刻度
  ctx.strokeStyle = fg
  ctx.fillStyle = fg
  ctx.globalAlpha = 0.4
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, H - PAD)
  ctx.lineTo(W - PAD, H - PAD)
  ctx.stroke()
  ctx.globalAlpha = 0.7
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  for (let t = -4; t <= 4; t++) ctx.fillText(String(t), toPx(t), H - PAD + 16)
  ctx.textAlign = 'left'
  ctx.fillText('↑ 损失(山的高度)', 6, 16)
  ctx.textAlign = 'right'
  ctx.fillText('位置 x →', W - 6, H - 6)
  ctx.globalAlpha = 1

  // 裁剪到绘图区,画"山"和曲线
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD, 0, W - 2 * PAD, H - PAD)
  ctx.clip()
  ctx.beginPath()
  for (let px = PAD; px <= W - PAD; px += 2) {
    const vx = XMIN + ((px - PAD) / (W - 2 * PAD)) * (XMAX - XMIN)
    const py = toPy(f(vx))
    px === PAD ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.lineTo(W - PAD, H - PAD)
  ctx.lineTo(PAD, H - PAD)
  ctx.closePath()
  ctx.fillStyle = 'rgba(99,102,241,0.10)'
  ctx.fill()

  // 走过的轨迹
  ctx.strokeStyle = 'rgba(245,158,11,0.75)'
  ctx.fillStyle = '#f59e0b'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  path.forEach((px, i) => {
    const X = toPx(px)
    const Y = clampPy(toPy(f(px)))
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y)
  })
  ctx.stroke()
  for (const px of path) {
    ctx.beginPath()
    ctx.arc(toPx(px), clampPy(toPy(f(px))), 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // 脚下的坡度(切线)
  const s = df(x.value)
  const y0 = f(x.value)
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = '#10b981'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(toPx(x.value - 0.7), toPy(y0 - 0.7 * s))
  ctx.lineTo(toPx(x.value + 0.7), toPy(y0 + 0.7 * s))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // 小球
  ctx.beginPath()
  ctx.arc(toPx(x.value), clampPy(toPy(y0)), 9, 0, Math.PI * 2)
  ctx.fillStyle = '#ef4444'
  ctx.fill()
  ctx.strokeStyle = fg
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function stepOnce() {
  const g = df(x.value)
  let nx = x.value - lr.value * g
  let flew = false
  if (!isFinite(nx) || nx < XMIN || nx > XMAX) {
    nx = Math.max(XMIN, Math.min(XMAX, isFinite(nx) ? nx : g > 0 ? XMIN : XMAX))
    flew = true
  }
  x.value = nx
  steps.value++
  path.push(nx)
  if (path.length > 200) path.shift()

  if (flew) {
    msg.value = '学习率太大,小球飞出去了!调小学习率,再点"重置"试试。'
    stop()
  } else if (Math.abs(df(nx)) < 1e-3) {
    msg.value = '脚下几乎是平的(斜率≈0),小球停在了一个谷底。'
    stop()
  } else if (path.length >= 4) {
    // 连续几步方向来回反转 → 震荡
    const n = path.length
    const d1 = path[n - 1] - path[n - 2]
    const d2 = path[n - 2] - path[n - 3]
    const d3 = path[n - 3] - path[n - 4]
    msg.value = d1 * d2 < 0 && d2 * d3 < 0 ? '小球在谷底两侧来回跳(震荡):步子迈得太大了。' : ''
  }
  draw()
}

function stop() {
  running.value = false
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

function toggleAuto() {
  if (running.value) return stop()
  running.value = true
  timer = setInterval(stepOnce, 150)
}

function reset() {
  stop()
  x.value = startX.value
  steps.value = 0
  path = [x.value]
  msg.value = ''
  draw()
}

// 点击画布设置起点(按显示尺寸换算回内部坐标)
function onPointerDown(e: PointerEvent) {
  const c = cv.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const px = ((e.clientX - r.left) * c.width) / r.width
  const vx = XMIN + ((px - PAD) / (W - 2 * PAD)) * (XMAX - XMIN)
  startX.value = Math.max(XMIN, Math.min(XMAX, vx))
  reset()
}

function onVisibility() {
  if (document.hidden) stop()
}

onMounted(() => {
  draw()
  document.addEventListener('visibilitychange', onVisibility)
  // 深浅主题切换时重绘
  observer = new MutationObserver(draw)
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
    <div class="demo-title">梯度下降:蒙着眼睛下山</div>
    <p class="demo-desc">
      点击画布任意位置放下小球(起点),然后"走一步"或"自动下山"。小球每一步都只看脚下的坡度(绿色虚线),朝下坡方向挪动。
    </p>
    <div class="demo-controls">
      <label>
        学习率(步子大小)
        <input v-model.number="lr" type="range" min="0.01" max="1.2" step="0.01" />
        <b>{{ lr.toFixed(2) }}</b>
      </label>
      <button class="btn ghost" :disabled="running" @click="stepOnce">走一步</button>
      <button class="btn" @click="toggleAuto">{{ running ? '暂停' : '自动下山' }}</button>
      <button class="btn ghost" @click="reset">重置</button>
    </div>
    <canvas ref="cv" :width="W" :height="H" @pointerdown="onPointerDown" />
    <div class="demo-controls">
      <span class="demo-stat">步数 <b>{{ steps }}</b></span>
      <span class="demo-stat">位置 x = <b>{{ x.toFixed(3) }}</b></span>
      <span class="demo-stat">损失 f(x) = <b>{{ f(x).toFixed(3) }}</b></span>
      <span class="demo-stat">斜率 f'(x) = <b>{{ df(x).toFixed(3) }}</b></span>
    </div>
    <p v-if="msg" class="demo-note" style="color: var(--demo-bad)">{{ msg }}</p>
    <p class="demo-note">
      观察:小球看不到整座山,只凭脚下坡度决定往哪走——每步按 x ← x − 学习率 × 斜率 更新。从右边出发,它会停在较浅的右谷(局部最小),错过更深的左谷;换个起点结果就不同。学习率太小,走得很慢;太大(约 0.8 以上),会在谷底两边来回震荡,甚至直接飞出去。
    </p>
  </div>
</template>
