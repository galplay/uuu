import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { launchSession, readDashboard, PORTAL_URL } from './session.js';
import { exportReadOnlyReports } from './exporter.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = path.join(projectRoot, 'exports');
const rl = createInterface({ input, output });
let context;

function formatTime(value) {
  if (!value) return '未标明';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '未标明' : date.toLocaleString('zh-CN');
}

function showDashboard(dashboard) {
  console.log('\n========== 学习清单 ==========');
  console.log(`教程：${dashboard.courses.length ? dashboard.courses.join('、') : '未读取到教程名称'}`);
  console.log(`班级：${dashboard.classes.length ? dashboard.classes.join('、') : '未读取到班级名称'}`);
  console.log(`作业/单元测试：${dashboard.works.length} 份`);
  dashboard.works.forEach((work, index) => {
    console.log(`  ${index + 1}. ${work.name}（截止：${formatTime(work.endTime)}）`);
  });
  console.log(`考试：${dashboard.exams.length} 份`);
  dashboard.exams.forEach(exam => console.log(`  - ${exam.name}（${formatTime(exam.startTime)}）`));
  if (dashboard.notices.length) console.log(`提示：${dashboard.notices.join('；')}`);
  console.log('================================\n');
}

async function saveDashboard(dashboard) {
  await mkdir(exportRoot, { recursive: true });
  const safeSummary = {
    generatedAt: new Date().toISOString(),
    courses: dashboard.courses,
    classes: dashboard.classes,
    works: dashboard.works,
    exams: dashboard.exams,
    notices: dashboard.notices
  };
  await writeFile(path.join(exportRoot, '学习清单.json'), JSON.stringify(safeSummary, null, 2), 'utf8');
}

async function main() {
  console.log('U 校园本地学习助手');
  console.log('只会读取本人账号已开放的清单和答题报告；不会进入作答页、填写答案或提交。\n');
  console.log('正在打开浏览器。若尚未登录，请在该浏览器窗口中自行登录，不要把密码或验证码发给助手。');
  ({ context } = await launchSession(projectRoot));
  const page = context.pages()[0];
  let dashboard = await readDashboard(page);

  while (dashboard.needsLogin) {
    console.log(`当前需要登录：${dashboard.reason}`);
    await rl.question('登录完成后，回到此窗口按 Enter 继续…');
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    dashboard = await readDashboard(page);
  }

  await saveDashboard(dashboard);
  showDashboard(dashboard);
  console.log('清单已保存到 exports/学习清单.json。');

  while (true) {
    console.log('1. 刷新班级、教程、作业和考试清单');
    console.log('2. 尝试只读导出全部单元测试（只打开答题报告，不进入作答页）');
    console.log('3. 打开本地练习目录');
    console.log('0. 退出');
    const choice = (await rl.question('请选择：')).trim();

    if (choice === '0') break;
    if (choice === '1') {
      await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      dashboard = await readDashboard(page);
      if (dashboard.needsLogin) {
        console.log('登录状态已失效，请关闭程序后重新启动并登录。');
        continue;
      }
      await saveDashboard(dashboard);
      showDashboard(dashboard);
      continue;
    }
    if (choice === '2') {
      if (!dashboard.works.length) {
        console.log('当前没有可检查的单元测试。');
        continue;
      }
      console.log('开始检查。服务器未授权的测试会跳过，不会改用作答页面。');
      const entries = await exportReadOnlyReports(
        page,
        dashboard.works,
        dashboard.studentId,
        exportRoot,
        message => console.log(message)
      );
      const ready = entries.filter(entry => entry.status === 'ready').length;
      console.log(`本次检查完成：${ready}/${entries.length} 份已有可用本地练习。`);
      continue;
    }
    if (choice === '3') {
      await mkdir(exportRoot, { recursive: true });
      execFile('explorer.exe', [exportRoot], () => {});
      continue;
    }
    console.log('请输入 0、1、2 或 3。');
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n运行失败：${error.message}`);
  console.error('如果是浏览器启动失败，请确认电脑已安装 Microsoft Edge，然后重试。');
} finally {
  rl.close();
  if (context) await context.close();
}
