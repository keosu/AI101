<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { ref, watch, onMounted } from 'vue'

// 在默认布局外包一层:在顶部导航栏右侧加一个"大纲"开关。
// 状态保存在 localStorage,下次打开时记住。
const Layout = DefaultTheme.Layout
const { frontmatter } = useData()
const KEY = 'ai101-outline-hidden'
const hidden = ref(false)

onMounted(() => {
  hidden.value = localStorage.getItem(KEY) === '1'
})

watch(hidden, (v) => {
  document.documentElement.classList.toggle('outline-hidden', v)
  localStorage.setItem(KEY, v ? '1' : '0')
})
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <button
        v-if="frontmatter.layout !== 'home'"
        class="outline-toggle"
        type="button"
        :aria-pressed="!hidden"
        :title="hidden ? '显示右侧章节大纲' : '隐藏右侧章节大纲'"
        @click="hidden = !hidden"
      >
        <span class="outline-dot" :class="{ off: hidden }" />
        {{ hidden ? '显示大纲' : '隐藏大纲' }}
      </button>
    </template>
  </Layout>
</template>
