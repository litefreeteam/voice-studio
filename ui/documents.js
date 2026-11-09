/* Native XML parsing keeps Office text import available before installing voices. */
window.OfficeDocuments = {
  parse({ extension, parts }) {
    const xml = name => {
      if (!parts[name]) throw Error('文档缺少必要内容：' + name);
      const source = parts[name];
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw Error('文档包含不受支持的 XML 定义');
      const doc = new DOMParser().parseFromString(source, 'application/xml');
      if (doc.querySelector('parsererror')) throw Error('文档内容损坏，请另存后重试');
      return doc;
    };
    const elements = (parent, tag) => [...parent.getElementsByTagNameNS('*', tag)];
    const paragraphs = parent => elements(parent, 'p').map(p => {
      // Nested text-box paragraphs are extracted separately, once per paragraph.
      const walk = node => [...node.childNodes].map(child => child.nodeType !== 1 ? '' : ['t', 'delText'].includes(child.localName) ? child.localName === 't' ? child.textContent : '' : child.localName === 'tab' ? '\t' : ['br', 'cr'].includes(child.localName) ? '\n' : ['del', 'p'].includes(child.localName) ? '' : walk(child)).join('');
      return walk(p).trim();
    }).filter(Boolean).join('\n');
    const resolve = (base, target) => {
      if (!target || /[\\?#]|^[a-z]+:/i.test(target)) throw Error('文档包含不受支持的内容链接');
      const path = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
      for (const part of target.split('/')) { if (part === '..') { if (!path.length) throw Error('文档内容链接无效'); path.pop(); } else if (part && part !== '.') path.push(part); }
      return path.join('/');
    };
    const relationships = base => {
      const path = base.split('/'), file = path.pop(); path.push('_rels', file + '.rels');
      return parts[path.join('/')] ? elements(xml(path.join('/')), 'Relationship').filter(rel => rel.getAttribute('TargetMode') !== 'External') : [];
    };
    let text, note;
    if (extension === '.docx') {
      text = paragraphs(xml('word/document.xml')); note = '已提取 Word 正文和表格文字；图片中的文字不会导入。';
    } else {
      const base = 'ppt/presentation.xml', rels = relationships(base), slides = elements(xml(base), 'sldId');
      if (slides.length > 200) throw Error('一次最多导入 200 页课件，请拆分后导入');
      let notes = 0, fallback = 0, empty = 0;
      text = slides.map((slide, index) => {
        const id = [...slide.attributes].find(attr => attr.localName === 'id' && attr.prefix)?.value;
        const relation = rels.find(rel => rel.getAttribute('Id') === id); if (!relation) throw Error('课件页面顺序信息不完整');
        const file = resolve(base, relation.getAttribute('Target'));
        const notesRel = relationships(file).find(rel => /\/notesSlide$/.test(rel.getAttribute('Type')));
        let content = '';
        if (notesRel) {
          const doc = xml(resolve(file, notesRel.getAttribute('Target')));
          content = elements(doc, 'sp').filter(shape => !elements(shape, 'ph').some(ph => ['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(ph.getAttribute('type')))).map(paragraphs).filter(Boolean).join('\n');
        }
        if (content) notes++;
        else { content = paragraphs(xml(file)); if (content) fallback++; else empty++; }
        return content ? '# 第 ' + (index + 1) + ' 页\n' + content : '';
      }).filter(Boolean).join('\n\n');
      note = '共 ' + slides.length + ' 页：' + notes + ' 页使用备注，' + fallback + ' 页无备注、使用页面文字' + (empty ? '，' + empty + ' 页无可读文字已跳过' : '') + '。图片中的文字不会导入。';
    }
    if (!text.trim()) throw Error('文档没有可读文字。请在 PPTX 备注中填写讲稿，或粘贴文字后导入。');
    if (text.length > 500000) throw Error('一次导入最多 50 万字，请拆分文档');
    return { text, note };
  }
};
