/**
 * Playwright 截图助手 - 按规范命名并输出到约定目录
 * 遵循 xs-playwright-screenshot Skill 定义的契约
 */

import path from 'path';
import fs from 'fs';
import type { Page } from '@playwright/test';

/**
 * 截图选项 - 符合 Skill 契约定义
 */
export interface ScreenshotOptions {
  /** 测试套件名称（对应页面功能模块，小写连字符，如 "data-import" */
  testSuite: string;
  /** 步骤名称（当前操作功能点，小写+连字符，如 "upload-success" */
  stepName: string;
  /** Playwright Page 对象 */
  page: Page;
  /** 是否添加时间戳避免覆盖，默认 true */
  addTimestamp?: boolean;
  /** 截图区域（通过 selector 选中元素并截图） */
  clip?: {
    selector: string;
    padding?: number;
  };
  /** 是否保存到文档目录（docs/assets/screenshots），默认 false */
  saveToDocsAsset?: boolean;
  /** 文档功能目录名（仅当 saveToDocsAsset = true 时使用，如 "data-import-guide" */
  docsFeatureDir?: string;
}

/**
 * 生成符合规范的文件名
 */
function generateFilename(stepName: string, addTimestamp: boolean): string {
  // 验证名称只包含小写字母、连字符和数字
  const validNameRegex = /^[a-z0-9-]+$/;
  if (!validNameRegex.test(stepName)) {
    throw new Error(
      `Invalid step name "${stepName}": must only contain lowercase letters, numbers, and hyphens`
    );
  }

  if (addTimestamp) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `${stepName}_${timestamp}.png`;
  }
  return `${stepName}.png`;
}

/**
 * 计算完整输出路径
 */
function getOutputPath(
  testSuite: string,
  filename: string,
  saveToDocsAsset: boolean,
  docsFeatureDir?: string
): string {
  const rootDir = path.resolve(__dirname, '../../..');

  if (saveToDocsAsset && docsFeatureDir) {
    // 文档用图输出到 docs/assets/screenshots/{docsFeatureDir}/
    return path.join(
      rootDir,
      'docs',
      'assets',
      'screenshots',
      docsFeatureDir,
      filename
    );
  } else if (saveToDocsAsset) {
    // 文档用图输出到 docs/assets/screenshots/{testSuite}/
    return path.join(
      rootDir,
      'docs',
      'assets',
      'screenshots',
      testSuite,
      filename
    );
  }

  // 测试截图输出到 client/e2e/screenshots/{testSuite}/
  return path.join(
    rootDir,
      'client',
      'e2e',
      'screenshots',
      testSuite,
      filename
  );
}

/**
 * 确保输出目录存在
 */
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 生成 Markdown 链接模板，方便复制粘贴到文档
 */
function generateMarkdownLink(filePath: string, saveToDocsAsset: boolean): string {
  // 相对路径从项目根开始
  if (saveToDocsAsset) {
    const relPath = path.relative(path.resolve(__dirname, '../../..'), filePath);
    // 转换为正斜杠用于 Markdown
    const webPath = relPath.replace(/\\/g, '/');
    return `![描述](${webPath})`;
  }
  return '';
}

/**
 * 按规范截图
 * @returns 输出文件的绝对路径
 */
export async function takeScreenshot(options: ScreenshotOptions): Promise<string> {
  const {
    testSuite,
    stepName,
    page,
    addTimestamp = true,
    clip,
    saveToDocsAsset = false,
    docsFeatureDir,
  } = options;

  // 验证测试套件名称格式
  const validNameRegex = /^[a-z0-9-]+$/;
  if (!validNameRegex.test(testSuite)) {
    throw new Error(
      `Invalid testSuite name "${testSuite}": must only contain lowercase letters, numbers, and hyphens`
    );
  }

  // 生成文件名和路径
  const filename = generateFilename(stepName, addTimestamp);
  const outputPath = getOutputPath(testSuite, filename, saveToDocsAsset, docsFeatureDir);

  // 确保目录存在
  ensureDirectoryExists(outputPath);

  // 计算 clip 区域（如果提供了 selector）
  let clipRect: { x: number; y: number; width: number; height: number } | undefined;
  if (clip) {
    const element = await page.locator(clip.selector).first();
    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`Could not find element with selector "${clip.selector}" for clip`);
    }

    // 添加 padding
    const padding = clip.padding || 0;
    clipRect = {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + 2 * padding,
      height: box.height + 2 * padding,
    };
  }

  // 截图
  await page.screenshot({
    path: outputPath,
    fullPage: !clip,
    clip: clipRect,
    type: 'png',
  });

  // 输出日志和 Markdown 模板
  // eslint-disable-next-line no-console
  console.log(`\n✅ Screenshot saved to: ${outputPath}`);
  if (saveToDocsAsset) {
    // eslint-disable-next-line no-console
    console.log(`  Markdown link:\n  ${generateMarkdownLink(outputPath, saveToDocsAsset)}`);
  }

  return outputPath;
}

/**
 * 清理测试截图目录（保留 .gitkeep）
 */
export async function cleanTestScreenshots(testSuite?: string): Promise<void> {
  const rootDir = path.resolve(__dirname, '../../../client/e2e/screenshots');

  if (testSuite) {
    const dir = path.join(rootDir, testSuite);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return;
  }

  // 清理所有截图，保留 .gitkeep
  const items = fs.readdirSync(rootDir);
  for (const item of items) {
    if (item !== '.gitkeep') {
      const fullPath = path.join(rootDir, item);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}