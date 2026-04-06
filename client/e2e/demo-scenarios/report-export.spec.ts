/**
 * POC演示场景：报告生成演??
 *
 * 演示路径：数据导????训练完成 ??生成HTML报告 ??关键指标截图
 */

import { test, expect } from '@playwright/test';
import { runPOCScenario } from '../poc-demo/runner';

test('poc-demo: report generation demonstration', async ({ browser }) => {
  const result = await runPOCScenario(browser, {
    scenario: 'report-export',
    takeScreenshots: true,
    saveToDocsAsset: true,
    docsFeatureDir: 'poc-demo',
  });

  expect(result.success).toBeTruthy();
  expect(result.screenshotPaths.length).toBeGreaterThanOrEqual(2);

  console.log('=== POC 报告生成演示 完成 ===');
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(2)} 秒`);
  console.log(`截图?? ${result.screenshotPaths.length}`);
});
