/**
 * POC 工具函数集合
 * 这些函数被 POC 演示脚本共享使用
 */

import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

/**
 * 在目录中递归查找数据文件（CSV/Excel）
 */
export function findDataFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const supportedExtensions = ['.csv', '.xlsx', '.xls'];
  const results: string[] = [];

  function scan(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scan(fullPath);
      } else {
          const ext = path.extname(fullPath).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            results.push(fullPath);
          }
        }
    }
  }

  scan(directory);
  return results;
}

/**
 * 校验数据文件是否有效
 */
export function validateDataFile(filePath: string): {
  valid: boolean;
  error?: string;
} {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `文件不存在: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
    return { valid: false, error: `不支持的文件格式: ${ext}，支持 .csv, .xlsx, .xls` };
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: `文件为空: ${filePath}` };
  }

  // 超过 100MB 的文件不建议用于演示
  const maxSize = 100 * 1024 * 1024;
  if (stats.size > maxSize) {
    return { valid: false, error: `文件过大: ${(stats.size / (1024 * 1024)).toFixed(2)}MB，超过 100MB 限制` };
  }

  return { valid: true };
}

/**
 * 确保目录存在，不存在则创建
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 生成时间戳字符串
 */
export function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * 构建输出文件名
 */
export function buildOutputFileName(
  scenarioId: string,
  stepName: string,
  addTimestamp: boolean,
  extension: string
): string {
  const base = `poc_${scenarioId}_${stepName}`;
  if (addTimestamp) {
    return `${base}_${generateTimestamp()}.${extension}`;
  }
  return `${base}.${extension}`;
}

/**
 * 规范化路径（处理 Windows 下的路径分隔符，如 C:\...）
 */
export function normalizePath(filePath: string): string {
  // 统一转换为操作系统原生路径格式，兼容 Windows 和 macOS/Linux
  return path.normalize(filePath);
}

/**
 * 异步等待指定毫秒数
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待页面中某个选择器出现（带超时）
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout = 30000
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    return false;
  }
}
