/**
 * POC演示场景：数据导入演??
 *
 * 演示路径：上传CSV/Excel ??数据预览 ??目标列选择 ??确认导入
 */

import { test, expect } from '@playwright/test';
import { runPOCScenario } from '../poc-demo/runner';

test('poc-demo: data import demonstration', async ({ browser }) => {
  const result = await runPOCScenario(browser, {
    scenario: 'data-import',
    // 使用内置样本数据，也可以指定自定义路??
    // dataSourcePath: '/path/to/your/data.csv',
    // targetColumn: 'target',
    dataSourcePath: require.resolve('../poc-demo/fixtures/breast-cancer-sample.csv'),
    targetColumn: 'diagnosis',
    takeScreenshots: true,
    saveToDocsAsset: true,
    docsFeatureDir: 'poc-demo',
  });

  expect(result.success).toBeTruthy();
  expect(result.screenshotPaths.length).toBeGreaterThan(0);

  console.log('=== POC 数据导入演示 完成 ===');
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(2)} 秒`);
  console.log(`截图?? ${result.screenshotPaths.length}`);
});
