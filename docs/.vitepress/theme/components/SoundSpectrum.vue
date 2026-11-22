<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

type Mode = 'tone' | 'chord' | 'ah' | 'ee' | 'mic'
const MODES: { id: Mode; name: string }[] = [
  { id: 'tone', name: '纯音' },
  { id: 'chord', name: '和弦' },
  { id: 'ah', name: '元音"啊"' },
  { id: 'ee', name: '元音"衣"' },
  { id: 'mic', name: '麦克风' }
]
// 元音:[共振峰频率, 增益]
const VOWELS: Record<string, [number, number][]> = {
  ah: [[800, 3], [1200, 3]],
  ee: [[300, 2], [2300, 7]]
}
const F0 = 120 // 元音基频
const FMAX = 4000 // 频谱显示上限
const W = 640
const WAVE_H = 140
const SPEC_H = 180
const GRAM_H = 200
const L = 44 // 左侧标签区宽度
const SPAN = 1024 // 波形显示的采样点数

const mode = ref<Mode>('tone')
const freq = ref(440)
const chord = ref([262, 330, 392])
const volume = ref(0.15)
const playing = ref(false)
const starting = ref(false)
const errorMsg = ref('')

const waveCv = ref<HTMLCanvasElement | null>(null)
const specCv = ref<HTMLCanvasElement | null>(null)
const gramCv = ref<HTMLCanvasElement | null>(null)

let ac: AudioContext | null = null
let analyser: AnalyserNode | null = null
let master: GainNode | null = null
let oscs: OscillatorNode[] = []
let nodes: AudioNode[] = []
let micStream: MediaStream | null = null
let raf = 0
let token = 0
let timeBuf = new Float32Array(0)
let freqBuf = new Uint8Array(0)
let gramCol: ImageData | null = null

// 颜色表:深蓝 → 紫 → 橙 → 黄
const LUT = (() => {
  const stops: [number, number[]][] = [
    [0, [8, 12, 48]],
    [0.35, [70, 30, 140]],
    [0.65, [225, 85, 60]],
    [1, [255, 235, 90]]
  ]
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, c0] = stops[k]
    const [t1, c1] = stops[k + 1]
    const u = (t - t0) / (t1 - t0)
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u
  }
  return lut
})()

// ---------- 声音 ----------
function buildSynth(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime
  const env = ctx.createGain() // 淡入,避免"咔哒"声
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(1, t + 0.05)
  env.connect(dest)
  nodes.push(env)
  const addOsc = (type: OscillatorType, f: number, gain: number, to: AudioNode) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    const g = ctx.createGain()
    g.gain.value = gain
    o.connect(g)
    g.connect(to)
    oscs.push(o)
    nodes.push(g)
    return o
  }
  if (mode.value === 'tone') addOsc('sine', freq.value, 0.8, env)
  else if (mode.value === 'chord') chord.value.forEach((f) => addOsc('sine', f, 0.3, env))
  else {
    // 锯齿波(声带)经过两个带通滤波器(声道共振峰)
    const src = ctx.createOscillator()
    src.type = 'sawtooth'
    src.frequency.value = F0
    oscs.push(src)
    for (const [f, gain] of VOWELS[mode.value]) {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = 8
      const g = ctx.createGain()
      g.gain.value = gain
      src.connect(bp)
      bp.connect(g)
      g.connect(env)
      nodes.push(bp, g)
    }
  }
  oscs.forEach((o) => o.start())
}

async function start() {
  if (playing.value || starting.value) return
  errorMsg.value = ''
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!AC) {
    errorMsg.value = '你的浏览器不支持 Web Audio API,换个新一点的浏览器试试吧。'
    return
  }
  const my = ++token
  const ctx: AudioContext = new AC()
  ac = ctx
  ctx.resume?.()
  analyser = ctx.createAnalyser()
  analyser.fftSize = 4096
  analyser.smoothingTimeConstant = 0.5
  analyser.minDecibels = -95
  analyser.maxDecibels = -20
  master = ctx.createGain()
  master.gain.value = volume.value
  master.connect(ctx.destination)
  timeBuf = new Float32Array(analyser.fftSize)
  freqBuf = new Uint8Array(analyser.frequencyBinCount)

  if (mode.value === 'mic') {
    starting.value = true
    try {
      const md = navigator.mediaDevices
      if (!md || !md.getUserMedia) throw { name: 'Unsupported' }
      const stream = await md.getUserMedia({ audio: true })
      if (my !== token) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      micStream = stream
      const src = ctx.createMediaStreamSource(stream)
      src.connect(analyser) // 只接分析器,不接扬声器,避免啸叫
      nodes.push(src)
    } catch (e: any) {
      if (my !== token) return
      stop()
      const n = e && e.name
      errorMsg.value =
        n === 'NotAllowedError' || n === 'SecurityError'
          ? '麦克风权限被拒绝了。可以在浏览器地址栏旁的权限设置里允许麦克风后再试。'
          : n === 'NotFoundError'
            ? '没有找到麦克风设备。'
            : '当前环境无法使用麦克风(需要 HTTPS 或 localhost,并且浏览器支持)。其他模式仍可正常使用。'
      return
    } finally {
      if (my === token) starting.value = false
    }
  } else {
    analyser.connect(master)
    buildSynth(ctx, analyser)
  }
  playing.value = true
  loop()
}

function stop() {
  token++
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  for (const o of oscs) {
    try {
      o.stop()
    } catch {}
    o.disconnect()
  }
  for (const n of nodes) n.disconnect()
  analyser?.disconnect()
  master?.disconnect()
  micStream?.getTracks().forEach((t) => t.stop())
  if (ac) ac.close().catch(() => {})
  oscs = []
  nodes = []
  micStream = null
  analyser = null
  master = null
  ac = null
  playing.value = false
  starting.value = false
}

function toggle() {
  if (playing.value || starting.value) stop()
  else start()
}

// 切换模式:先停再启
watch(mode, () => {
  errorMsg.value = ''
  if (playing.value || starting.value) {
    stop()
    start()
  }
})
watch(freq, (f) => {
  if (ac && mode.value === 'tone' && oscs[0]) oscs[0].frequency.setTargetAtTime(f, ac.currentTime, 0.02)
})
watch(
  chord,
  (fs) => {
    if (ac && mode.value === 'chord') oscs.forEach((o, i) => o.frequency.setTargetAtTime(fs[i], ac!.currentTime, 0.02))
  },
  { deep: true }
)
watch(volume, (v) => {
  if (ac && master) master.gain.setTargetAtTime(v, ac.currentTime, 0.03)
})

// ---------- 绘制 ----------
function textColor(cv: HTMLCanvasElement) {
  return getComputedStyle(cv).color || '#888'
}

function drawWave(active: boolean) {
  const cv = waveCv.value
  if (!cv) return
  const c = cv.getContext('2d')!
  const fg = textColor(cv)
  c.clearRect(0, 0, W, WAVE_H)
  c.strokeStyle = fg
  c.globalAlpha = 0.25
  c.beginPath()
  c.moveTo(0, WAVE_H / 2 + 0.5)
  c.lineTo(W, WAVE_H / 2 + 0.5)
  c.stroke()
  c.globalAlpha = 1
  c.fillStyle = fg
  c.font = '12px sans-serif'
  c.textBaseline = 'top'
  c.textAlign = 'left'
  const ms = ac ? ((SPAN / ac.sampleRate) * 1000).toFixed(0) : '21'
  c.fillText(`波形(时域,横轴约 ${ms} 毫秒)`, 6, 6)
  if (!active) {
    c.textAlign = 'center'
    c.fillText('点击"播放"开始', W / 2, WAVE_H / 2 + 8)
    return
  }
  // 找一个上升过零点,让波形看起来稳定
  let s0 = 0
  for (let i = 1; i < timeBuf.length - SPAN; i++)
    if (timeBuf[i - 1] < 0 && timeBuf[i] >= 0) {
      s0 = i
      break
    }
  c.strokeStyle = '#6366f1'
  c.lineWidth = 2
  c.beginPath()
  for (let k = 0; k < SPAN; k++) {
    const v = Math.max(-1.1, Math.min(1.1, timeBuf[s0 + k]))
    const x = (k / (SPAN - 1)) * W
    const y = WAVE_H / 2 - v * WAVE_H * 0.42
    if (k === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.stroke()
}

function drawSpec(active: boolean) {
  const cv = specCv.value
  if (!cv) return
  const c = cv.getContext('2d')!
  const fg = textColor(cv)
  const top = 22, bottom = SPEC_H - 22
  const pw = W - L - 10
  const ph = bottom - top
  c.clearRect(0, 0, W, SPEC_H)
  c.fillStyle = fg
  c.font = '12px sans-serif'
  c.textBaseline = 'top'
  c.textAlign = 'left'
  c.fillText('实时频谱(频域):横轴是频率,柱子越高这个频率的能量越强', 6, 4)
  if (active && ac) {
    const binHz = ac.sampleRate / (freqBuf.length * 2)
    const nb = Math.floor(FMAX / binHz)
    const bw = pw / nb
    c.fillStyle = '#10b981'
    for (let i = 0; i < nb; i++) {
      const h = (freqBuf[i] / 255) * ph
      if (h > 0.5) c.fillRect(L + i * bw, bottom - h, Math.max(1, bw + 0.3), h)
    }
  } else {
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('点击"播放"开始', L + pw / 2, top + ph / 2)
  }
  // 坐标轴与刻度
  c.strokeStyle = fg
  c.globalAlpha = 0.5
  c.beginPath()
  c.moveTo(L, top)
  c.lineTo(L, bottom + 0.5)
  c.lineTo(L + pw, bottom + 0.5)
  for (let f = 0; f <= FMAX; f += 500) {
    const x = Math.round(L + (f / FMAX) * pw) + 0.5
    c.moveTo(x, bottom)
    c.lineTo(x, bottom + (f % 1000 === 0 ? 6 : 3))
  }
  c.stroke()
  c.globalAlpha = 1
  c.fillStyle = fg
  c.textBaseline = 'top'
  c.textAlign = 'center'
  for (let f = 0; f <= FMAX; f += 1000) c.fillText(f === FMAX ? `${f} Hz` : String(f), L + (f / FMAX) * pw, bottom + 6)
  c.save()
  c.translate(14, top + ph / 2)
  c.rotate(-Math.PI / 2)
  c.textBaseline = 'middle'
  c.fillText('能量', 0, 0)
  c.restore()
}

function drawGramLabels() {
  const cv = gramCv.value
  if (!cv) return
  const c = cv.getContext('2d')!
  c.clearRect(0, 0, L, GRAM_H)
  c.fillStyle = textColor(cv)
  c.font = '11px sans-serif'
  c.textAlign = 'right'
  for (let f = 0; f <= FMAX; f += 1000) {
    const y = GRAM_H - (f / FMAX) * GRAM_H
    c.textBaseline = f === 0 ? 'bottom' : f === FMAX ? 'top' : 'middle'
    c.fillText(f === 0 ? '0 Hz' : `${f / 1000}k`, L - 6, y)
  }
}

function clearGram() {
  const cv = gramCv.value
  if (!cv) return
  const c = cv.getContext('2d')!
  c.fillStyle = `rgb(${LUT[0]},${LUT[1]},${LUT[2]})`
  c.fillRect(L, 0, W - L, GRAM_H)
  drawGramLabels()
}

// 频谱图:整体左移,最新一列画在最右侧
function drawGram() {
  const cv = gramCv.value
  if (!cv || !ac) return
  const c = cv.getContext('2d')!
  const step = 2
  c.drawImage(cv, L + step, 0, W - L - step, GRAM_H, L, 0, W - L - step, GRAM_H)
  if (!gramCol) gramCol = c.createImageData(step, GRAM_H)
  const d = gramCol.data
  const binHz = ac.sampleRate / (freqBuf.length * 2)
  for (let y = 0; y < GRAM_H; y++) {
    const f = (1 - (y + 0.5) / GRAM_H) * FMAX
    const v = freqBuf[Math.min(freqBuf.length - 1, Math.round(f / binHz))]
    for (let sx = 0; sx < step; sx++) {
      const p = (y * step + sx) * 4
      d[p] = LUT[v * 3]
      d[p + 1] = LUT[v * 3 + 1]
      d[p + 2] = LUT[v * 3 + 2]
      d[p + 3] = 255
    }
  }
  c.putImageData(gramCol, W - step, 0)
  drawGramLabels()
}

function loop() {
  if (!analyser) return
  analyser.getFloatTimeDomainData(timeBuf)
  analyser.getByteFrequencyData(freqBuf)
  drawWave(true)
  drawSpec(true)
  drawGram()
  raf = requestAnimationFrame(loop)
}

// 主题切换时,未播放状态下重画静态内容
let themeObs: MutationObserver | null = null
function redrawIdle() {
  if (playing.value) return
  drawWave(false)
  drawSpec(false)
  drawGramLabels()
}

onMounted(() => {
  drawWave(false)
  drawSpec(false)
  clearGram()
  themeObs = new MutationObserver(redrawIdle)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  stop()
  themeObs?.disconnect()
})
</script>

<template>
  <div class="demo">
    <div class="demo-title">声音长什么样:波形、频谱与频谱图</div>
    <p class="demo-desc">选一种声音,点"播放",看看同一个声音在"时间"和"频率"两个角度下分别是什么样子(建议先把电脑音量调小)。</p>

    <div class="demo-controls">
      <label v-for="m in MODES" :key="m.id"><input v-model="mode" type="radio" :value="m.id" /> {{ m.name }}</label>
    </div>
    <div class="demo-controls">
      <button class="btn" @click="toggle">{{ playing ? '停止' : starting ? '等待麦克风…' : '播放' }}</button>
      <label v-if="mode !== 'mic'"
        >音量 <input v-model.number="volume" type="range" min="0" max="0.5" step="0.01" />
        <span class="demo-stat">{{ Math.round(volume * 200) }}%</span></label
      >
      <template v-if="mode === 'tone'">
        <label
          >频率 <input v-model.number="freq" type="range" min="100" max="2000" step="1" />
          <span class="demo-stat"><b>{{ freq }}</b> Hz</span></label
        >
      </template>
      <template v-if="mode === 'chord'">
        <label v-for="(f, i) in chord" :key="i"
          >音 {{ i + 1 }} <input v-model.number="chord[i]" type="range" min="100" max="2000" step="1" class="short" />
          <span class="demo-stat"><b>{{ f }}</b> Hz</span></label
        >
      </template>
      <span v-if="mode === 'ah' || mode === 'ee'" class="demo-stat">
        基频 <b>{{ F0 }}</b> Hz · 共振峰约 <b>{{ VOWELS[mode][0][0] }}</b> Hz 和 <b>{{ VOWELS[mode][1][0] }}</b> Hz
      </span>
      <span v-if="mode === 'mic'" class="demo-stat">对着麦克风说"啊——"和"衣——",比较频谱图(麦克风声音不会从扬声器放出)</span>
    </div>
    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <div class="viz">
      <canvas ref="waveCv" :width="W" :height="WAVE_H"></canvas>
      <canvas ref="specCv" :width="W" :height="SPEC_H"></canvas>
      <div class="gram-label">频谱图(横轴:时间,向左滚动;纵轴:频率,低音在下;越亮能量越强)</div>
      <canvas ref="gramCv" :width="W" :height="GRAM_H"></canvas>
    </div>

    <p class="demo-note">
      观察:"纯音"在频谱和频谱图上只有<b>一条</b>亮线;"和弦"有<b>三条</b>,正好对应三个频率。"元音 啊"和"元音 衣"的基频一样,听起来却不同——因为能量集中的位置(共振峰)不同:"啊"的亮带集中在中间偏低处,"衣"则一条很低、一条很高。
      语音识别模型做的事,本质上就是在"看"这样的频谱图,从亮带的位置和变化里认出说的是什么。
    </p>
  </div>
</template>

<style scoped>
.viz {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.viz canvas {
  width: 100%;
  height: auto;
}
.gram-label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}
.err {
  color: var(--demo-bad);
  font-size: 13px;
  margin: 4px 0;
}
input.short {
  width: 110px;
}
</style>
