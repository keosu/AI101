import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import './custom.css'

// 自动全局注册 components/ 目录下所有 .vue 组件,
// 这样在 Markdown 里可以直接写 <GradientDescent /> 之类的标签。
const modules = import.meta.glob('./components/*.vue', { eager: true }) as Record<
  string,
  { default: any }
>

// 滚动条自动隐藏:滚动时,或鼠标靠近窗口右边缘时显示,停止后淡出
function setupAutoHideScrollbar() {
  const root = document.documentElement
  let timer: number | undefined
  const show = (ms: number) => {
    root.classList.add('show-scrollbar')
    window.clearTimeout(timer)
    timer = window.setTimeout(() => root.classList.remove('show-scrollbar'), ms)
  }
  // scroll 事件不冒泡,用捕获才能监听到侧边栏、代码块等内部区域的滚动
  document.addEventListener('scroll', () => show(900), { capture: true, passive: true })
  window.addEventListener(
    'mousemove',
    (e) => {
      if (window.innerWidth - e.clientX < 18) show(1200)
    },
    { passive: true }
  )
}

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    for (const path in modules) {
      const name = path.split('/').pop()!.replace(/\.vue$/, '')
      app.component(name, modules[path].default)
    }
    if (typeof window !== 'undefined') setupAutoHideScrollbar()
  }
} satisfies Theme
