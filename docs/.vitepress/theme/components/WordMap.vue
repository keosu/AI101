<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

// ---------- 玩具词向量:每一维都有明确含义 ----------
const DIMS = [
  '性别(男+/女−)', '皇室', '年龄(老+/幼−)', '人', '家庭', '学校', '动物', '猫科+/犬科−',
  '家养', '体型', '速度', '食物', '水果', '甜', '主食', '交通工具'
]
const D = DIMS.length
const CATS = [
  { name: '人物', color: '#ef4444' },
  { name: '动物', color: '#22c55e' },
  { name: '食物', color: '#f59e0b' },
  { name: '交通工具', color: '#3b82f6' }
]
type Word = { w: string; cat: number; v: number[] }
const WORDS: Word[] = []
function def(w: string, cat: number, o: Record<number, number>) {
  const v = new Array(D).fill(0)
  for (const k in o) v[+k] = o[k]
  WORDS.push({ w, cat, v })
}
const K = 1.6 // 类别维度的权重
def('国王', 0, { 0: 1, 1: 1.15, 2: 0.7, 3: K })
def('女王', 0, { 0: -1, 1: 1.15, 2: 0.7, 3: K })
def('王子', 0, { 0: 1, 1: 1.15, 2: -0.5, 3: K })
def('公主', 0, { 0: -1, 1: 1.15, 2: -0.5, 3: K })
def('男人', 0, { 0: 1, 2: 0.4, 3: K })
def('女人', 0, { 0: -1, 2: 0.4, 3: K })
def('男孩', 0, { 0: 1, 2: -0.7, 3: K })
def('女孩', 0, { 0: -1, 2: -0.7, 3: K })
def('爸爸', 0, { 0: 1, 2: 0.55, 3: K, 4: 1 })
def('妈妈', 0, { 0: -1, 2: 0.55, 3: K, 4: 1 })
def('爷爷', 0, { 0: 1, 2: 1, 3: K, 4: 1 })
def('奶奶', 0, { 0: -1, 2: 1, 3: K, 4: 1 })
def('老师', 0, { 2: 0.45, 3: K, 5: 1 })
def('学生', 0, { 2: -0.35, 3: K, 5: 1 })
def('猫', 1, { 6: K, 7: 1, 8: 1, 9: -0.4 })
def('狗', 1, { 6: K, 7: -1, 8: 1, 9: -0.1 })
def('小猫', 1, { 6: K, 7: 1, 8: 1, 9: -0.7, 2: -0.8 })
def('小狗', 1, { 6: K, 7: -1, 8: 1, 9: -0.4, 2: -0.8 })
def('狮子', 1, { 6: K, 7: 1, 8: -1, 9: 0.7, 10: 0.6 })
def('老虎', 1, { 6: K, 7: 1, 8: -1, 9: 0.8, 10: 0.6 })
def('狼', 1, { 6: K, 7: -1, 8: -1, 9: 0.3, 10: 0.6 })
def('兔子', 1, { 6: K, 8: 0.3, 9: -0.6, 10: 0.5 })
def('大象', 1, { 6: K, 8: -0.5, 9: 1.2, 10: 0.1 })
def('老鼠', 1, { 6: K, 8: -0.3, 9: -1, 10: 0.4 })
def('苹果', 2, { 11: K, 12: 1, 13: 0.6, 9: -0.5 })
def('香蕉', 2, { 11: K, 12: 1, 13: 0.9, 9: -0.3 })
def('橙子', 2, { 11: K, 12: 1, 13: 0.3, 9: -0.5 })
def('西瓜', 2, { 11: K, 12: 1, 13: 0.8, 9: 0.5 })
def('面包', 2, { 11: K, 14: 1, 13: 0.3 })
def('米饭', 2, { 11: K, 14: 1 })
def('蛋糕', 2, { 11: K, 14: 0.3, 13: 1 })
def('汽车', 3, { 15: K, 10: 0.5, 9: 0.3 })
def('火车', 3, { 15: K, 10: 0.8, 9: 0.9 })
def('飞机', 3, { 15: K, 10: 1.2, 9: 0.9 })
def('自行车', 3, { 15: K, 10: 0.15, 9: -0.4 })
def('轮船', 3, { 15: K, 10: 0.3, 9: 1.2 })

const BY_CAT = CATS.map((_, ci) => WORDS.filter((x) => x.cat === ci))
const idxOf = (w: string) => WORDS.findIndex((x) => x.w === w)
function cos(a: number[], b: number[]) {
  let d = 0, x = 0, y = 0
  for (let i = 0; i < D; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i] }
  return x && y ? d / Math.sqrt(x * y) : 0
}
function nearest(v: number[], exclude: number[], k: number) {
  return WORDS.map((x, i) => ({ i, s: cos(v, x.v) }))
    .filter((o) => !exclude.includes(o.i))
    .sort((p, q) => q.s - p.s)
    .slice(0, k)
}

// ---------- PCA:协方差矩阵 + 幂迭代 ----------
function power(M: number[][]) {
  let b = Array.from({ length: D }, (_, i) => 1 + i * 0.01)
  let lam = 0
  for (let it = 0; it < 200; it++) {
    const nb = M.map((r) => r.reduce((s, a, j) => s + a * b[j], 0))
    lam = Math.hypot(...nb)
    if (lam < 1e-12) break
    b = nb.map((a) => a / lam)
  }
  // 固定符号:绝对值最大的分量取正,保证结果稳定
  let m = 0
  b.forEach((a, i) => { if (Math.abs(a) > Math.abs(b[m])) m = i })
  if (b[m] < 0) b = b.map((a) => -a)
  return { vec: b, lam }
}
type ViewData = { idx: number[]; mean: number[]; pcs: number[][]; pts: number[][] }
function pca(idx: number[]): ViewData {
  const n = idx.length
  const mean = new Array(D).fill(0)
  for (const i of idx) WORDS[i].v.forEach((a, d) => (mean[d] += a / n))
  const C = Array.from({ length: D }, () => new Array(D).fill(0))
  for (const i of idx) {
    const c = WORDS[i].v.map((a, d) => a - mean[d])
    for (let p = 0; p < D; p++) for (let q = 0; q < D; q++) C[p][q] += (c[p] * c[q]) / n
  }
  const e1 = power(C)
  const C2 = C.map((r, p) => r.map((a, q) => a - e1.lam * e1.vec[p] * e1.vec[q]))
  const e2 = power(C2)
  const pcs = [e1.vec, e2.vec]
  const vd: ViewData = { idx, mean, pcs, pts: [] }
  vd.pts = idx.map((i) => project(vd, WORDS[i].v))
  return vd
}
function project(vd: ViewData, v: number[]) {
  return vd.pcs.map((pc) => pc.reduce((s, a, d) => s + a * (v[d] - vd.mean[d]), 0))
}
const VIEWS = [
  { key: 'all', label: '全部词' },
  ...CATS.map((c, i) => ({ key: String(i), label: '只看' + c.name }))
]
const VIEWDATA: Record<string, ViewData> = {}
VIEWDATA.all = pca(WORDS.map((_, i) => i))
CATS.forEach((_, c) => {
  VIEWDATA[String(c)] = pca(WORDS.map((x, i) => (x.cat === c ? i : -1)).filter((i) => i >= 0))
})

// ---------- 状态 ----------
const view = ref('all')
const hoverIdx = ref<number | null>(null)
const selectedIdx = ref<number | null>(null)
const activeIdx = computed(() => hoverIdx.value ?? selectedIdx.value)
const activeNear = computed(() =>
  activeIdx.value === null ? [] : nearest(WORDS[activeIdx.value].v, [activeIdx.value], 5)
)
const activeDims = computed(() => {
  if (activeIdx.value === null) return []
  return WORDS[activeIdx.value].v
    .map((a, d) => ({ name: DIMS[d], a }))
    .filter((o) => o.a !== 0)
})

const a = ref('国王')
const b = ref('男人')
const c = ref('女人')
type Result = { a: number; b: number; c: number; vec: number[]; top: { i: number; s: number }[] }
const result = ref<Result | null>(null)
const PRESETS = [
  ['国王', '男人', '女人'],
  ['王子', '男孩', '女孩'],
  ['爸爸', '男人', '女人'],
  ['小猫', '猫', '狗'],
  ['狮子', '猫', '狗']
]
function compute() {
  const ia = idxOf(a.value), ib = idxOf(b.value), ic = idxOf(c.value)
  const vec = WORDS[ia].v.map((x, d) => x - WORDS[ib].v[d] + WORDS[ic].v[d])
  result.value = { a: ia, b: ib, c: ic, vec, top: nearest(vec, [ia, ib, ic], 3) }
  // 三个词同属一类时切换到该类视图,箭头看得更清楚
  const cat = WORDS[ia].cat
  view.value = WORDS[ib].cat === cat && WORDS[ic].cat === cat ? String(cat) : 'all'
  selectedIdx.value = null
}
function usePreset(p: string[]) {
  a.value = p[0]; b.value = p[1]; c.value = p[2]
  compute()
}
const arrowVisible = computed(() => {
  const r = result.value
  if (!r) return false
  const idx = VIEWDATA[view.value].idx
  return [r.a, r.b, r.c].every((i) => idx.includes(i))
})

// ---------- 画布 ----------
const CW = 600, CH = 420, PAD = 36, SCALE = 2
const canvas = ref<HTMLCanvasElement | null>(null)
let screen: number[][] = [] // 当前视图下各词的画布坐标
let mapFn: (p: number[]) => number[] = (p) => p
const labelCache: Record<string, { x: number; y: number }[]> = {}

function setupMap(vd: ViewData) {
  const xs = vd.pts.map((p) => p[0]), ys = vd.pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const s = Math.min((CW - 2 * PAD) / Math.max(x1 - x0, 1e-6), (CH - 2 * PAD) / Math.max(y1 - y0, 1e-6))
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  mapFn = (p) => [CW / 2 + (p[0] - cx) * s, CH / 2 - (p[1] - cy) * s]
  screen = vd.pts.map(mapFn)
}

// 简单的标签防重叠:互相推开 + 弹簧拉回原位
function layoutLabels(ctx: CanvasRenderingContext2D, vd: ViewData) {
  const boxes = vd.idx.map((wi, k) => {
    const w = ctx.measureText(WORDS[wi].w).width + 6
    return { x: screen[k][0], y: screen[k][1] - 13, w, h: 16, ax: screen[k][0], ay: screen[k][1] - 13 }
  })
  for (let it = 0; it < 250; it++) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i], q = boxes[j]
        const dx = (p.w + q.w) / 2 - Math.abs(p.x - q.x)
        const dy = (p.h + q.h) / 2 - Math.abs(p.y - q.y)
        if (dx > 0 && dy > 0) {
          if (dy <= dx) {
            const s = Math.sign(p.y - q.y) || (j % 2 ? 1 : -1)
            p.y += (s * dy) / 2; q.y -= (s * dy) / 2
          } else {
            const s = Math.sign(p.x - q.x) || (j % 2 ? 1 : -1)
            p.x += (s * dx) / 2; q.x -= (s * dx) / 2
          }
        }
      }
    }
    for (const o of boxes) {
      o.x += (o.ax - o.x) * 0.03
      o.y += (o.ay - o.y) * 0.03
      o.x = Math.min(CW - o.w / 2 - 2, Math.max(o.w / 2 + 2, o.x))
      o.y = Math.min(CH - 10, Math.max(10, o.y))
    }
  }
  return boxes.map((o) => ({ x: o.x, y: o.y }))
}

function arrow(ctx: CanvasRenderingContext2D, p: number[], q: number[], color: string, dashed: boolean) {
  const ang = Math.atan2(q[1] - p[1], q[0] - p[0])
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(dashed ? [6, 4] : [])
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  ctx.lineTo(q[0] - 8 * Math.cos(ang), q[1] - 8 * Math.sin(ang))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(q[0], q[1])
  ctx.lineTo(q[0] - 11 * Math.cos(ang - 0.4), q[1] - 11 * Math.sin(ang - 0.4))
  ctx.lineTo(q[0] - 11 * Math.cos(ang + 0.4), q[1] - 11 * Math.sin(ang + 0.4))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function draw() {
  const cv = canvas.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const css = getComputedStyle(cv)
  const text = css.color
  const muted = css.getPropertyValue('--demo-muted').trim() || '#888'
  const accent = css.getPropertyValue('--demo-accent').trim() || '#4f46e5'
  const vd = VIEWDATA[view.value]
  setupMap(vd)
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.clearRect(0, 0, CW, CH)
  ctx.font = '13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (!labelCache[view.value]) labelCache[view.value] = layoutLabels(ctx, vd)
  const labels = labelCache[view.value]

  // 坐标轴说明
  ctx.fillStyle = muted
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('主成分 1 →', CW - 8, CH - 10)
  ctx.textAlign = 'left'
  ctx.fillText('↑ 主成分 2', 8, 12)
  ctx.textAlign = 'center'
  ctx.font = '13px sans-serif'

  const act = activeIdx.value
  const hi = new Set<number>()
  if (act !== null) { hi.add(act); activeNear.value.forEach((o) => hi.add(o.i)) }
  const r = result.value
  if (r && arrowVisible.value) { [r.a, r.b, r.c, r.top[0].i].forEach((i) => hi.add(i)) }
  const dimOthers = act !== null || (r !== null && arrowVisible.value)

  // 引导线
  vd.idx.forEach((wi, k) => {
    const [px, py] = screen[k], L = labels[k]
    if (Math.hypot(L.x - px, L.y + 6 - py) > 14) {
      ctx.globalAlpha = dimOthers && !hi.has(wi) ? 0.15 : 0.45
      ctx.strokeStyle = muted
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(L.x, L.y + (L.y < py ? 7 : -7))
      ctx.stroke()
    }
  })
  ctx.globalAlpha = 1

  // 词语算术箭头:B→A 实线,C→结果 虚线(两条应该大致平行)
  let rp: number[] | null = null
  if (r && arrowVisible.value) {
    const P = (i: number) => mapFn(project(vd, WORDS[i].v))
    rp = mapFn(project(vd, r.vec))
    arrow(ctx, P(r.b), P(r.a), accent, false)
    arrow(ctx, P(r.c), rp, accent, true)
  }

  // 点与标签
  vd.idx.forEach((wi, k) => {
    const [px, py] = screen[k]
    const isAct = wi === act
    ctx.globalAlpha = dimOthers && !hi.has(wi) ? 0.25 : 1
    ctx.fillStyle = CATS[WORDS[wi].cat].color
    ctx.beginPath()
    ctx.arc(px, py, isAct ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
    if (isAct || (act !== null && hi.has(wi))) {
      ctx.strokeStyle = isAct ? text : CATS[WORDS[wi].cat].color
      ctx.lineWidth = isAct ? 2 : 1.5
      ctx.beginPath()
      ctx.arc(px, py, isAct ? 9 : 7, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = text
    ctx.font = isAct || hi.has(wi) ? 'bold 13px sans-serif' : '13px sans-serif'
    ctx.fillText(WORDS[wi].w, labels[k].x, labels[k].y)
  })
  ctx.globalAlpha = 1

  // 结果点(星号)
  if (rp) {
    ctx.fillStyle = accent
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText('★', rp[0], rp[1])
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText('结果', rp[0], rp[1] + 16)
  }
}

function toLocal(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return [((e.clientX - rect.left) * CW) / rect.width, ((e.clientY - rect.top) * CH) / rect.height]
}
function pick(e: PointerEvent): number | null {
  const [x, y] = toLocal(e)
  const vd = VIEWDATA[view.value]
  const labels = labelCache[view.value] || []
  let best: number | null = null, bd = 16
  vd.idx.forEach((wi, k) => {
    const d1 = Math.hypot(screen[k][0] - x, screen[k][1] - y)
    const d2 = labels[k] ? Math.hypot(labels[k].x - x, labels[k].y - y) : Infinity
    const d = Math.min(d1, d2)
    if (d < bd) { bd = d; best = wi }
  })
  return best
}
function onMove(e: PointerEvent) {
  if (e.pointerType === 'mouse') hoverIdx.value = pick(e)
}
function onLeave() { hoverIdx.value = null }
function onDown(e: PointerEvent) {
  const p = pick(e)
  selectedIdx.value = p === selectedIdx.value ? null : p
}

watch([view, activeIdx, result], draw)
let mo: MutationObserver | null = null
onMounted(() => {
  draw()
  // 切换深浅色主题时重画
  mo = new MutationObserver(draw)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => mo?.disconnect())

const fmt = (s: number) => s.toFixed(2)
const fmtDim = (x: number) => (x > 0 ? '+' : '') + x.toFixed(2).replace(/\.?0+$/, '')
</script>

<template>
  <div class="demo">
    <div class="demo-title">词向量地图:意思相近的词住得近</div>
    <p class="demo-desc">
      把鼠标移到(或点一下)某个词上,看看谁是它的"邻居";再在下面做"词语算术",看看 国王 − 男人 + 女人 会得到什么。
    </p>

    <div class="demo-controls">
      <span class="lbl">视图:</span>
      <button
        v-for="vw in VIEWS"
        :key="vw.key"
        class="btn"
        :class="{ ghost: view !== vw.key }"
        @click="view = vw.key"
      >{{ vw.label }}</button>
    </div>
    <div class="legend">
      <span v-for="ct in CATS" :key="ct.name"><i :style="{ background: ct.color }"></i>{{ ct.name }}</span>
    </div>

    <div class="demo-row">
      <canvas
        ref="canvas"
        :width="CW * SCALE"
        :height="CH * SCALE"
        class="map"
        @pointermove="onMove"
        @pointerleave="onLeave"
        @pointerdown="onDown"
      ></canvas>
      <div class="side">
        <template v-if="activeIdx !== null">
          <div class="side-title">
            <b :style="{ color: CATS[WORDS[activeIdx].cat].color }">{{ WORDS[activeIdx].w }}</b> 最近的 5 个词
          </div>
          <div v-for="o in activeNear" :key="o.i" class="near">
            <span class="near-w">{{ WORDS[o.i].w }}</span>
            <span class="bar"><span :style="{ width: Math.max(0, o.s) * 100 + '%' }"></span></span>
            <span class="num">{{ fmt(o.s) }}</span>
          </div>
          <div class="side-sub">它的向量(非零的维度):</div>
          <div class="dims">
            <span v-for="dm in activeDims" :key="dm.name">{{ dm.name }} {{ fmtDim(dm.a) }}</span>
          </div>
        </template>
        <div v-else class="side-empty">
          悬停或点击地图上的词,这里会列出和它最相似的 5 个词(余弦相似度,1 表示方向完全一致)。
        </div>
      </div>
    </div>

    <div class="arith">
      <div class="arith-title">词语算术</div>
      <div class="demo-controls">
        <select v-model="a">
          <optgroup v-for="(ct, ci) in CATS" :key="ct.name" :label="ct.name">
            <option v-for="x in BY_CAT[ci]" :key="x.w" :value="x.w">{{ x.w }}</option>
          </optgroup>
        </select>
        <b>−</b>
        <select v-model="b">
          <optgroup v-for="(ct, ci) in CATS" :key="ct.name" :label="ct.name">
            <option v-for="x in BY_CAT[ci]" :key="x.w" :value="x.w">{{ x.w }}</option>
          </optgroup>
        </select>
        <b>+</b>
        <select v-model="c">
          <optgroup v-for="(ct, ci) in CATS" :key="ct.name" :label="ct.name">
            <option v-for="x in BY_CAT[ci]" :key="x.w" :value="x.w">{{ x.w }}</option>
          </optgroup>
        </select>
        <b>= ?</b>
        <button class="btn" @click="compute">计算</button>
      </div>
      <div class="demo-controls">
        <span class="lbl">试试:</span>
        <button v-for="p in PRESETS" :key="p.join()" class="btn ghost" @click="usePreset(p)">
          {{ p[0] }} − {{ p[1] }} + {{ p[2] }}
        </button>
      </div>
      <div v-if="result" class="result">
        <div>
          {{ WORDS[result.a].w }} − {{ WORDS[result.b].w }} + {{ WORDS[result.c].w }} ≈
          <b class="big">{{ WORDS[result.top[0].i].w }}</b>
        </div>
        <div v-for="(o, k) in result.top" :key="o.i" class="near">
          <span class="near-w">{{ k + 1 }}. {{ WORDS[o.i].w }}</span>
          <span class="bar"><span :style="{ width: Math.max(0, o.s) * 100 + '%' }"></span></span>
          <span class="num">{{ fmt(o.s) }}</span>
        </div>
        <div class="demo-stat" v-if="arrowVisible">
          地图上:实线箭头是"{{ WORDS[result.b].w }} → {{ WORDS[result.a].w }}",虚线箭头是从"{{ WORDS[result.c].w }}"出发、走同样的一步,★ 就是算出来的位置。两条箭头几乎平行——"关系"变成了"方向"。
        </div>
        <div class="demo-stat" v-else>切换到「全部词」视图,就能在地图上看到箭头。</div>
      </div>
    </div>

    <p class="demo-note">
      💡 观察:同一类的词聚成一团;"男→女"在人物区总是同一个方向,所以 国王 − 男人 + 女人 正好落在 女王 附近。
      诚实说明:这里的 36 个词、16 维向量是为讲解<b>人工设计</b>的简化版(每一维的意思都写在右侧);
      地图是用主成分分析(PCA)把 16 维"拍扁"成 2 维得到的,所以有些在高维里不同的词在图上会挨得很近,标签也做了轻微错开。
      真实的词向量有几百维,每一维没有现成的名字,完全是机器读了海量文本<b>自己学出来</b>的——但"意思相近的词住得近""关系变成方向"这个现象是一样的。
    </p>
  </div>
</template>

<style scoped>
.map {
  width: 600px;
  height: auto;
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.lbl {
  color: var(--vp-c-text-2);
}
.legend {
  display: flex;
  gap: 14px;
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
}
.side {
  flex: 1;
  min-width: 200px;
  font-size: 13.5px;
}
.side-title {
  margin-bottom: 6px;
  color: var(--vp-c-text-1);
}
.side-sub {
  margin: 10px 0 4px;
  color: var(--vp-c-text-2);
}
.side-empty {
  color: var(--demo-muted);
}
.near {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 3px 0;
}
.near-w {
  width: 64px;
  color: var(--vp-c-text-1);
}
.bar {
  flex: 1;
  max-width: 160px;
  height: 10px;
  border-radius: 5px;
  background: var(--demo-border);
  overflow: hidden;
}
.bar > span {
  display: block;
  height: 100%;
  background: var(--demo-accent);
}
.num {
  width: 40px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
}
.dims {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dims span {
  font-size: 12px;
  padding: 1px 6px;
  border: 1px solid var(--demo-border);
  border-radius: 4px;
  background: var(--demo-canvas-bg);
  color: var(--vp-c-text-2);
}
.arith {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--demo-border);
}
.arith-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.result {
  margin-top: 6px;
  color: var(--vp-c-text-1);
}
.result .big {
  font-size: 18px;
  color: var(--demo-accent);
}
</style>
