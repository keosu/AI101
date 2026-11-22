<script setup lang="ts">
import { ref, computed } from 'vue'

// 内置小词表:中文词、常用单字、英文词/子词、标点
const VOCAB = [
  // 中文词
  '人工智能', '人工', '智能', '机器学习', '深度学习', '机器', '学习', '神经网络', '神经', '网络',
  '大模型', '模型', '语言', '数据', '计算机', '电脑', '你好', '喜欢', '我们', '你们', '他们',
  '今天', '明天', '天气', '一起', '什么', '为什么', '因为', '所以', '但是', '可以', '没有',
  '知道', '问题', '世界', '文字', '一种', '时候', '非常', '感觉', '学生', '老师', '学校',
  '中国', '北京', '猫咪', '好吃',
  // 常用单字
  '我', '你', '他', '她', '它', '的', '了', '是', '在', '很', '好', '人', '大', '小', '不',
  '吧', '吗', '一', '有', '和', '去', '把', '用', '成', '切', '天', '猫', '狗', '吃', '叫',
  // 英文词与子词
  'hello', 'world', 'the', 'is', 'are', 'and', 'of', 'to', 'in', 'it', 'AI', 'GPT',
  'token', 'ization', 'ing', 'tion', 'un', 'believ', 'able', 'ably', 'interest', 'learn',
  'machine', 'deep', 'model', 'language', 'er', 'est', 'ly', 're', 'pre', 'ed',
  // 标点与空格
  ' ', ',', '.', '!', '?', ':', ';', '，', '。', '！', '？', '、', '：', '；', '“', '”'
]
const VMAP = new Map<string, number>(VOCAB.map((t, i) => [t, 256 + i]))
const MAXLEN = Math.max(...VOCAB.map((t) => Array.from(t).length))

type Tok = { text: string; id: number; inVocab: boolean }
// 贪心"最长匹配":每次从当前位置找词表里最长的那一段
function tokenize(s: string): Tok[] {
  const ch = Array.from(s) // 按字符(而非 UTF-16 单元)切,表情符号也不会被劈开
  const out: Tok[] = []
  let i = 0
  while (i < ch.length) {
    let hit: Tok | null = null
    for (let len = Math.min(MAXLEN, ch.length - i); len >= 1; len--) {
      const sub = ch.slice(i, i + len).join('')
      const key = VMAP.has(sub) ? sub : /^[A-Za-z]+$/.test(sub) ? sub.toLowerCase() : ''
      if (key && VMAP.has(key)) {
        hit = { text: sub, id: VMAP.get(key)!, inVocab: true }
        break
      }
    }
    if (!hit) {
      // 单字符回退:ASCII 用字符编码,其他字符用码位算一个稳定的编号
      const cp = ch[i].codePointAt(0) || 0
      hit = { text: ch[i], id: cp < 128 ? cp : 1000 + (cp % 90000), inVocab: false }
    }
    out.push(hit)
    i += Array.from(hit.text).length
  }
  return out
}

const PRESETS = [
  { label: '中文句子', text: '今天天气很好,我们一起去学习机器学习吧。' },
  { label: '英文长词', text: 'Tokenization is unbelievably interesting!' },
  { label: '中英混合', text: '我用GPT学习神经网络,感觉unbelievable!' },
  { label: '生僻字和表情', text: '龘靐齉,猫咪叫😺' }
]
const text = ref('我喜欢人工智能,unbelievable!')
const toks = computed(() => tokenize(text.value))
const charCount = computed(() => Array.from(text.value).length)

const COLORS = [
  [239, 68, 68], [245, 158, 11], [34, 197, 94], [59, 130, 246],
  [168, 85, 247], [236, 72, 153], [20, 184, 166], [132, 204, 22]
]
function tokStyle(k: number) {
  const [r, g, b] = COLORS[k % COLORS.length]
  return { background: `rgba(${r},${g},${b},0.18)`, borderColor: `rgb(${r},${g},${b})` }
}
const shown = (t: string) => (t === ' ' ? '␣' : t)
</script>

<template>
  <div class="demo">
    <div class="demo-title">Token 切分:模型眼里的"字"</div>
    <p class="demo-desc">在框里随便输入一段文字,看看它会被切成哪些 token(每个彩色小块是一个 token,下面的数字是它的编号)。</p>

    <div class="demo-controls">
      <input v-model="text" type="text" class="inp" placeholder="输入任意中英文" />
    </div>
    <div class="demo-controls">
      <span class="lbl">试试:</span>
      <button v-for="p in PRESETS" :key="p.label" class="btn ghost" @click="text = p.text">{{ p.label }}</button>
    </div>

    <div class="toks">
      <span
        v-for="(t, k) in toks"
        :key="k"
        class="tok"
        :class="{ fallback: !t.inVocab }"
        :style="tokStyle(k)"
        :title="`token 编号:${t.id}${t.inVocab ? '' : '(词表里没有,按单个字符处理)'}`"
      >
        <span class="t">{{ shown(t.text) }}</span>
        <span class="id">{{ t.id }}</span>
      </span>
      <span v-if="!toks.length" class="empty">(输入点什么吧)</span>
    </div>

    <div class="demo-stat">
      字符数 <b>{{ charCount }}</b> / token 数 <b>{{ toks.length }}</b>
      <template v-if="toks.length">
        ,平均每个 token 约 <b>{{ (charCount / toks.length).toFixed(2) }}</b> 个字符
      </template>
    </div>
    <div class="legend">
      <span><i class="solid"></i>实线框:词表里有的词或"子词"</span>
      <span><i class="dashed"></i>虚线框:词表里没有,只好按单个字符切开</span>
      <span>␣ 表示空格</span>
    </div>

    <p class="demo-note">
      💡 观察:"人工智能"整体是一个 token,而 unbelievable 被切成 un + believ + able 三块——token 是模型处理文字的基本单位,
      不一定是完整的词,也不一定是单个字。模型读到的其实是下面那串编号。
      这里用的是一个手写的小词表和"最长匹配"的简化算法;真实的大模型会用 BPE 等算法,从海量文本里自动统计出几万到十几万个 token 的词表。
    </p>
  </div>
</template>

<style scoped>
.inp {
  width: 100%;
  max-width: 520px;
}
.lbl {
  color: var(--vp-c-text-2);
}
.toks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 8px;
  padding: 10px;
  min-height: 56px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background: var(--demo-canvas-bg);
}
.tok {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 2px 6px 1px;
  border: 1.5px solid;
  border-radius: 6px;
  min-width: 26px;
  cursor: default;
}
.tok.fallback {
  border-style: dashed;
}
.tok .t {
  font-size: 16px;
  line-height: 1.4;
  white-space: pre;
  color: var(--vp-c-text-1);
}
.tok .id {
  font-size: 10.5px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
}
.empty {
  color: var(--demo-muted);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--demo-muted);
}
.legend i {
  display: inline-block;
  width: 14px;
  height: 10px;
  margin-right: 4px;
  border: 1.5px solid var(--demo-muted);
  border-radius: 3px;
  vertical-align: -1px;
}
.legend i.dashed {
  border-style: dashed;
}
</style>
