import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function downloadAudio(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Referer: 'https://ucloud.unipus.cn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`音频下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`音频文件过小：${bytes.length} 字节`);
  if (contentType && !/audio|octet-stream/i.test(contentType)) {
    throw new Error(`音频响应类型异常：${contentType}`);
  }
  const looksLikeMp3 = bytes.subarray(0, 3).toString() === 'ID3'
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!looksLikeMp3) throw new Error('下载内容不是可识别的 MP3 文件');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return { bytes: bytes.length, contentType };
}
