// 在“答题报告”页面的浏览器上下文中运行；不进入作答页，不读取答案字段。
export function extractPracticeFromReport(work) {
  const clean = value => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const basics = [...document.querySelectorAll('.question-basic')];
  if (!basics.length) throw new Error('答题报告中未找到题目');

  const groups = basics.map((basic, groupIndex) => {
    const order = clean(basic.previousElementSibling?.textContent).replace(/\.$/, '') || String(groupIndex + 1);
    const [startText, endText] = order.split('~');
    const start = Number.parseInt(startText, 10) || groupIndex + 1;
    const end = Number.parseInt(endText, 10) || start;
    const audios = [...new Set([...basic.querySelectorAll('audio')]
      .map(audio => audio.getAttribute('src') || '')
      .filter(Boolean)
      .map(src => new URL(src, location.href).href)
      .filter(src => !src.includes('/sys/common/question_num/')))]
      .map(url => ({ url, file: '' }));

    const choiceNodes = [...basic.querySelectorAll('.question-common-abs-choice')];
    if (choiceNodes.length) {
      const questions = choiceNodes.map((node, questionIndex) => {
        const options = [...node.querySelectorAll('.option')].map((option, optionIndex) => ({
          label: clean(option.querySelector('.caption')?.textContent) || String.fromCharCode(65 + optionIndex),
          text: clean(option.querySelector('.content')?.textContent)
        })).filter(option => option.text);
        return { number: start + questionIndex, options };
      });
      return { order, type: 'choice', questions, audios };
    }

    const reply = basic.querySelector('.layout-reply-container') || basic;
    const clone = reply.cloneNode(true);
    clone.querySelectorAll([
      'audio', 'script', 'style',
      '[class*="analysis"]', '[class*="correct-answer"]', '[class*="user-answer"]',
      '.answer', '.answers', '.right-answer', '.standard-answer', '.score', '.question-score'
    ].join(',')).forEach(node => node.remove());
    let blankNumber = start;
    clone.querySelectorAll('input, textarea').forEach(input => {
      input.replaceWith(clone.ownerDocument.createTextNode(` [${blankNumber++}] _____ `));
    });
    const text = clean(clone.innerText || clone.textContent);
    const blanks = Array.from({ length: Math.max(0, blankNumber - start) }, (_, index) => start + index);
    if (!text) throw new Error(`第 ${order} 题没有可导出的题目文本`);
    return { order, type: 'fill', text, blanks, audios };
  });

  return {
    id: String(work.id),
    title: work.name,
    workType: work.workType,
    versionId: work.versionId,
    source: '本人账号的答题报告只读页面',
    exportedAt: new Date().toISOString(),
    groups
  };
}
