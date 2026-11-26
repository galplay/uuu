import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function safeFolderName(value) {
  const cleaned = String(value || 'assignment')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '');
  return cleaned || 'assignment';
}

export function countQuestions(practice) {
  return practice.groups.reduce((total, group) => {
    if (group.type === 'choice') return total + group.questions.length;
    return total + (group.blanks?.length || 0);
  }, 0);
}

export function countAudios(practice) {
  return practice.groups.reduce((total, group) => total + group.audios.length, 0);
}

export function practiceToText(practice) {
  const lines = [
    practice.title,
    `题目数量：${countQuestions(practice)}`,
    `音频数量：${countAudios(practice)}`,
    '说明：仅供本人已获授权资料的本地复习；不含标准答案、解析或自动提交功能。',
    ''
  ];

  for (const group of practice.groups) {
    lines.push(`【第 ${group.order} 题】`);
    if (group.type === 'choice') {
      for (const question of group.questions) {
        lines.push(`${question.number}.`);
        for (const option of question.options) {
          lines.push(`${option.label}. ${option.text}`);
        }
        lines.push('');
      }
    } else {
      lines.push(group.text, '');
    }
    if (group.audios.length) {
      lines.push('音频：');
      for (const audio of group.audios) lines.push(`- ${audio.file}`);
    }
    lines.push('', '');
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderFillText(text) {
  return escapeHtml(text).replace(/\[(\d+)]\s*_{3,}/g, (_, number) =>
    `<label class="blank"><span>${number}</span><input data-blank="${number}" type="text" autocomplete="off" aria-label="第 ${number} 题"></label>`
  );
}

function renderGroup(group, groupIndex) {
  const audios = group.audios.map((audio, audioIndex) => `
    <div class="audio-row">
      <span>音频 ${audioIndex + 1}</span>
      <audio controls preload="metadata" src="${escapeHtml(audio.file)}">当前浏览器无法播放此音频。</audio>
    </div>`).join('');

  let body = '';
  if (group.type === 'choice') {
    body = group.questions.map(question => `
      <fieldset class="question" data-question="${question.number}">
        <legend>${question.number}.</legend>
        ${question.options.map(option => `
          <label class="option">
            <input type="radio" name="question-${question.number}" value="${escapeHtml(option.label)}">
            <span class="option-label">${escapeHtml(option.label)}</span>
            <span>${escapeHtml(option.text)}</span>
          </label>`).join('')}
      </fieldset>`).join('');
  } else {
    body = `<div class="passage">${renderFillText(group.text)}</div>`;
  }

  return `<section class="group" id="group-${groupIndex + 1}">
    <h2>第 ${escapeHtml(group.order)} 题</h2>
    ${audios}
    ${body}
  </section>`;
}

export function practiceToHtml(practice) {
  const groups = practice.groups.map(renderGroup).join('\n');
  const navigation = practice.groups.map((group, index) =>
    `<a href="#group-${index + 1}">${escapeHtml(group.order)}</a>`
  ).join('');
  const storageKey = `u-campus-practice:${practice.id}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(practice.title)} · 离线练习</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #667085; --line: #dfe5ef; --brand: #3659d9; --soft: #f4f7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: #f5f7fb; font: 16px/1.75 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
    header { position: sticky; top: 0; z-index: 2; padding: 18px 24px; background: rgba(255,255,255,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(12px); }
    header-inner { display: block; }
    h1 { margin: 0; font-size: 24px; line-height: 1.35; }
    .meta { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
    main { width: min(940px, calc(100% - 32px)); margin: 24px auto 60px; }
    .notice { padding: 14px 18px; background: #fff8e8; border: 1px solid #efdba7; border-radius: 12px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    nav a { min-width: 42px; padding: 4px 10px; color: var(--brand); text-align: center; text-decoration: none; background: white; border: 1px solid var(--line); border-radius: 8px; }
    .group { margin: 18px 0; padding: 22px; background: white; border: 1px solid var(--line); border-radius: 16px; scroll-margin-top: 105px; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .audio-row { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 10px; margin: 10px 0; padding: 10px 12px; background: var(--soft); border-radius: 10px; }
    audio { width: 100%; height: 38px; }
    .question { margin: 20px 0 0; padding: 0; border: 0; }
    .question legend { margin-bottom: 6px; font-weight: 700; }
    .option { display: flex; align-items: flex-start; gap: 9px; margin: 7px 0; padding: 9px 12px; border: 1px solid transparent; border-radius: 9px; cursor: pointer; }
    .option:hover { background: var(--soft); border-color: #d8e1ff; }
    .option input { margin-top: 7px; accent-color: var(--brand); }
    .option-label { font-weight: 700; }
    .passage { line-height: 2.3; white-space: pre-wrap; }
    .blank { display: inline-flex; align-items: center; gap: 5px; margin: 0 4px; }
    .blank span { color: var(--brand); font-weight: 700; }
    .blank input { width: 130px; padding: 4px 8px; font: inherit; border: 0; border-bottom: 2px solid #8094c6; background: var(--soft); outline: none; }
    .blank input:focus { border-color: var(--brand); }
    .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    button { padding: 9px 16px; border: 0; border-radius: 9px; cursor: pointer; font: inherit; }
    .primary { color: white; background: var(--brand); }
    .secondary { color: #a33a2a; background: #fff0ec; }
    #status { color: var(--muted); font-size: 14px; }
    @media (max-width: 600px) { main { width: min(100% - 20px, 940px); } .group { padding: 15px; } .audio-row { grid-template-columns: 1fr; } }
    @media print { header, nav, .toolbar { display: none; } body { background: white; } main { width: 100%; } .group { break-inside: avoid; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(practice.title)} · 离线练习</h1>
    <p class="meta">${countQuestions(practice)} 个小题 · ${countAudios(practice)} 个音频 · 练习记录仅保存在此浏览器</p>
  </header>
  <main>
    <div class="notice">本练习不含标准答案和解析，不会连接 U 校园，也不会自动评分或提交。音频和图片等资源请仅用于本人复习。</div>
    <nav aria-label="题组导航">${navigation}</nav>
    <form id="practice-form">${groups}</form>
    <div class="toolbar">
      <button class="primary" type="button" id="save">保存练习记录</button>
      <button class="secondary" type="button" id="clear">清空练习记录</button>
      <span id="status" role="status"></span>
    </div>
  </main>
  <script>
    (() => {
      const key = ${JSON.stringify(storageKey)};
      const form = document.getElementById('practice-form');
      const status = document.getElementById('status');
      const read = () => {
        const data = {};
        form.querySelectorAll('input[type="radio"]:checked').forEach(input => { data[input.name] = input.value; });
        form.querySelectorAll('[data-blank]').forEach(input => { data['blank-' + input.dataset.blank] = input.value; });
        return data;
      };
      const save = () => {
        try {
          localStorage.setItem(key, JSON.stringify(read()));
          status.textContent = '已保存 ' + new Date().toLocaleTimeString();
        } catch {
          status.textContent = '浏览器阻止了本地保存，本次记录仅在当前页面有效。';
        }
      };
      try {
        const saved = JSON.parse(localStorage.getItem(key) || '{}');
        Object.entries(saved).forEach(([name, value]) => {
          if (name.startsWith('blank-')) {
            const input = form.querySelector('[data-blank="' + name.slice(6) + '"]');
            if (input) input.value = value;
          } else {
            const input = form.querySelector('input[name="' + name + '"][value="' + value + '"]');
            if (input) input.checked = true;
          }
        });
      } catch {}
      form.addEventListener('change', save);
      form.addEventListener('input', event => { if (event.target.matches('[data-blank]')) save(); });
      document.getElementById('save').addEventListener('click', save);
      document.getElementById('clear').addEventListener('click', () => {
        if (!confirm('确定清空这份练习的本地记录吗？')) return;
        form.reset();
        try { localStorage.removeItem(key); } catch {}
        status.textContent = '练习记录已清空';
      });
    })();
  </script>
</body>
</html>`;
}

export async function writePracticeExport(practice, destination) {
  await mkdir(destination, { recursive: true });
  const normalized = {
    ...practice,
    questionCount: countQuestions(practice),
    audioCount: countAudios(practice)
  };
  await Promise.all([
    writeFile(path.join(destination, 'questions.json'), JSON.stringify(normalized, null, 2), 'utf8'),
    writeFile(path.join(destination, '题目.txt'), practiceToText(normalized), 'utf8'),
    writeFile(path.join(destination, '练习.html'), practiceToHtml(normalized), 'utf8')
  ]);
  return normalized;
}

export function createLibraryHtml(entries) {
  const cards = entries.map(entry => {
    const available = entry.status === 'ready';
    const detail = available
      ? `${entry.questionCount} 个小题 · ${entry.audioCount} 个音频`
      : escapeHtml(entry.reason || '服务器未开放只读导出');
    return `<article class="card ${available ? '' : 'disabled'}">
      <h2>${escapeHtml(entry.title)}</h2>
      <p>${detail}</p>
      ${available
        ? `<a href="./${encodeURIComponent(entry.folder)}/%E7%BB%83%E4%B9%A0.html">打开离线练习</a> <a class="secondary-link" href="./${encodeURIComponent(entry.folder)}/%E9%A2%98%E7%9B%AE.txt">查看题目文本</a>`
        : '<span>未生成题目或音频</span>'}
    </article>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>U 校园本地练习</title><style>
body{margin:0;background:#f4f6fb;color:#172033;font:16px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}main{width:min(960px,calc(100% - 32px));margin:40px auto}h1{margin-bottom:4px}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:24px}.card{padding:20px;background:white;border:1px solid #dfe5ef;border-radius:14px}.card h2{margin:0;font-size:20px}.card p{min-height:52px;color:#667085}.card a{display:inline-block;margin:4px 8px 0 0;padding:8px 12px;color:white;background:#3659d9;border-radius:8px;text-decoration:none}.card a.secondary-link{color:#3659d9;background:#edf1ff}.card.disabled{background:#f8f9fb}.card.disabled span{color:#8a94a6;font-size:14px}
</style></head><body><main><h1>U 校园本地练习</h1><p class="muted">仅显示已获授权并成功导出的资料；不含标准答案，不会连接或提交到 U 校园。</p><div class="grid">${cards}</div></main></body></html>`;
}

export async function writeLibrary(destination, entries) {
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(path.join(destination, 'index.html'), createLibraryHtml(entries), 'utf8'),
    writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2), 'utf8')
  ]);
}
