/**
 * POC演示场景：模型训练演??
 *
 * 演示路径：数据导????参数配置 ??启动训练 ??实时进度监控 ??训练完成
 */

import { test, expect } from '@playwright/test';
import { runPOCScenario } from '../poc-demo/runner';

test('poc-demo: model training demonstration', async ({ browser }) => {
  const result = await runPOCScenario(browser, {
    scenario: 'model-training',
    takeScreenshots: true,
    saveToDocsAsset: true,
    docsFeatureDir: 'poc-demo',
    timeout: 3 * 60 * 1000, // 3分钟
  });

  expect(result.success).toBeTruthy();
  expect(result.screenshotPaths.length).toBeGreaterThanOrEqual(3);

  console.log('=== POC 模型训练演示 完成 ===');
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(2)} 秒`);
  console.log(`截图?? ${result.screenshotPaths.length}`);
});
