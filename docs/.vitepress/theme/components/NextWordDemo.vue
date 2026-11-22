<script setup lang="ts">
import { ref, computed } from 'vue'

// 迷你语料:每行一句,词之间用空格分开
const RAW = `
今天 天气 很 好
今天 天气 真 不错
今天 天气 很 冷
今天 天气 有点 热
明天 天气 很 好
明天 可能 会 下雨
昨天 下 了 一 场 大雨
外面 在 下雨
外面 风 很 大
今天 是 晴天
周末 天气 很 好
天气 热 的 时候 我 想 吃 冰淇淋
我 喜欢 吃 苹果
我 喜欢 吃 米饭
我 喜欢 吃 面条
我 喜欢 养 猫
我 喜欢 养 狗
我 喜欢 下雨 天
我 喜欢 上 数学 课
我 不 喜欢 下雨 天
我 不 喜欢 吃 青菜
他 喜欢 吃 苹果
她 喜欢 养 猫
妈妈 喜欢 吃 青菜
我 每天 早上 吃 面包
我 每天 早上 喝 牛奶
我 中午 在 食堂 吃饭
我们 中午 一起 吃饭
食堂 的 饭 很 好吃
妈妈 做 的 饭 很 好吃
这个 苹果 很 甜
这个 苹果 真 好吃
晚饭 我们 吃 面条
我 想 吃 冰淇淋
小猫 在 睡觉
小猫 在 晒 太阳
小猫 喜欢 吃 鱼
小狗 喜欢 吃 骨头
小狗 在 院子 里 跑
小狗 很 可爱
小猫 很 可爱
我 的 猫 很 懒
我 的 狗 很 聪明
猫 喜欢 睡觉
狗 喜欢 跑步
我 每天 去 学校
我 每天 坐 公交车 去 学校
我们 在 教室 里 上课
老师 在 黑板 上 写字
老师 说 明天 考试
明天 要 考 数学
今天 的 作业 很 多
今天 的 数学 作业 很 难
同学 们 在 操场 上 跑步
下课 了 我们 去 操场
我 和 同学 一起 去 图书馆
我 在 图书馆 看书
周末 我们 去 公园
周末 我们 去 爬山
周末 我 想 去 看 电影
周末 我 在 家 看书
我们 坐 火车 去 北京
我们 坐 飞机 去 上海
爸爸 开车 带 我们 去 公园
公园 里 的 花 很 漂亮
山 上 的 风景 很 美
我 很 喜欢 周末
今天 我 很 开心
今天 我 有点 累
我 想 去 公园 玩
`
const BOS = '<s>'
const EOS = '</s>'
const SENTS = RAW.trim().split('\n').map((s) => s.trim().split(/\s+/))
const WORD_COUNT = SENTS.reduce((s, x) => s + x.length, 0)

// TABLES[k]:上下文长度为 k 时,"前 k 个词" -> (下一个词 -> 次数)
const TABLES: Map<string, Map<string, number>>[] = [new Map(), new Map(), new Map()]
for (const sent of SENTS) {
  const toks = [BOS, BOS, ...sent, EOS]
  for (let i = 2; i < toks.length; i++) {
    for (let k = 0; k <= 2; k++) {
      const key = toks.slice(i - k, i).join(' ')
      let m = TABLES[k].get(key)
      if (!m) { m = new Map(); TABLES[k].set(key, m) }
      m.set(toks[i], (m.get(toks[i]) || 0) + 1)
    }
  }
}

type Pred = { k: number; key: string; dist: [string, number][]; total: number; missed: string[] }
// 从 n 元开始查,查不到就回退到更短的上下文
function predict(history: string[], n: number): Pred {
  const missed: string[] = []
  for (let k = n - 1; k >= 0; k--) {
    const key = history.slice(history.length - k).join(' ')
    const m = TABLES[k].get(key)
    if (m) {
      const dist = [...m.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
      const total = dist.reduce((s, x) => s + x[1], 0)
      return { k, key: k ? key : '', dist, total, missed }
    }
    missed.push(key)
  }
  return { k: 0, key: '', dist: [], total: 0, missed } // 不会走到这里:一元表总有内容
}

const show = (w: string) => (w === EOS ? '〈句末〉' : w === BOS ? '〈句首〉' : w)
const showKey = (key: string) => key.split(' ').map(show).join(' ')

const input = ref('')
const n = ref(2)
const tokens = computed(() => input.value.trim().split(/\s+/).filter(Boolean))
const history = computed(() => [BOS, BOS, ...tokens.value])
const pred = computed(() => predict(history.value, n.value))
const top = computed(() => pred.value.dist.slice(0, 8))
const maxP = computed(() => (top.value.length ? top.value[0][1] / pred.value.total : 1))

function append(w: string) {
  if (w === EOS) return
  input.value = [...tokens.value, w].join(' ')
}
function undo() {
  input.value = tokens.value.slice(0, -1).join(' ')
}

// ---------- 自动续写 ----------
const temp = ref(1)
const gen = ref<{ w: string; k: number }[]>([])
const genEnded = ref(false)
const genPrefix = ref<string[]>([])
const genId = ref(0)
function sample(dist: [string, number][], total: number, T: number) {
  const ws = dist.map(([, c]) => Math.pow(c / total, 1 / T))
  const sum = ws.reduce((s, x) => s + x, 0)
  let r = Math.random() * sum
  for (let i = 0; i < ws.length; i++) {
    r -= ws[i]
    if (r <= 0) return dist[i][0]
  }
  return dist[dist.length - 1][0]
}
function generate() {
  const h = [...history.value]
  const out: { w: string; k: number }[] = []
  let ended = false
  for (let step = 0; step < 15; step++) {
    const p = predict(h, n.value)
    const w = sample(p.dist, p.total, temp.value)
    if (w === EOS) { ended = true; break }
    out.push({ w, k: p.k + 1 })
    h.push(w)
  }
  genPrefix.value = [...tokens.value]
  gen.value = out
  genEnded.value = ended
  genId.value++
}
function acceptGen() {
  input.value = [...genPrefix.value, ...gen.value.map((x) => x.w)].join(' ')
  gen.value = []
  genId.value = 0
}
</script>

<template>
  <div class="demo">
    <div class="demo-title">预测下一个词:迷你 n-gram 语言模型</div>
    <p class="demo-desc">
      在框里输入几个词(词之间用空格隔开),或直接点下面的候选词;看看模型觉得下一个词最可能是什么,再让它"自动续写"一句话。
    </p>

    <div class="demo-controls">
      <input v-model="input" type="text" class="inp" placeholder="例如:今天 天气" />
      <button class="btn ghost" :disabled="!tokens.length" @click="undo">删掉最后一个词</button>
      <button class="btn ghost" :disabled="!tokens.length" @click="input = ''">清空</button>
    </div>
    <div class="demo-controls">
      <span class="lbl">模型看前几个词:</span>
      <label v-for="k in [1, 2, 3]" :key="k">
        <input v-model="n" type="radio" :value="k" />
        {{ k }} 元(看前 {{ k - 1 }} 个词)
      </label>
    </div>

    <div class="ctx">
      <template v-if="pred.k > 0">
        根据前 {{ pred.k }} 个词 <span class="key">{{ showKey(pred.key) }}</span>,下一个词可能是:
      </template>
      <template v-else>不看任何上下文,只按每个词在语料里出现的次数来猜:</template>
      <span class="used">用了 {{ pred.k + 1 }} 元</span>
    </div>
    <div v-if="pred.missed.length && n > 1" class="warn">
      ⚠️ 没见过这个组合!语料里从没出现过
      <span v-for="m in pred.missed.filter((x) => x)" :key="m" class="key">{{ showKey(m) }}</span>
      后面跟着什么词,只好<b>回退</b>到更短的上下文({{ pred.k + 1 }} 元)。
    </div>

    <div class="bars">
      <button
        v-for="[w, cnt] in top"
        :key="w"
        class="row"
        :class="{ end: w === EOS }"
        :title="w === EOS ? '句子在这里结束' : '点击把这个词接到输入后面'"
        @click="append(w)"
      >
        <span class="w">{{ show(w) }}</span>
        <span class="track">
          <span class="fill" :style="{ width: (cnt / pred.total / maxP) * 100 + '%' }"></span>
        </span>
        <span class="pct">{{ ((cnt / pred.total) * 100).toFixed(1) }}%</span>
        <span class="cnt">{{ cnt }} 次</span>
      </button>
    </div>
    <div class="demo-stat">
      这个上下文后面共出现过 <b>{{ pred.total }}</b> 次,有 <b>{{ pred.dist.length }}</b> 种不同的下一个词{{ pred.dist.length > 8 ? '(只显示前 8 个)' : '' }}。
      语料一共 {{ SENTS.length }} 句、{{ WORD_COUNT }} 个词。
    </div>

    <div class="gen-box">
      <div class="demo-controls">
        <label>
          温度 {{ temp.toFixed(1) }}
          <input v-model.number="temp" type="range" min="0.2" max="2" step="0.1" />
        </label>
        <button class="btn" @click="generate">🎲 自动续写</button>
        <button v-if="gen.length" class="btn ghost" @click="acceptGen">把续写接到输入框</button>
      </div>
      <div v-if="genId > 0" :key="genId" class="gen">
        <span v-for="(t, i) in genPrefix" :key="'in' + i" class="tok given">{{ t }}</span>
        <span
          v-for="(t, i) in gen"
          :key="i"
          class="tok new"
          :style="{ animationDelay: i * 0.15 + 's' }"
          :title="'用了 ' + t.k + ' 元'"
        >{{ t.w }}<sub>{{ t.k }}</sub></span>
        <span class="tok stop" :style="{ animationDelay: gen.length * 0.15 + 's' }">
          {{ genEnded ? '〈句末〉' : '…(到 15 个词上限)' }}
        </span>
      </div>
      <div v-if="genId > 0" class="demo-stat">灰色是你给的开头,彩色是模型逐词抽出来的;小数字表示这一步用了几元。温度低更保守,温度高更"放飞"。</div>
    </div>

    <p class="demo-note">
      💡 观察:选 1 元时模型完全不看前文,续写出来是一堆乱词;选 2、3 元时,句子越来越"像样"。
      但 n 越大,没见过的组合也越多(试试输入"我 喜欢 吃 猫"),只好回退。手机输入法的"联想下一个词"就是这种思想。
      今天的大模型做的也是"预测下一个词",只不过它看的上下文长得多(几千上万个词),学得也细致得多,不是简单地数次数。
    </p>
  </div>
</template>

<style scoped>
.inp {
  width: 260px;
}
.lbl {
  color: var(--vp-c-text-2);
}
.ctx {
  margin: 8px 0 6px;
  color: var(--vp-c-text-1);
}
.key {
  display: inline-block;
  padding: 0 6px;
  margin: 0 2px;
  border-radius: 4px;
  background: var(--demo-canvas-bg);
  border: 1px solid var(--demo-border);
  font-weight: 600;
}
.used {
  margin-left: 8px;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--demo-accent);
  color: var(--demo-accent);
}
.warn {
  margin: 6px 0;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--demo-bad);
  color: var(--demo-bad);
  font-size: 13.5px;
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 560px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  color: var(--vp-c-text-1);
  text-align: left;
}
.row:hover {
  border-color: var(--demo-accent);
}
.row.end {
  cursor: default;
  color: var(--demo-muted);
}
.row.end:hover {
  border-color: transparent;
}
.w {
  width: 72px;
  flex-shrink: 0;
  font-weight: 600;
}
.track {
  flex: 1;
  height: 14px;
  border-radius: 7px;
  background: var(--demo-border);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--demo-accent);
  transition: width 0.3s;
}
.row.end .fill {
  background: var(--demo-muted);
}
.pct,
.cnt {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.pct {
  width: 48px;
  text-align: right;
}
.cnt {
  width: 40px;
}
.gen-box {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px dashed var(--demo-border);
}
.gen {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0;
}
.tok {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--demo-border);
  background: var(--demo-canvas-bg);
  color: var(--vp-c-text-1);
}
.tok.given {
  color: var(--demo-muted);
}
.tok.new {
  border-color: var(--demo-accent);
  color: var(--demo-accent);
  font-weight: 600;
}
.tok.new,
.tok.stop {
  opacity: 0;
  animation: pop 0.3s ease forwards;
}
.tok.stop {
  border-style: dashed;
  color: var(--demo-muted);
}
.tok sub {
  font-size: 10px;
  margin-left: 2px;
  color: var(--demo-muted);
  font-weight: 400;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
