<script setup lang="ts">
import { ref, computed } from 'vue'

const TEAS = [
  { name: '杨枝甘露', icon: '🥭' },
  { name: '珍珠奶茶', icon: '🧋' },
  { name: '芝士莓莓', icon: '🍓' },
  { name: '柠檬茶', icon: '🍋' },
  { name: '抹茶拿铁', icon: '🍵' },
  { name: '芋泥波波', icon: '🍠' },
  { name: '四季春茶', icon: '🌿' },
  { name: '黑糖鲜奶', icon: '🍯' }
]
// 虚拟用户的评分:1~5 星,0 表示没喝过
const USERS = [
  { name: '小A', tag: '爱甜', r: [5, 5, 5, 2, 3, 4, 1, 4] },
  { name: '小B', tag: '爱清爽', r: [4, 2, 3, 5, 2, 1, 5, 1] },
  { name: '小C', tag: '爱浓郁奶香', r: [2, 4, 2, 1, 5, 5, 2, 5] },
  { name: '小D', tag: '甜党', r: [5, 4, 5, 2, 0, 5, 1, 0] },
  { name: '小E', tag: '清爽派', r: [4, 1, 4, 5, 2, 0, 5, 1] },
  { name: '小F', tag: '奶香控', r: [0, 5, 1, 2, 5, 4, 2, 5] },
  { name: '小G', tag: '果茶迷', r: [5, 2, 5, 4, 1, 2, 4, 0] },
  { name: '小H', tag: '随便喝喝', r: [3, 4, 3, 3, 4, 3, 3, 4] }
]
const MID = 3 // 先减去 3 分:喜欢变正数,不喜欢变负数

const mine = ref<number[]>(new Array(TEAS.length).fill(0))
const ratedCount = computed(() => mine.value.filter((x) => x > 0).length)
const ready = computed(() => ratedCount.value >= 2)

function setRating(i: number, v: number) {
  const next = [...mine.value]
  next[i] = v
  mine.value = next
}
function clearAll() {
  mine.value = new Array(TEAS.length).fill(0)
}
const QUICK = [
  { label: '我是甜党', r: [5, 0, 5, 1, 0, 0, 0, 0] },
  { label: '我爱清爽', r: [0, 0, 0, 5, 0, 1, 5, 0] },
  { label: '我爱奶香', r: [0, 0, 0, 1, 5, 0, 0, 5] }
]

// 余弦相似度:只看双方都喝过的款
const sims = computed(() =>
  USERS.map((u, ui) => {
    let dot = 0, a = 0, b = 0, common = 0
    mine.value.forEach((m, i) => {
      if (m > 0 && u.r[i] > 0) {
        const x = m - MID, y = u.r[i] - MID
        dot += x * y; a += x * x; b += y * y; common++
      }
    })
    // 共同喝过的款少于 3 款时打折扣,避免"只有 1 款相同就算 100% 相似"
    const s = a && b ? (dot / Math.sqrt(a * b)) * (Math.min(common, 3) / 3) : 0
    return { ui, s, common }
  }).sort((p, q) => q.s - p.s)
)

type Rec = { i: number; pred: number; reason: string }
const recs = computed<Rec[]>(() => {
  if (!ready.value) return []
  const best = sims.value[0]
  const out: Rec[] = []
  TEAS.forEach((_, i) => {
    if (mine.value[i] > 0) return
    let num = 0, den = 0
    let top: { ui: number; s: number } | null = null
    for (const o of sims.value) {
      const r = USERS[o.ui].r[i]
      if (o.s <= 0 || r === 0) continue
      num += o.s * (r - MID)
      den += o.s
      if (!top) top = o // sims 已按相似度排好序,第一个就是最像的
    }
    if (!top || den === 0) return
    const pred = Math.min(5, Math.max(1, MID + num / den))
    const u = USERS[top.ui]
    const who = top.ui === best.ui ? `和你最像的${u.name}` : `口味和你接近的${u.name}`
    out.push({ i, pred, reason: `${who}(相似度 ${top.s.toFixed(2)})给它打了 ${u.r[i]} 分` })
  })
  return out.sort((p, q) => q.pred - p.pred)
})
const untouched = computed(() =>
  TEAS.map((_, i) => i).filter((i) => mine.value[i] === 0 && !recs.value.some((r) => r.i === i))
)

const showTable = ref(false)
const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n))
</script>

<template>
  <div class="demo">
    <div class="demo-title">奶茶推荐:找到和你口味最像的人</div>
    <p class="demo-desc">给你喝过的奶茶打个分(至少 2 款),系统会找出和你口味最像的虚拟同学,再根据他们的评分给你推荐没喝过的奶茶。</p>

    <div class="demo-controls">
      <span class="lbl">偷个懒:</span>
      <button v-for="qk in QUICK" :key="qk.label" class="btn ghost" @click="mine = [...qk.r]">{{ qk.label }}</button>
      <button class="btn ghost" @click="clearAll">清空</button>
    </div>

    <div class="rate-grid">
      <div v-for="(t, i) in TEAS" :key="t.name" class="rate-row">
        <span class="tea">{{ t.icon }} {{ t.name }}</span>
        <button class="never" :class="{ on: mine[i] === 0 }" @click="setRating(i, 0)">没喝过</button>
        <span class="stars">
          <button
            v-for="v in 5"
            :key="v"
            class="star"
            :class="{ on: mine[i] >= v }"
            :title="v + ' 星'"
            @click="setRating(i, v)"
          >★</button>
        </span>
      </div>
    </div>

    <div v-if="!ready" class="wait">再给 {{ 2 - ratedCount }} 款奶茶打分,就能开始推荐啦~</div>
    <div v-else class="demo-row results">
      <div class="col">
        <div class="col-title">和你口味最像的人</div>
        <div v-for="o in sims" :key="o.ui" class="sim-row">
          <span class="uname">{{ USERS[o.ui].name }}<small>{{ USERS[o.ui].tag }}</small></span>
          <span class="sim-track">
            <span class="mid"></span>
            <span
              class="sim-fill"
              :class="o.s >= 0 ? 'pos' : 'neg'"
              :style="o.s >= 0 ? { left: '50%', width: o.s * 50 + '%' } : { right: '50%', width: -o.s * 50 + '%' }"
            ></span>
          </span>
          <span class="num">{{ o.s.toFixed(2) }}</span>
        </div>
        <div class="demo-stat small">条形向右(绿)= 口味相近,向左(红)= 口味相反;只比较你们都喝过的款,共同喝过的不到 3 款时相似度会打折扣。</div>
      </div>
      <div class="col">
        <div class="col-title">为你推荐</div>
        <div v-for="(r, k) in recs" :key="r.i" class="rec">
          <div class="rec-head">
            <span class="rank">{{ k + 1 }}</span>
            <b>{{ TEAS[r.i].icon }} {{ TEAS[r.i].name }}</b>
            <span class="pred">预测 {{ r.pred.toFixed(1) }} 分 <span class="st">{{ stars(r.pred) }}</span></span>
          </div>
          <div class="why">为什么:{{ r.reason }}</div>
        </div>
        <div v-if="!recs.length && !untouched.length" class="demo-stat">你把所有奶茶都喝过了,没什么可推荐的啦!</div>
        <div v-if="untouched.length" class="demo-stat small">
          暂时没法预测:{{ untouched.map((i) => TEAS[i].name).join('、') }}(和你口味相近的人都没喝过)
        </div>
      </div>
    </div>

    <div class="demo-controls">
      <button class="btn ghost" @click="showTable = !showTable">{{ showTable ? '收起' : '查看' }}虚拟同学的评分表</button>
    </div>
    <div v-if="showTable" class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th></th>
            <th v-for="t in TEAS" :key="t.name">{{ t.icon }}<br />{{ t.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in USERS" :key="u.name">
            <th>{{ u.name }}·{{ u.tag }}</th>
            <td v-for="(v, i) in u.r" :key="i" :class="v >= 4 ? 'hi' : v > 0 && v <= 2 ? 'lo' : ''">{{ v || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="demo-note">
      💡 这就是"协同过滤":先找到和你口味最像的人,再看他们喜欢什么。算法:把每个评分减去 3 分(喜欢为正、不喜欢为负),
      用你们都喝过的款算余弦相似度;对你没喝过的奶茶,用相似的人的评分按相似度加权平均,得到预测分。
      多打几款试试——你的数据越多,找"同类"就越准,推荐也越靠谱。外卖、短视频软件的推荐背后也是类似的思想,只是用户和商品多到上亿,方法也复杂得多。
    </p>
  </div>
</template>

<style scoped>
.lbl {
  color: var(--vp-c-text-2);
}
.rate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 6px 18px;
  margin: 8px 0 12px;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tea {
  width: 104px;
  flex-shrink: 0;
  color: var(--vp-c-text-1);
}
.never {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--demo-border);
  background: var(--demo-canvas-bg);
  color: var(--demo-muted);
  cursor: pointer;
}
.never.on {
  border-color: var(--demo-muted);
  color: var(--vp-c-text-1);
}
.stars {
  display: inline-flex;
}
.star {
  font-size: 20px;
  line-height: 1;
  padding: 0 1px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--demo-border);
  transition: transform 0.1s;
}
.star:hover {
  transform: scale(1.15);
}
.star.on {
  color: #f59e0b;
}
.wait {
  padding: 10px 12px;
  border: 1px dashed var(--demo-border);
  border-radius: 8px;
  color: var(--demo-muted);
}
.results {
  gap: 20px;
}
.col {
  flex: 1;
  min-width: 260px;
}
.col-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 6px;
}
.sim-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 3px 0;
}
.uname {
  width: 96px;
  flex-shrink: 0;
  color: var(--vp-c-text-1);
}
.uname small {
  margin-left: 4px;
  color: var(--demo-muted);
}
.sim-track {
  position: relative;
  flex: 1;
  height: 12px;
  border-radius: 6px;
  background: var(--demo-border);
  overflow: hidden;
}
.mid {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--demo-muted);
}
.sim-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  transition: width 0.3s;
}
.sim-fill.pos {
  background: var(--demo-good);
}
.sim-fill.neg {
  background: var(--demo-bad);
}
.num {
  width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.small {
  font-size: 12.5px;
  margin-top: 4px;
}
.rec {
  padding: 6px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background: var(--demo-canvas-bg);
}
.rec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--vp-c-text-1);
}
.rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--demo-accent);
  color: #fff;
  font-size: 12px;
}
.pred {
  margin-left: auto;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.st {
  color: #f59e0b;
}
.why {
  font-size: 12.5px;
  color: var(--demo-muted);
  margin-top: 2px;
}
.table-wrap {
  overflow-x: auto;
}
.tbl {
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 0;
  display: table;
}
.tbl th,
.tbl td {
  border: 1px solid var(--demo-border);
  padding: 3px 6px;
  text-align: center;
  background: var(--demo-canvas-bg);
  color: var(--vp-c-text-1);
  line-height: 1.4;
}
.tbl tbody th {
  white-space: nowrap;
  text-align: left;
}
.tbl td.hi {
  color: var(--demo-good);
  font-weight: 700;
}
.tbl td.lo {
  color: var(--demo-bad);
}
</style>
