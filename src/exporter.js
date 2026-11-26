import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extractPracticeFromReport } from './extractor.js';
import { downloadAudio } from './downloader.js';
import { safeFolderName, writeLibrary, writePracticeExport } from './practice.js';

export function assignmentFolder(work) {
  return safeFolderName(work.name).toLowerCase().replace(/\s+/g, '-');
}

async function existingEntry(destination, entry) {
  try {
    const practice = JSON.parse(await readFile(path.join(destination, 'questions.json'), 'utf8'));
    return {
      ...entry,
      status: 'ready',
      questionCount: practice.questionCount,
      audioCount: practice.audioCount
    };
  } catch {
    return entry;
  }
}

async function readReportError(page) {
  return page.evaluate(() => {
    const error = document.querySelector('.error-result')?.textContent
      || document.querySelector('.result')?.textContent
      || '';
    const body = document.body?.innerText || '';
    for (const message of ['无权限查看', '用户的作答记录为空', '作答记录为空', '登录状态已失效']) {
      if (body.includes(message)) return message;
    }
    return error.replace(/\s+/g, ' ').trim().slice(0, 180) || '答题报告未提供题目';
  });
}

export async function exportReadOnlyReports(page, works, studentId, exportRoot, onProgress = () => {}) {
  await mkdir(exportRoot, { recursive: true });
  const entries = [];

  for (const work of works) {
    const folder = assignmentFolder(work);
    const destination = path.join(exportRoot, folder);
    const baseEntry = { title: work.name, folder, status: 'blocked', reason: '' };
    onProgress(`正在检查 ${work.name} 的只读答题报告…`);
    const params = new URLSearchParams({
      name: work.name,
      type: String(work.workType || 0),
      versionId: String(work.versionId || 1),
      viewType: '1',
      studentId
    });
    const url = `https://ucloud.unipus.cn/app/homework/my-homework/report/${encodeURIComponent(work.id)}?${params}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => {
        const text = document.body?.innerText || '';
        return document.querySelector('.question-basic')
          || ['无权限查看', '用户的作答记录为空', '作答记录为空', '无法完成操作'].some(message => text.includes(message));
      }, undefined, { timeout: 30_000 });

      if (!await page.locator('.question-basic').count()) {
        const reason = await readReportError(page);
        baseEntry.reason = `只读答题报告未开放：${reason}。未进入作答页。`;
        await mkdir(destination, { recursive: true });
        if (!await existingEntry(destination, baseEntry).then(entry => entry.status === 'ready')) {
          await writeFile(path.join(destination, '导出状态.txt'), `${work.name}\n\n${baseEntry.reason}\n`, 'utf8');
        }
        entries.push(await existingEntry(destination, baseEntry));
        onProgress(`${work.name}：${baseEntry.reason}`);
        continue;
      }

      const practice = await page.evaluate(extractPracticeFromReport, work);
      practice.groups.forEach((group, groupIndex) => {
        group.audios.forEach((audio, audioIndex) => {
          audio.file = `audio/group-${String(groupIndex + 1).padStart(2, '0')}-track-${String(audioIndex + 1).padStart(2, '0')}.mp3`;
        });
      });
      for (const group of practice.groups) {
        for (const audio of group.audios) {
          await downloadAudio(audio.url, path.join(destination, audio.file));
        }
      }
      const written = await writePracticeExport(practice, destination);
      entries.push({
        ...baseEntry,
        status: 'ready',
        questionCount: written.questionCount,
        audioCount: written.audioCount
      });
      onProgress(`${work.name}：已导出 ${written.questionCount} 个小题、${written.audioCount} 个音频。`);
    } catch (error) {
      baseEntry.reason = `只读导出未完成：${error.message}`;
      entries.push(await existingEntry(destination, baseEntry));
      onProgress(`${work.name}：${baseEntry.reason}`);
    }
  }

  await writeLibrary(exportRoot, entries);
  return entries;
}
