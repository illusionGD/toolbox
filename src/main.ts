import 'pixi.js/unsafe-eval';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { initAppState } from './services/appState';
import './assets/styles/tailwind.css';
import './assets/styles/index.scss';

const app = createApp(App);

app.use(createPinia());
app.use(router);

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
