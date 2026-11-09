/* Custom, keyboard-accessible selectors. Hidden selects retain the form data only. */
(() => {
  const controls = new Map();
  let describe = () => ({}), opened = null, sequence = 0;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function content(select, option, compact = false) {
    const info = describe(select, option) || {}, fragment = document.createDocumentFragment();
    if (info.avatar) fragment.append(info.avatar);
    const copy = node('span', 'select-copy');
    copy.append(node('span', 'select-title', info.title || option?.textContent || '暂无可选项'));
    if (!compact && info.description) copy.append(node('span', 'select-description', info.description));
    if (!compact && info.tags?.length) {
      const tags = node('span', 'select-tags');
      info.tags.forEach(tag => tags.append(node('span', '', tag)));
      copy.append(tags);
    }
    fragment.append(copy);
    return fragment;
  }
  function syncOne(select, control) {
    const option = select.selectedOptions[0];
    const signature = `${select.value}|${option?.textContent}|${select.options.length}`;
    if (signature !== control.signature) {
      control.signature = signature;
      control.button.replaceChildren(content(select, option, true), node('span', 'select-chevron'));
    }
    control.button.disabled = select.disabled;
    control.button.setAttribute('aria-label', `${control.label}：${option?.textContent || '暂无可选项'}`);
    if (opened?.select === select && (select.disabled || !select.isConnected)) close(false);
  }
  function mount(select) {
    if (controls.has(select)) return;
    const wrapper = node('span', 'custom-select'), button = node('button', 'select-trigger');
    const id = select.id || `studio-select-${++sequence}`;
    const labels = [...(select.labels || [])];
    const label = select.getAttribute('aria-label') || (labels[0] && [...labels[0].childNodes].filter(item => item.nodeType === 3).map(item => item.textContent).join('').trim()) || '选择';
    button.type = 'button'; button.id = `${id}-trigger`;
    button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    labels.forEach(item => { item.htmlFor = button.id; });
    select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    select.before(wrapper); wrapper.append(select, button);
    const control = { wrapper, button, label };
    controls.set(select, control); syncOne(select, control);
    button.addEventListener('click', () => opened?.select === select ? close() : open(select, control));
    button.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); open(select, control, event.key);
      }
    });
    select.addEventListener('change', sync); select.addEventListener('input', sync);
  }
  function close(restore = true) {
    if (!opened) return;
    const { panel, control } = opened;
    opened = null; panel.remove(); control.button.setAttribute('aria-expanded', 'false');
    if (restore && control.button.isConnected) control.button.focus({ preventScroll: true });
  }
  function position() {
    if (!opened) return;
    const { control, panel } = opened, rect = control.button.getBoundingClientRect();
    if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) { close(false); return; }
    const width = Math.min(Math.max(rect.width, panel.classList.contains('rich') ? 330 : 250), innerWidth - 24);
    panel.style.width = `${width}px`;
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16;
    const upward = below < Math.min(300, panel.scrollHeight) && above > below;
    panel.style.maxHeight = `${Math.max(100, Math.min(420, upward ? above : below))}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    panel.style.top = upward ? 'auto' : `${rect.bottom + 6}px`;
    panel.style.bottom = upward ? `${innerHeight - rect.top + 6}px` : 'auto';
  }
  function open(select, control, initialKey) {
    close(false);
    if (select.disabled) return;
    const panel = node('div', 'select-popover'), list = node('div', 'select-list');
    list.id = `${control.button.id}-list`; list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', control.label); list.tabIndex = 0;
    control.button.setAttribute('aria-controls', list.id); control.button.setAttribute('aria-expanded', 'true');
    panel.append(node('div', 'select-heading', control.label));
    const searchable = select.options.length > 8;
    const search = searchable ? node('input', 'select-search') : null;
    if (search) {
      search.type = 'search'; search.placeholder = '搜索名称、风格或标签';
      search.setAttribute('role', 'combobox'); search.setAttribute('aria-controls', list.id); search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-autocomplete', 'list');
      search.setAttribute('aria-label', `搜索${control.label}`); panel.append(search);
    }
    panel.append(list);
    // A popup inside a modal belongs to that modal's top layer and focus scope.
    (control.button.closest('dialog[open]') || document.body).append(panel);
    opened = { select, control, panel };
    let entries = [], active = -1;
    function highlight(index) {
      if (!entries.length) { active = -1; list.removeAttribute('aria-activedescendant'); search?.removeAttribute('aria-activedescendant'); return; }
      active = (index + entries.length) % entries.length;
      entries.forEach((entry, i) => entry.element.classList.toggle('highlighted', i === active));
      const target = entries[active].element;
      list.setAttribute('aria-activedescendant', target.id);
      search?.setAttribute('aria-activedescendant', target.id);
      target.scrollIntoView({ block: 'nearest' });
    }
    function choose(option) {
      const value = option.value;
      close(); select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      // Script rows may be rebuilt by the change handler.
      if (!control.button.isConnected) document.getElementById(control.button.id)?.focus({ preventScroll: true });
    }
    function render() {
      list.replaceChildren(); entries = [];
      const query = (search?.value || '').trim().toLowerCase();
      [...select.options].forEach((option, index) => {
        if (option.disabled || option.hidden) return;
        const info = describe(select, option) || {};
        if (!`${option.textContent} ${info.description || ''} ${(info.tags || []).join(' ')}`.toLowerCase().includes(query)) return;
        const item = node('div', 'select-option'); item.id = `${list.id}-${index}`;
        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
        if (info.avatar) panel.classList.add('rich');
        item.append(content(select, option), node('span', option.selected ? 'select-check selected' : 'select-check'));
        item.addEventListener('click', () => choose(option));
        entries.push({ option, element: item }); list.append(item);
      });
      if (!entries.length) list.append(node('div', 'select-empty', select.options.length ? '没有匹配的选项，试试其他关键词' : '暂无可选项'));
      position();
      const selected = entries.findIndex(entry => entry.option.selected);
      highlight(initialKey === 'End' || initialKey === 'ArrowUp' && selected < 0 ? entries.length - 1 : initialKey === 'Home' ? 0 : Math.max(0, selected));
    }
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Tab') close();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); highlight(event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : active + (event.key === 'ArrowUp' ? -1 : 1));
      } else if (event.key === 'Enter' || event.key === ' ' && !search) {
        event.preventDefault(); if (entries[active]) choose(entries[active].option);
      }
    });
    search?.addEventListener('input', render);
    render(); (search || list).focus({ preventScroll: true });
  }
  function sync() {
    document.querySelectorAll('select').forEach(mount);
    controls.forEach((control, select) => {
      if (!select.isConnected) { if (opened?.select === select) close(false); controls.delete(select); }
      else syncOne(select, control);
    });
  }
  window.CustomSelects = {
    init(describeOption) {
      describe = describeOption; sync();
      new MutationObserver(records => {
        if (records.some(record => record.target.closest?.('select') || [...record.addedNodes].some(item => item.nodeType === 1 && (item.matches('select') || item.querySelector('select'))))) sync();
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
      document.addEventListener('pointerdown', event => {
        if (opened && !opened.panel.contains(event.target) && !opened.control.wrapper.contains(event.target)) close(false);
      });
      document.addEventListener('scroll', event => { if (opened && !opened.panel.contains(event.target)) position(); }, true);
      window.addEventListener('resize', () => close(false));
    }, sync, close
  };
})();
