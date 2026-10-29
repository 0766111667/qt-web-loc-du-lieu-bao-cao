import { render } from 'preact';
import { App } from './ui/App.jsx';
import { init } from './app/store.js';
import './styles.css';

render(<App />, document.getElementById('app'));
init();

// PWA: chỉ đăng ký ở bản chính thức (không ảnh hưởng `npm run dev`).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker 注册失败', e)));
}
