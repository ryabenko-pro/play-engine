import type { LogSource, Observable } from '../store';
import { h } from '../ui';

export function mountConsole(root: HTMLElement, store: Observable & LogSource): void {
  const list = h('div', { class: 'log' });
  root.replaceChildren(
    h('div', { class: 'panel-title' }, 'Output', h('button', { class: 'small', onClick: () => store.clearLogs() }, 'Clear')),
    list,
  );
  const render = () => {
    list.replaceChildren(...store.logs.map((l) => h('div', { class: /error/i.test(l) ? 'err' : '' }, l)));
    list.scrollTop = list.scrollHeight;
  };
  store.subscribe((reason) => {
    if (reason === 'log') render();
  });
  render();
}
