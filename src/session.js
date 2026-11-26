import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const PORTAL_URL = 'https://ucloud.unipus.cn/portal';

export async function launchSession(projectRoot) {
  const profile = path.join(projectRoot, '.browser-profile');
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: false,
    viewport: null
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return { context, page };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function collectValues(root, keyNames, nameKeys) {
  const values = [];
  const seen = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      for (const key of nameKeys) {
        if (keyNames.some(expected => Object.hasOwn(value, expected)) && typeof value[key] === 'string') {
          values.push(value[key]);
          break;
        }
      }
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(root);
  return uniqueStrings(values);
}

function findArray(root) {
  if (Array.isArray(root)) return root;
  if (!root || typeof root !== 'object') return [];
  for (const key of ['items', 'records', 'list', 'rows', 'data', 'dataList']) {
    if (Array.isArray(root[key])) return root[key];
  }
  return [];
}

export async function readDashboard(page) {
  const result = await page.evaluate(async () => {
    const persisted = JSON.parse(localStorage.getItem('PORTAL_STATE_PERSISTENT') || '{}');
    let authorization = '';
    const seen = new Set();
    const findToken = value => {
      if (authorization || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (typeof value.jwt === 'string' && value.jwt.length > 20) {
        authorization = value.jwt;
        return;
      }
      Object.values(value).forEach(findToken);
    };
    findToken(persisted);
    if (!authorization) return { needsLogin: true, reason: '未找到登录状态' };

    const accountResponse = await fetch('/api/account/user/info', {
      headers: { Authorization: authorization }
    });
    const account = await accountResponse.json();
    const userInfo = account?.value?.userInfo;
    if (account?.code !== 1 || !userInfo?.ssoId) {
      return { needsLogin: true, reason: account?.msg || '登录状态已失效' };
    }

    const applications = Array.isArray(account?.value?.applications) ? account.value.applications : [];
    const homeworkApp = applications.find(app => app?.name === 'homework');
    const headers = {
      Authorization: authorization,
      'u-platform': '2',
      'u-app-id': String(homeworkApp?.appId || homeworkApp?.id || 34),
      'u-school': String(userInfo.school),
      'u-openid': String(userInfo.ssoId),
      'Content-Type': 'application/json; charset=utf-8'
    };
    const request = async (url, options = {}) => {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();
      return { httpStatus: response.status, code: data?.code, msg: data?.msg, value: data?.value };
    };
    const [bookshelf, modules, exams, ...workResponses] = await Promise.all([
      request('/api/cmgt/course/my/bookshelf'),
      request('/api/portal_api/modules/student'),
      request('/api/portal/v1/exam/student-exams'),
      ...[0, 1, 2].map(status => request('/api/hwucs/student/work/list', {
        method: 'POST',
        body: JSON.stringify({ pageNum: 1, pageSize: 100, status })
      }))
    ]);
    return {
      needsLogin: false,
      studentId: String(userInfo.ssoId),
      bookshelf,
      modules,
      exams,
      workResponses
    };
  });

  if (result.needsLogin) return result;

  const worksById = new Map();
  for (const response of result.workResponses) {
    for (const item of findArray(response.value)) {
      if (!item?.id && !item?.workId) continue;
      const id = String(item.id || item.workId);
      worksById.set(id, {
        id,
        name: String(item.name || '未命名作业'),
        workType: Number(item.workType || 0),
        versionId: Number(item.versionId || 1),
        submitStatus: item.submitStatus ?? null,
        startStatus: item.startStatus ?? null,
        startTime: item.startTime || null,
        endTime: item.workEndTime || item.endTime || null,
        classNames: uniqueStrings((item.classInfoList || []).map(entry => entry.className))
      });
    }
  }
  const works = [...worksById.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  );
  const courses = collectValues(
    result.bookshelf.value,
    ['courseId', 'courseName', 'bookId', 'bookName'],
    ['courseName', 'bookName', 'title', 'name']
  );
  const moduleClasses = collectValues(result.modules.value, ['classId'], ['className', 'name']);
  const classes = uniqueStrings([...moduleClasses, ...works.flatMap(work => work.classNames)]);
  const examItems = findArray(result.exams.value).map((exam, index) => ({
    id: String(exam.id || exam.examId || index + 1),
    name: String(exam.name || exam.examName || exam.title || '未命名考试'),
    startTime: exam.startTime || null,
    endTime: exam.endTime || null,
    status: exam.status ?? exam.examStatus ?? null
  }));
  return {
    needsLogin: false,
    studentId: result.studentId,
    courses,
    classes,
    works,
    exams: examItems,
    notices: [result.bookshelf, result.modules, result.exams, ...result.workResponses]
      .filter(response => response.code !== 1)
      .map(response => response.msg || `接口返回 ${response.code}`)
  };
}
