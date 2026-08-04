const TOKEN_PREFIX = '\u0000';
const TOKEN_SUFFIX = '\u0001';

const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'wbr'
]);

const ALLOWED_ATTRS = new Set(['align', 'alt', 'class', 'colspan', 'height', 'href', 'id', 'rowspan', 'src', 'title', 'width']);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCode(s) {
  return escapeHtml(s).replace(/\t/g, '    ');
}

function safeUrl(url, baseUrl) {
  const trimmed = String(url).trim();
  if (!trimmed) {
    return null;
  }
  if (/^(javascript:|vbscript:|data:)/i.test(trimmed)) {
    return null;
  }
  if (/^(https?:\/\/|mailto:|#)/i.test(trimmed)) {
    return trimmed;
  }
  if (baseUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return baseUrl.replace(/\/+$/, '') + '/' + trimmed.replace(/^\.\//, '');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function sanitizeTag(full, baseUrl) {
  const m = full.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!m) {
    return '';
  }
  const name = m[1].toLowerCase();
  const isClosing = /^<\//.test(full);
  if (!ALLOWED_TAGS.has(name)) {
    return '';
  }
  if (isClosing) {
    return `</${name}>`;
  }
  const isSelfClosing = /\/\s*>$/.test(full);
  const body = full.slice(m[0].length);
  const attrs = [];
  const attrRe = /([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let am;
  while ((am = attrRe.exec(body)) !== null) {
    const key = am[1].toLowerCase();
    if (key.startsWith('on') || key === 'style' || !ALLOWED_ATTRS.has(key)) {
      continue;
    }
    const value = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
    if (key === 'href' || key === 'src') {
      const safe = safeUrl(value, baseUrl);
      if (!safe) {
        continue;
      }
      attrs.push(`${key}="${escapeHtml(safe)}"`);
    } else {
      attrs.push(`${key}="${escapeHtml(value)}"`);
    }
  }
  if (name === 'a') {
    attrs.push('target="_blank" rel="noopener noreferrer"');
  }
  return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${isSelfClosing ? ' /' : ''}>`;
}

function sanitizeHtml(input, baseUrl) {
  let out = '';
  let last = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(input)) !== null) {
    out += escapeHtml(input.slice(last, m.index));
    out += sanitizeTag(m[0], baseUrl);
    last = m.index + m[0].length;
  }
  out += escapeHtml(input.slice(last));
  return out;
}

function renderInline(raw, baseUrl) {
  let s = String(raw);
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `${TOKEN_PREFIX}${tokens.length - 1}${TOKEN_SUFFIX}`;
  };

  TAG_RE.lastIndex = 0;
  s = s.replace(TAG_RE, (m) => {
    const sanitized = sanitizeTag(m, baseUrl);
    return sanitized ? stash(sanitized) : escapeHtml(m);
  });

  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    const safe = safeUrl(src, baseUrl);
    return safe ? stash(`<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" />`) : escapeHtml(m);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, url) => {
    const safe = safeUrl(url, baseUrl);
    return safe ? stash(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`) : escapeHtml(m);
  });
  s = s.replace(/`([^`]+)`/g, (m, c) => stash(`<code>${c}</code>`));
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(new RegExp(`${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`, 'g'), (_m, i) => tokens[Number(i)]);
  return s;
}

function splitTableRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function buildTable(headers, rows, baseUrl) {
  const head = `<thead><tr>${headers.map((h) => `<th>${renderInline(h, baseUrl)}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, baseUrl)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<table>${head}${body}</table>`;
}

function renderListItem(raw, baseUrl) {
  const task = raw.match(/^\s*\[( |x|X)\]\s+(.*)$/);
  if (task) {
    const checked = task[1].toLowerCase() === 'x';
    return `<label class="markdown-task"><input type="checkbox" disabled ${checked ? 'checked' : ''} /> <span>${renderInline(task[2], baseUrl)}</span></label>`;
  }
  return renderInline(raw, baseUrl);
}

const ALERTS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

export function renderMarkdown(md, { baseUrl } = {}) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let listType = null;
  let listItems = [];

  const flushList = () => {
    if (listItems.length) {
      out.push(`<${listType}>\n${listItems.map((li) => `  <li>${li}</li>`).join('\n')}\n</${listType}>`);
    }
    listItems = [];
    listType = null;
  };

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join(' '), baseUrl)}</p>`);
      para = [];
    }
  };

  const flushBlock = () => {
    flushPara();
    flushList();
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];

    const fence = raw.match(/^\s*(```+|~~~+)\s*([\w.+-]*)\s*$/);
    if (fence) {
      flushBlock();
      i += 1;
      const code = [];
      while (i < lines.length && !/^\s*(```+|~~~+)\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const lang = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
      out.push(`<pre><code${lang}>${escapeCode(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (!raw.trim()) {
      flushBlock();
      i += 1;
      continue;
    }

    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushBlock();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim(), baseUrl)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(raw)) {
      flushBlock();
      out.push('<hr />');
      i += 1;
      continue;
    }

    if (/^<div\b/.test(raw.trim())) {
      flushBlock();
      out.push(sanitizeHtml(raw.trim(), baseUrl));
      i += 1;
      continue;
    }

    if (/^<\/div>\s*$/.test(raw.trim())) {
      flushBlock();
      out.push('</div>');
      i += 1;
      continue;
    }

    if (/^<\/?[a-zA-Z!]/.test(raw.trim())) {
      flushBlock();
      out.push(sanitizeHtml(raw.trim(), baseUrl));
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(raw)) {
      flushBlock();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const first = quote.find((line) => line.trim() !== '');
      const alert = first && first.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      if (alert) {
        const key = alert[1].toLowerCase();
        out.push(`<blockquote class="markdown-alert markdown-alert-${key}">`);
        out.push(`<p class="markdown-alert-label">${ALERTS[key]}</p>`);
        out.push(renderMarkdown(quote.slice(quote.indexOf(first) + 1).join('\n'), { baseUrl }));
        out.push('</blockquote>');
      } else {
        out.push(`<blockquote>${renderMarkdown(quote.join('\n'), { baseUrl })}</blockquote>`);
      }
      continue;
    }

    const tableSeparator = raw.includes('|') && /^\s*\|?[\s:|-]+\|?\s*$/.test(raw) && raw.includes('-') && i > 0;
    if (tableSeparator) {
      flushBlock();
      const headers = splitTableRow(lines[i - 1]);
      i += 1;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      out.push(buildTable(headers, rows, baseUrl));
      continue;
    }

    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listType && listType !== type) {
        flushList();
      }
      if (!listType) {
        listType = type;
      }
      listItems.push(renderListItem((ul ? ul[1] : ol[1]).trim(), baseUrl));
      i += 1;
      continue;
    }

    if (listType) {
      flushList();
    }
    para.push(raw.trim());
    i += 1;
  }
  flushBlock();
  return out.join('\n');
}
