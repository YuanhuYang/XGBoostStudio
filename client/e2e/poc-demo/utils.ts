/**
 * POC??????
 * ???????????????
 */

import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

/**
 * ??????????CSV/Excel??
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
 * ??????????
 */
export function validateDataFile(filePath: string): {
  valid: boolean;
  error?: string;
} {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `?????: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
    return { valid: false, error: `????????: ${ext}???? .csv, .xlsx, .xls` };
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: `????: ${filePath}` };
  }

  // 100MB ???????????????
  const maxSize = 100 * 1024 * 1024;
  if (stats.size > maxSize) {
    return { valid: false, error: `????: ${(stats.size / (1024 * 1024)).toFixed(2)}MB????? 100MB` };
  }

  return { valid: true };
}

/**
 * ????????
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * ????????
 */
export function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * ???????
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
 * ??Windows???????C:\????
 */
export function normalizePath(filePath: string): string {
  // ?????????????Windows???
  return path.normalize(filePath);
}

/**
 * ??????
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ????????????
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
