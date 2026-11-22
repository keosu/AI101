<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

type Pt = { x: number; y: number; t: number } // t=1 桃子,t=0 苹果

const S = 400
const PL = 44
const PR = 14
const PT = 14
const PB = 40
const APPLE = '#ef4444'
const PEACH = '#10b981'
const LR = 1
const STEPS_PER_FRAME = 20

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 用一条随机的"真实分界线"生成线性可分的数据,并留出一点间隔
function genData(seed: number): Pt[] {
  const r = mulberry32(seed * 7919 + 13)
  const phi = ((60 + r() * 60) * Math.PI) / 180 // 法向量朝上:绒毛多的一侧是桃子
  const nx = Math.cos(phi)
  const ny = Math.sin(phi)
  const cx = 0.4 + 0.2 * r()
  const cy = 0.4 + 0.2 * r()
  const pts: Pt[] = []
  let apples = 0
  let peaches = 0
  for (let guard = 0; (apples < 20 || peaches < 20) && guard < 20000; guard++) {
    const x = 0.04 + 0.92 * r()
    const y = 0.04 + 0.92 * r()
    const d = nx * (x - cx) + ny * (y - cy)
    if (Math.abs(d) < 0.06) continue
    if (d > 0 && peaches < 20) {
      pts.push({ x, y, t: 1 })
      peaches++
    } else if (d < 0 && apples < 20) {
      pts.push({ x, y, t: 0 })
      apples++
    }
  }
  return pts
}

let seed = 1
const pts = ref<Pt[]>(genData(seed))
const w1 = ref(2)
const w2 = ref(-1)
const b = ref(0)
const training = ref(false)
const msg = ref('')
const cv = ref<HTMLCanvasElement | null>(null)
let raf = 0
let perfectFrames = 0
let frames = 0
let observer: MutationObserver | null = null

const z = (x: number, y: number) => w1.value * x + w2.value * y + b.value
const isRight = (p: Pt) => (z(p.x, p.y) > 0 ? 1 : 0) === p.t
const accuracy = computed(() => pts.value.filter(isRight).length / pts.value.length)

const toPx = (v: number) => PL + v * (S - PL - PR)
const toPy = (v: number) => S - PB - v * (S - PT - PB)
const clampW = (v: number) => Math.max(-5, Math.min(5, v))

// 把单位正方形按 z>0 裁剪出"判为桃子"的多边形
function peachPolygon(): number[][] {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const out: number[][] = []
  for (let i = 0; i < 4; i++) {
    const a = sq[i]
    const c = sq[(i + 1) % 4]
    const za = z(a[0], a[1])
    const zc = z(c[0], c[1])
    if (za > 0) out.push(a)
    if (za > 0 !== zc > 0) {
      const t = za / (za - zc)
      out.push([a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])])
    }
  }
  return out
}

function draw() {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')!
  const fg = getComputedStyle(c).color
  ctx.clearRect(0, 0, S, S)

  // 判定区域:先整块涂成苹果色,再把 z>0 的部分涂成桃子色
  ctx.fillStyle = 'rgba(239,68,68,0.13)'
  ctx.fillRect(toPx(0), toPy(1), toPx(1) - toPx(0), toPy(0) - toPy(1))
  const poly = peachPolygon()
  if (poly.length >= 3) {
    ctx.beginPath()
    poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(toPx(x), toPy(y)) : ctx.lineTo(toPx(x), toPy(y))))
    ctx.closePath()
    ctx.fillStyle = 'rgba(16,185,129,0.18)'
    ctx.fill()
  }

  // 分界线 z=0
  ctx.save()
  ctx.beginPath()
  ctx.rect(toPx(0), toPy(1), toPx(1) - toPx(0), toPy(0) - toPy(1))
  ctx.clip()
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 3
  ctx.beginPath()
  if (Math.abs(w2.value) >= Math.abs(w1.value) && w2.value !== 0) {
    const yAt = (x: number) => -(w1.value * x + b.value) / w2.value
    ctx.moveTo(toPx(-1), toPy(yAt(-1)))
    ctx.lineTo(toPx(2), toPy(yAt(2)))
  } else if (w1.value !== 0) {
    const xAt = (y: number) => -(w2.value * y + b.value) / w1.value
    ctx.moveTo(toPx(xAt(-1)), toPy(-1))
    ctx.lineTo(toPx(xAt(2)), toPy(2))
  }
  ctx.stroke()
  ctx.restore()

  // 坐标框与标签
  ctx.strokeStyle = fg
  ctx.fillStyle = fg
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  ctx.strokeRect(toPx(0), toPy(1), toPx(1) - toPx(0), toPy(0) - toPy(1))
  ctx.globalAlpha = 0.8
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  for (const v of [0, 0.5, 1]) {
    ctx.fillText(String(v), toPx(v), toPy(0) + 15)
    ctx.fillText(String(v), PL - 14, toPy(v) + 4)
  }
  ctx.fillText('重量 →', (toPx(0) + toPx(1)) / 2, S - 8)
  ctx.save()
  ctx.translate(12, (toPy(0) + toPy(1)) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('绒毛程度 →', 0, 0)
  ctx.restore()
  ctx.globalAlpha = 1

  // 数据点;分错的点画叉
  for (const p of pts.value) {
    const X = toPx(p.x)
    const Y = toPy(p.y)
    ctx.beginPath()
    ctx.arc(X, Y, 6, 0, Math.PI * 2)
    ctx.fillStyle = p.t ? PEACH : APPLE
    ctx.fill()
    if (!isRight(p)) {
      ctx.strokeStyle = fg
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(X - 9, Y - 9)
      ctx.lineTo(X + 9, Y + 9)
      ctx.moveTo(X + 9, Y - 9)
      ctx.lineTo(X - 9, Y + 9)
      ctx.stroke()
    }
  }
}

// 逻辑回归式的一小步梯度下降:把每个旋钮往"错得更少"的方向拧一点
function learnStep() {
  let g1 = 0
  let g2 = 0
  let gb = 0
  for (const p of pts.value) {
    const s = 1 / (1 + Math.exp(-z(p.x, p.y)))
    const e = s - p.t
    g1 += e * p.x
    g2 += e * p.y
    gb += e
  }
  const n = pts.value.length
  w1.value = clampW(w1.value - (LR * g1) / n)
  w2.value = clampW(w2.value - (LR * g2) / n)
  b.value = clampW(b.value - (LR * gb) / n)
}

function frame() {
  raf = 0
  if (!training.value) return
  for (let i = 0; i < STEPS_PER_FRAME; i++) learnStep()
  frames++
  perfectFrames = accuracy.value === 1 ? perfectFrames + 1 : 0
  if (perfectFrames > 40) {
    msg.value = `学会了!全部分对,一共拧了 ${frames * STEPS_PER_FRAME} 次旋钮。`
    return stopTraining()
  }
  if (frames > 1500) {
    msg.value = '已经学了很久,先停下来看看吧。'
    return stopTraining()
  }
  raf = requestAnimationFrame(frame)
}

function startTraining() {
  if (training.value) return
  training.value = true
  msg.value = '正在自动拧旋钮……'
  frames = 0
  perfectFrames = 0
  raf = requestAnimationFrame(frame)
}

function stopTraining() {
  training.value = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  if (msg.value === '正在自动拧旋钮……') msg.value = ''
}

function shuffleWeights() {
  stopTraining()
  const rnd = () => Math.round((Math.random() * 10 - 5) * 100) / 100
  w1.value = rnd()
  w2.value = rnd()
  b.value = rnd()
  msg.value = ''
}

function newData() {
  stopTraining()
  pts.value = genData(++seed)
  msg.value = ''
}

function onVisibility() {
  if (document.hidden) stopTraining()
}

watch([w1, w2, b, pts], draw)

onMounted(() => {
  draw()
  document.addEventListener('visibilitychange', onVisibility)
  observer = new MutationObserver(draw)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  stopTraining()
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">一个会"投票"的神经元:苹果还是桃子?</div>
    <p class="demo-desc">
      拧动三个旋钮(w1、w2、b),让蓝色分界线把<span style="color: #ef4444">苹果</span>和<span style="color: #10b981">桃子</span>分开;也可以让机器自己学。
    </p>
    <div class="demo-controls">
      <label>w1(重量的权重)<input v-model.number="w1" type="range" min="-5" max="5" step="0.01" /><b>{{ w1.toFixed(2) }}</b></label>
      <label>w2(绒毛的权重)<input v-model.number="w2" type="range" min="-5" max="5" step="0.01" /><b>{{ w2.toFixed(2) }}</b></label>
      <label>b(偏置)<input v-model.number="b" type="range" min="-5" max="5" step="0.01" /><b>{{ b.toFixed(2) }}</b></label>
    </div>
    <div class="demo-controls">
      <button class="btn" :disabled="training" @click="startTraining">让机器自己学</button>
      <button class="btn ghost" :disabled="!training" @click="stopTraining">暂停</button>
      <button class="btn ghost" @click="shuffleWeights">随机打乱权重</button>
      <button class="btn ghost" @click="newData">换一批数据</button>
    </div>
    <div class="demo-row">
      <canvas ref="cv" :width="S" :height="S" />
      <div style="min-width: 200px; flex: 1">
        <div class="demo-stat">
          z = <b>{{ w1.toFixed(2) }}</b>×重量 + <b>{{ w2.toFixed(2) }}</b>×绒毛 + <b>{{ b.toFixed(2) }}</b>
        </div>
        <div class="demo-stat">z &gt; 0 → 投票"桃子";否则 → "苹果"</div>
        <div class="demo-stat">
          正确率 <b :style="{ color: accuracy === 1 ? 'var(--demo-good)' : undefined }">{{ (accuracy * 100).toFixed(0) }}%</b>
          (打 × 的是分错的)
        </div>
        <p v-if="msg" class="demo-note">{{ msg }}</p>
      </div>
    </div>
    <p class="demo-note">
      观察:权重就是旋钮——w1、w2 决定分界线的倾斜方向,b 决定它平移到哪里;"训练"就是让机器根据分错的程度,自动一点点拧旋钮。但不管怎么拧,单个神经元只能画出一条直线,遇到弯弯曲曲的边界它就无能为力了。
    </p>
  </div>
</template>
