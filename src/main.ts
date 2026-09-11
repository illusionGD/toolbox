import 'pixi.js/unsafe-eval';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import AiPanelWindow from './components/ai/AiPanelWindow.vue';
import PetWindow from './components/pet/PetWindow.vue';
import { router } from './router';
import { initAppState } from './services/appState';
import './assets/styles/tailwind.css';
import './assets/styles/index.scss';

/**
 * 这一份渲染进程是哪个窗口。
 *
 * AI 对话与桌宠都是**独立的 BrowserWindow**，但载入的是同一个 `index.html`，只多一个
 * `?ai=1` / `?pet=1`。这样 electron-vite 的 renderer 入口保持一个，不必维护第二、第三
 * 份 html 与 bundle。
 */
const params = new URLSearchParams(location.search);
const isAiWindow = params.get('ai') === '1';
const isPetWindow = params.get('pet') === '1';

const app = createApp(isAiWindow ? AiPanelWindow : isPetWindow ? PetWindow : App);

app.use(createPinia());
// 两个子窗口都只有一件事要做，没有路由；装上 router 反而会因为初始路径匹配不到而报警
if (!isAiWindow && !isPetWindow) app.use(router);

// 挂载前先把应用状态读进内存：主题 store / useToolConfig / usage store 都是同步读，
// 这样它们不必改成异步，主题色也不会先闪一帧默认色。
// catch 必须在 then 之前：存储出任何问题都只该让设置不持久化，绝不能挡住 mount 变白屏。
void initAppState()
  .catch((error: unknown) => {
    console.error('[appState] 初始化异常，仍继续启动：', error);
  })
  .then(() => {
    app.mount('#app');
  });
