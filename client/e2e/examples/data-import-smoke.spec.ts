/**
 * 示例：数据导入页面 Smoke Test + 截图示例
 *
 * 演示如何使用 xs-playwright-screenshot Skill 的截图能力
 */

import { test, expect } from '@playwright/test';
import { takeScreenshot } from '../utils/screenshot-helper';

test.describe('data-import page smoke test', () => {
  test('should load page correctly and show upload area @smoke', async ({ page }) => {
    // 导航到数据导入页面
    await page.goto('/data-import');

    // 等待页面加载完成，检查上传区域可见
    await expect(page.getByText(/上传|upload/i)).toBeVisible();

    // 截图保存：按规范命名，输出到 data-import 目录
    await takeScreenshot({
      testSuite: 'data-import',
      stepName: 'page-loaded',
      page,
      addTimestamp: true,
    });

    // 如果需要保存到文档资源目录，
    // await takeScreenshot({
    //   testSuite: 'data-import',
    //   stepName: 'page-loaded',
    //   page,
    //   addTimestamp: false,
    //   saveToDocsAsset: true,
    //   docsFeatureDir: 'frontend-ui-automation',
    // });
  });

  test('demo: clip specific area screenshot', async ({ page }) => {
    await page.goto('/data-import');
    await expect(page.getByText(/上传|upload/i)).toBeVisible();

    // 只截取上传区域
    await takeScreenshot({
      testSuite: 'data-import',
      stepName: 'upload-area',
      page,
      addTimestamp: true,
      clip: {
        selector: '[role="main"]',
        padding: 8,
      },
    });
  });
});