<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const COLS = 8
const ROWS = 6
const CELL = 56
const NS = COLS * ROWS
const START = (ROWS - 1) * COLS // 左下角
const GOAL = COLS - 1 // 右上角
const MAX_STEPS = 200
const WALK_MAX = 100
// 动作:0 上 1 右 2 下 3 左
const DR = [-1, 0, 1, 0]
const DC = [0, 1, 0, -1]

// 默认地图:# 墙,X 陷阱,S 起点,G 终点
const LAYOUT = ['....#..G', '.##.#.#.', '....#.#.', '.#X...X.', '.#.##.#.', 'S...#...']

const walls = new Uint8Array(NS)
const traps = new Uint8Array(NS)
function loadLayout() {
  walls.fill(0)
  traps.fill(0)
  LAYOUT.forEach((line, r) => {
    for (let c = 0; c < COLS; c++) {
      if (line[c] === '#') walls[r * COLS + c] = 1
      if (line[c] === 'X') traps[r * COLS + c] = 1
    }
  })
}
loadLayout()

const Q = new Float64Array(NS * 4)

const epsilon = ref(0.3)
const decay = ref(false)
const alpha = ref(0.5)
const gamma = ref(0.95)
const speed = ref(5)
const showAll = ref(false)
const trapMode = ref(false)

const episodes = ref(0)
const lastSteps = ref(0)
const lastReward = ref(0)
const avgReward = ref(0)
const auto = ref(false)
const walking = ref(false)
const walkMsg = ref('')
let history: number[] = []

const cv = ref<HTMLCanvasElement | null>(null)
let robot = -1
let trail: number[] = []
let raf = 0
let walkTimer: ReturnType<typeof setInterval> | null = null

// ---------- 环境 ----------
function envStep(s: number, a: number): [number, number, boolean] {
  const r = Math.floor(s / COLS) + DR[a]
  const c = (s % COLS) + DC[a]
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS || walls[r * COLS + c]) return [s, -1, false]
  const ns = r * COLS + c
  if (ns === GOAL) return [ns, 10, true]
  if (traps[ns]) return [ns, -5, true]
  return [ns, -0.1, false]
}

function maxQ(s: number) {
  return Math.max(Q[s * 4], Q[s * 4 + 1], Q[s * 4 + 2], Q[s * 4 + 3])
}
// 贪心动作,平局时随机选
function greedy(s: number) {
  const m = maxQ(s)
  const ties: number[] = []
  for (let a = 0; a < 4; a++) if (Q[s * 4 + a] === m) ties.push(a)
  return ties[Math.floor(Math.random() * ties.length)]
}

// ---------- Q 学习 ----------
function runEpisode() {
  const eps = epsilon.value, al = alpha.value, ga = gamma.value
  let s = START, total = 0, steps = 0
  while (steps < MAX_STEPS) {
    const a = Math.random() < eps ? Math.floor(Math.random() * 4) : greedy(s)
    const [ns, r, done] = envStep(s, a)
    const target = r + (done ? 0 : ga * maxQ(ns))
    Q[s * 4 + a] += al * (target - Q[s * 4 + a])
    total += r
    steps++
    s = ns
    if (done) break
  }
  episodes.value++
  lastSteps.value = steps
  lastReward.value = total
  history.push(total)
  if (history.length > 50) history.shift()
  avgReward.value = history.reduce((x, y) => x + y, 0) / history.length
  if (decay.value) epsilon.value = Math.max(0.01, +(eps * 0.99).toFixed(4))
}

function train(n: number) {
  stopWalk()
  robot = -1
  for (let i = 0; i < n; i++) runEpisode()
  draw()
}

function autoLoop() {
  for (let i = 0; i < speed.value; i++) runEpisode()
  draw()
  raf = requestAnimationFrame(autoLoop)
}
function stopAuto() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  auto.value = false
}
function toggleAuto() {
  if (auto.value) return stopAuto()
  stopWalk()
  robot = -1
  auto.value = true
  raf = requestAnimationFrame(autoLoop)
}

function stopWalk() {
  if (walkTimer) clearInterval(walkTimer)
  walkTimer = null
  walking.value = false
}
function walk() {
  stopAuto()
  stopWalk()
  robot = START
  trail = [START]
  walkMsg.value = '机器人出发了…'
  walking.value = true
  let steps = 0
  draw()
  walkTimer = setInterval(() => {
    const [ns, , done] = envStep(robot, greedy(robot))
    robot = ns
    trail.push(ns)
    steps++
    draw()
    if (done) {
      stopWalk()
      walkMsg.value = ns === GOAL ? `到达终点!用了 ${steps} 步。` : `走了 ${steps} 步,掉进陷阱了……`
    } else if (steps >= WALK_MAX) {
      stopWalk()
      walkMsg.value = `走了 ${WALK_MAX} 步还没到终点,可能在原地打转——再多训练一会儿吧。`
    }
  }, 150)
}

function resetLearning() {
  stopAuto()
  stopWalk()
  Q.fill(0)
  episodes.value = 0
  lastSteps.value = 0
  lastReward.value = 0
  avgReward.value = 0
  history = []
  robot = -1
  trail = []
  walkMsg.value = ''
  draw()
}
function clearWalls() {
  stopWalk()
  walls.fill(0)
  robot = -1
  draw()
}
function restoreMap() {
  stopWalk()
  loadLayout()
  robot = -1
  draw()
}

// 点击格子:切换墙;Shift+点击或"陷阱模式"切换陷阱
function onDown(e: PointerEvent) {
  const c = cv.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const x = ((e.clientX - r.left) * c.width) / r.width
  const y = ((e.clientY - r.top) * c.height) / r.height
  const col = Math.floor(x / CELL), row = Math.floor(y / CELL)
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return
  const s = row * COLS + col
  if (s === START || s === GOAL) return
  stopWalk()
  robot = -1
  if (e.shiftKey || trapMode.value) {
    traps[s] = traps[s] ? 0 : 1
    walls[s] = 0
  } else {
    walls[s] = walls[s] ? 0 : 1
    traps[s] = 0
  }
  draw()
}

// ---------- 绘制 ----------
function drawArrow(c: CanvasRenderingContext2D, cx: number, cy: number, a: number, len: number) {
  const dx = DC[a], dy = DR[a]
  const ex = cx + dx * len, ey = cy + dy * len
  c.beginPath()
  c.moveTo(cx - dx * len * 0.6, cy - dy * len * 0.6)
  c.lineTo(ex - dx * 5, ey - dy * 5)
  c.stroke()
  c.beginPath()
  c.moveTo(ex, ey)
  c.lineTo(ex - dx * 8 - dy * 5, ey - dy * 8 + dx * 5)
  c.lineTo(ex - dx * 8 + dy * 5, ey - dy * 8 - dx * 5)
  c.closePath()
  c.fill()
}

function draw() {
  const el = cv.value
  if (!el) return
  const c = el.getContext('2d')!
  const fg = getComputedStyle(el).color || '#888'
  const dark = document.documentElement.classList.contains('dark')
  c.clearRect(0, 0, el.width, el.height)
  c.textAlign = 'center'
  c.textBaseline = 'middle'

  for (let s = 0; s < NS; s++) {
    const x = (s % COLS) * CELL, y = Math.floor(s / COLS) * CELL
    const cx = x + CELL / 2, cy = y + CELL / 2
    if (walls[s]) {
      c.fillStyle = dark ? '#52525b' : '#64748b'
      c.fillRect(x, y, CELL, CELL)
      continue
    }
    if (s === GOAL) {
      c.fillStyle = 'rgba(245,158,11,0.35)'
      c.fillRect(x, y, CELL, CELL)
      c.fillStyle = '#f59e0b'
      c.font = 'bold 22px sans-serif'
      c.fillText('终', cx, cy - 6)
      c.font = '11px sans-serif'
      c.fillText('+10', cx, cy + 15)
      continue
    }
    if (traps[s]) {
      c.fillStyle = 'rgba(239,68,68,0.25)'
      c.fillRect(x, y, CELL, CELL)
      c.fillStyle = '#ef4444'
      c.font = 'bold 30px sans-serif'
      c.fillText('×', cx, cy - 4)
      c.font = '11px sans-serif'
      c.fillText('-5', cx, cy + 17)
      continue
    }
    // 按 max Q 着色:正偏绿,负偏红
    const v = maxQ(s)
    const learned = Q[s * 4] || Q[s * 4 + 1] || Q[s * 4 + 2] || Q[s * 4 + 3]
    if (learned) {
      const a = v >= 0 ? 0.08 + Math.min(1, v / 10) * 0.6 : 0.08 + Math.min(1, -v / 5) * 0.6
      c.fillStyle = v >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`
      c.fillRect(x, y, CELL, CELL)
      // 最优动作箭头
      let b = 0
      for (let k = 1; k < 4; k++) if (Q[s * 4 + k] > Q[s * 4 + b]) b = k
      c.strokeStyle = fg
      c.fillStyle = fg
      c.lineWidth = 2
      c.globalAlpha = 0.75
      drawArrow(c, cx, cy, b, showAll.value ? 9 : 16)
      c.globalAlpha = 1
    }
    if (showAll.value) {
      c.fillStyle = fg
      c.font = '10px sans-serif'
      const f = (k: number) => Q[s * 4 + k].toFixed(1)
      c.fillText(f(0), cx, y + 8)
      c.fillText(f(2), cx, y + CELL - 7)
      c.textAlign = 'right'
      c.fillText(f(1), x + CELL - 3, cy)
      c.textAlign = 'left'
      c.fillText(f(3), x + 3, cy)
      c.textAlign = 'center'
    }
    if (s === START) {
      c.fillStyle = '#6366f1'
      c.font = 'bold 13px sans-serif'
      c.textAlign = 'left'
      c.textBaseline = 'top'
      c.fillText('起', x + 4, y + 3)
      c.textAlign = 'center'
      c.textBaseline = 'middle'
    }
  }

  // 网格线
  c.strokeStyle = fg
  c.globalAlpha = 0.2
  c.lineWidth = 1
  c.beginPath()
  for (let i = 0; i <= COLS; i++) {
    c.moveTo(i * CELL + 0.5, 0)
    c.lineTo(i * CELL + 0.5, ROWS * CELL)
  }
  for (let i = 0; i <= ROWS; i++) {
    c.moveTo(0, i * CELL + 0.5)
    c.lineTo(COLS * CELL, i * CELL + 0.5)
  }
  c.stroke()
  c.globalAlpha = 1

  // 足迹与机器人
  if (robot >= 0) {
    c.fillStyle = 'rgba(99,102,241,0.45)'
    for (const t of trail) {
      c.beginPath()
      c.arc((t % COLS) * CELL + CELL / 2, Math.floor(t / COLS) * CELL + CELL / 2, 4, 0, Math.PI * 2)
      c.fill()
    }
    c.beginPath()
    c.arc((robot % COLS) * CELL + CELL / 2, Math.floor(robot / COLS) * CELL + CELL / 2, 14, 0, Math.PI * 2)
    c.fillStyle = '#6366f1'
    c.fill()
    c.lineWidth = 3
    c.strokeStyle = '#fff'
    c.stroke()
  }
}

watch(showAll, draw)

let themeObs: MutationObserver | null = null
onMounted(() => {
  draw()
  themeObs = new MutationObserver(draw)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  stopAuto()
  stopWalk()
  themeObs?.disconnect()
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">迷宫里的强化学习:Q 学习</div>
    <p class="demo-desc">
      机器人从"起"出发,要找到"终"(+10),避开陷阱"×"(-5)。点"训练"让它反复试错,再点"让机器人走一遍"看它学会了没有。点格子可以加/删墙。
    </p>

    <div class="demo-controls">
      <button class="btn" @click="train(1)">训练 1 回合</button>
      <button class="btn" @click="train(100)">训练 100 回合</button>
      <button class="btn" @click="toggleAuto">{{ auto ? '暂停' : '自动训练' }}</button>
      <button class="btn" :disabled="walking" @click="walk">让机器人走一遍</button>
      <button class="btn ghost" @click="resetLearning">重置学习</button>
    </div>
    <div class="demo-controls">
      <label
        >探索率 ε <input v-model.number="epsilon" type="range" min="0" max="1" step="0.01" />
        <span class="demo-stat"><b>{{ epsilon.toFixed(2) }}</b></span></label
      >
      <label><input v-model="decay" type="checkbox" /> 每回合衰减 ε</label>
      <label
        >学习率 α <input v-model.number="alpha" type="range" min="0.05" max="1" step="0.05" />
        <span class="demo-stat"><b>{{ alpha.toFixed(2) }}</b></span></label
      >
      <label
        >折扣 γ <input v-model.number="gamma" type="range" min="0" max="0.99" step="0.01" />
        <span class="demo-stat"><b>{{ gamma.toFixed(2) }}</b></span></label
      >
      <label
        >自动训练速度 <input v-model.number="speed" type="range" min="1" max="50" step="1" />
        <span class="demo-stat">{{ speed }} 回合/帧</span></label
      >
    </div>
    <div class="demo-controls">
      <label><input v-model="showAll" type="checkbox" /> 显示全部 Q 值</label>
      <label><input v-model="trapMode" type="checkbox" /> 编辑模式:陷阱(或按住 Shift 点击)</label>
      <button class="btn ghost" @click="clearWalls">清空地图墙</button>
      <button class="btn ghost" @click="restoreMap">恢复默认地图</button>
    </div>

    <canvas ref="cv" :width="COLS * CELL" :height="ROWS * CELL" @pointerdown="onDown"></canvas>

    <div class="demo-controls">
      <span class="demo-stat">已训练 <b>{{ episodes }}</b> 回合</span>
      <span class="demo-stat">最近一回合:<b>{{ lastSteps }}</b> 步,总奖励 <b>{{ lastReward.toFixed(1) }}</b></span>
      <span class="demo-stat">最近 50 回合平均奖励 <b>{{ avgReward.toFixed(2) }}</b></span>
    </div>
    <div v-if="walkMsg" class="demo-stat">机器人:{{ walkMsg }}</div>

    <p class="demo-note">
      观察:一开始机器人只会乱撞(格子没有颜色、没有箭头);多训练几百回合后,绿色的"价值"会从终点一圈圈向外扩散,箭头逐渐连成一条通往出口的路——没有人告诉它路线,它是靠奖励和惩罚自己摸索出来的。
      试试把 ε 调成 0:它只"利用"已知的经验、从不"探索",可能一直困在一条较差的路线上;把 ε 调到 1:它只探索不利用,永远在瞎走。好的学习需要在探索和利用之间取得平衡。
    </p>
  </div>
</template>
