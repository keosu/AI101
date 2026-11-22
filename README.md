# 《AI 到底是怎么学会的?》——从一杯奶茶到大模型的人工智能之旅

一本通俗易懂的 AI 科普读物,同时是一个可以直接阅读的网站:14 章正文 + 14 个浏览器里运行的互动演示。

## 本地阅读

需要 Node.js(建议 18 以上)。

```bash
npm install        # 第一次需要
npm run dev        # 开发模式,浏览器打开终端里显示的地址
npm run build      # 构建静态网站,输出到 docs/.vitepress/dist
npm run preview    # 预览构建结果
```

构建出来的 `docs/.vitepress/dist` 是纯静态文件,可以放到任何静态托管服务(GitHub Pages、Netlify、Vercel、学校服务器等)。如果部署在子路径下,请修改 `docs/.vitepress/config.mts` 里的 `base`。

## 目录结构

```
docs/
  index.md              首页
  preface.md            序言
  ch01.md ... ch14.md   正文章节(每章一个 Markdown 文件)
  glossary.md           术语小词典
  .vitepress/
    config.mts          站点配置(侧边栏、搜索、mermaid)
    theme/
      index.ts          自动注册 components/ 下所有 Vue 组件
      custom.css        主题与演示通用样式
      components/       互动演示组件(.vue)
```

## 互动演示一览

在 Markdown 里直接写组件标签即可嵌入,例如 `<GradientDescent />`。

| 组件 | 所在章节 |
|---|---|
| GradientDescent | 第 2 章 |
| Overfitting | 第 3 章 |
| NeuronDemo、NNPlayground | 第 4 章 |
| ConvDemo、DigitRecognizer | 第 5 章 |
| SoundSpectrum | 第 6 章 |
| WordMap、NextWordDemo | 第 7 章 |
| GridWorldQ | 第 8 章 |
| RecommenderDemo | 第 9 章 |
| AttentionDemo、TokenizerDemo、StepGenDemo | 第 10 章 |

新增演示:在 `docs/.vitepress/theme/components/` 下放一个 `.vue` 文件,根元素用 `<div class="demo">`,然后在任意 Markdown 里用文件名当标签。组件需要保证 SSR 安全(浏览器 API 只在 `onMounted` 或事件里访问)。
