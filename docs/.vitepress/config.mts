import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// 导航图标:VitePress 的导航文字支持 HTML
const ico = (paths: string) =>
  `<span class="nav-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`

export default withMermaid(
  defineConfig({
    lang: 'zh-CN',
    title: 'AI 到底是怎么学会的?',
    description: '从一杯奶茶到大模型的人工智能之旅:用故事、比喻和互动演示讲清 AI',
    // 部署到 GitHub Pages 的项目站点时由工作流传入 /仓库名/
    base: process.env.BASE_PATH || '/',
    cleanUrls: true,
    lastUpdated: false,
    head: [['link', { rel: 'icon', href: '/favicon.svg' }]],
    themeConfig: {
      logo: '/favicon.svg',
      siteTitle: 'AI 之旅',
      nav: [
        {
          text: ico('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>') + '开始阅读',
          link: '/preface'
        },
        {
          text: ico('<path d="M9 3h6"/><path d="M10 9V3"/><path d="M14 9V3"/><path d="M8.5 9h7l4.2 11.2a1.6 1.6 0 0 1-1.5 2.1H5.8a1.6 1.6 0 0 1-1.5-2.1z"/><path d="M7.2 14h9.6"/>') + '互动实验室',
          link: '/ch13'
        },
        {
          text: ico('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>') + '术语词典',
          link: '/glossary'
        }
      ],
      sidebar: [
        {
          text: '序章',
          items: [{ text: '从一杯奶茶说起', link: '/preface' }]
        },
        {
          text: '认识智能',
          items: [
            { text: '第 1 章 什么是 AI', link: '/ch01' },
            { text: '第 2 章 什么是算法与模型', link: '/ch02' },
            { text: '第 3 章 机器如何学习', link: '/ch03' },
            { text: '第 4 章 神经网络是怎样炼成的', link: '/ch04' }
          ]
        },
        {
          text: '看听说做',
          items: [
            { text: '第 5 章 让机器会看', link: '/ch05' },
            { text: '第 6 章 让机器会听', link: '/ch06' },
            { text: '第 7 章 让机器会说', link: '/ch07' },
            { text: '第 8 章 让机器会行动', link: '/ch08' }
          ]
        },
        {
          text: '大模型时代',
          items: [
            { text: '第 9 章 AI 为什么这么懂你', link: '/ch09' },
            { text: '第 10 章 Transformer 与大模型', link: '/ch10' },
            { text: '第 11 章 大模型的前世今生', link: '/ch11' },
            { text: '第 12 章 AI 与科学', link: '/ch12' }
          ]
        },
        {
          text: '动手与未来',
          items: [
            { text: '第 13 章 互动实验室', link: '/ch13' },
            { text: '第 14 章 未来、风险与学习路线', link: '/ch14' }
          ]
        },
        {
          text: '附录',
          items: [{ text: '术语小词典', link: '/glossary' }]
        }
      ],
      outline: { level: [2, 3], label: '本页目录' },
      docFooter: { prev: '上一章', next: '下一章' },
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '目录',
      darkModeSwitchLabel: '深色模式',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',
      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
            modal: {
              noResultsText: '没有找到结果',
              resetButtonTitle: '清除',
              footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
            }
          }
        }
      },
      footer: {
        message: '写给对 AI 好奇的你',
        copyright: '书中事实性信息请以最新资料为准'
      }
    },
    mermaid: { theme: 'default' },
    vite: {
      server: { host: '127.0.0.1' },
      // mermaid 11 依赖 fastdom(UMD),需要让 Vite 预打包,否则开发模式下白屏
      optimizeDeps: { include: ['mermaid', 'fastdom'] }
    }
  })
)
