// Menu screens navigable by controller (stick + tilt + click), keyboard and mouse.
import { OPTIONS, getSetting, setSetting } from './settings.js';

export class Menus {
  constructor({ onAction, onChange, onNavigate }) {
    this.onAction = onAction;
    this.onChange = onChange;
    this.onNavigate = onNavigate;
    this.stack = [];
    this.current = null;
    this.focusIndex = 0;

    for (const el of document.querySelectorAll('.mi')) {
      el.addEventListener('mouseenter', () => this.focusElement(el));
      el.addEventListener('click', (e) => {
        if (el.classList.contains('input-row')) {
          el.querySelector('input')?.focus();
          return;
        }
        e.preventDefault();
        this.focusElement(el);
        this.activate(el, e.clientX < el.getBoundingClientRect().left + el.offsetWidth * 0.5 && el.classList.contains('sel') ? -1 : 1);
      });
    }
    for (const input of document.querySelectorAll('.input-row input')) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') input.blur();
      });
    }
    this.refresh();
  }

  get screenId() {
    return this.current?.id ?? null;
  }

  show(id, { push = true, reset = false } = {}) {
    if (reset) this.stack = [];
    if (push && this.current && this.current.id !== id) this.stack.push(this.current.id);
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
    this.current = id ? document.getElementById(id) : null;
    this.focusIndex = 0;
    this.refresh();
    this.updateFocus();
  }

  hide() {
    this.show(null, { push: false, reset: true });
  }

  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev, { push: false });
    return !!prev;
  }

  items() {
    if (!this.current) return [];
    return [...this.current.querySelectorAll('.mi')].filter((el) => el.offsetParent !== null);
  }

  focusElement(el) {
    const i = this.items().indexOf(el);
    if (i >= 0) {
      this.focusIndex = i;
      this.updateFocus();
    }
  }

  updateFocus() {
    const items = this.items();
    items.forEach((el, i) => el.classList.toggle('focus', i === this.focusIndex));
    items[this.focusIndex]?.scrollIntoView({ block: 'nearest' });
  }

  // Controller / keyboard navigation events.
  handle(ev) {
    const items = this.items();
    if (!items.length) return;
    const el = items[this.focusIndex];
    if (ev === 'up' || ev === 'down') {
      this.focusIndex = (this.focusIndex + (ev === 'up' ? -1 : 1) + items.length) % items.length;
      document.activeElement?.blur?.();
      this.updateFocus();
      this.onNavigate?.();
    } else if ((ev === 'left' || ev === 'right') && el?.classList.contains('sel')) {
      this.cycle(el, ev === 'left' ? -1 : 1);
    } else if (ev === 'select' && el) {
      this.activate(el, 1);
    } else if (ev === 'back') {
      if (this.back()) this.onNavigate?.();
    }
  }

  activate(el, dir) {
    if (el.classList.contains('sel')) {
      this.cycle(el, dir);
    } else if (el.classList.contains('input-row')) {
      el.querySelector('input')?.focus();
    } else if (el.dataset.action) {
      this.onNavigate?.();
      if (el.dataset.action === 'back') this.back();
      else this.onAction(el.dataset.action, el);
    }
  }

  cycle(el, dir) {
    const key = el.dataset.key;
    const opts = OPTIONS[key];
    const cur = getSetting(key);
    let i = opts.findIndex((o) => o.value === cur);
    if (i < 0) i = 0;
    i = (i + dir + opts.length) % opts.length;
    setSetting(key, opts[i].value);
    this.refresh();
    this.onNavigate?.();
    this.onChange?.(key, opts[i].value);
  }

  // Update the text of every selector from the current settings.
  refresh() {
    for (const el of document.querySelectorAll('.mi.sel')) {
      const opts = OPTIONS[el.dataset.key];
      const cur = getSetting(el.dataset.key);
      const opt = opts.find((o) => o.value === cur) ?? opts[0];
      el.querySelector('.val').textContent = opt.label;
    }
  }
}

let toastTimer = 0;
export function toast(text, { error = false, ms = 3000 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
