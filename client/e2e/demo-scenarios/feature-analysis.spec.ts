/**
 * POC演示场景：特征分析演??
 *
 * 演示路径：数据导????相关性热力图 ??特征重要性排????特征分布
 */

import { test, expect } from '@playwright/test';
import { runPOCScenario } from '../poc-demo/runner';

test('poc-demo: feature analysis demonstration', async ({ browser }) => {
  const result = await runPOCScenario(browser, {
    scenario: 'feature-analysis',
    takeScreenshots: true,
    saveToDocsAsset: true,
    docsFeatureDir: 'poc-demo',
  });

  expect(result.success).toBeTruthy();
  expect(result.screenshotPaths.length).toBeGreaterThanOrEqual(2);

  console.log('=== POC 特征分析演示 完成 ===');
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(2)} 秒`);
  console.log(`截图?? ${result.screenshotPaths.length}`);
});
