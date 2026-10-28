import { render } from 'preact';
import { App } from './ui/App.jsx';
import { init } from './app/store.js';
import './styles.css';

render(<App />, document.getElementById('app'));
init();
