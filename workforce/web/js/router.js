// Hash router: #/team, #/invite?token=… Pages declare whether they need a
// signed-in user and which permission they need.
import { MOTION } from './ui.js';

const routes = new Map();
const ORDER = [];
let renderFn = null;
let current = null;

export function route(path, page) {
  routes.set(path, page);
  ORDER.push(path);
}

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path, query: new URLSearchParams(query) };
}

export const currentPath = () => current;

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) return render();
  if (replace) {
    history.replaceState(null, '', target);
    return render();
  }
  location.hash = target;
}

export function start(fn) {
  renderFn = fn;
  addEventListener('hashchange', render);
  return render();
}

export function render() {
  const { path, query } = parseHash();
  const page = routes.get(path) || null;
  const prev = current;
  current = path;
  const back = ORDER.indexOf(path) < ORDER.indexOf(prev);
  document.documentElement.dataset.nav = back ? 'back' : 'fwd';
  // Pages draw their skeleton synchronously and load data afterwards, so the
  // transition never waits on the network.
  const run = () => renderFn(page, { path, query, prev });
  if (prev && prev !== path && document.startViewTransition && !MOTION.reduced) {
    document.startViewTransition(run);
    return;
  }
  return run();
}
