/**
 * POC演示场景：完整端到端流水??
 *
 * 演示路径：数据导????特征分析 ??参数配置 ??模型训练 ??模型评估 ??报告生成
 * 启用GIF录制和关键步骤截??
 */

import { test, expect } from '@playwright/test';
import { runPOCScenario } from '../poc-demo/runner';

test('poc-demo: full end-to-end pipeline', async ({ browser }) => {
  const result = await runPOCScenario(browser, {
    scenario: 'full-pipeline',
    recordGif: true,
    takeScreenshots: true,
    saveToDocsAsset: true,
    docsFeatureDir: 'poc-demo',
    timeout: 8 * 60 * 1000, // 8分钟超时
  });

  expect(result.success).toBeTruthy();
  expect(result.screenshotPaths.length).toBeGreaterThan(0);
  expect(result.gifPath).toBeDefined();

  console.log('=== POC 执行完成 ===');
  console.log(`场景: ${result.scenario.name}`);
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(2)} 秒`);
  console.log(`截图?? ${result.screenshotPaths.length}`);
  console.log(`GIF: ${result.gifPath}`);
  result.screenshotPaths.forEach((path, i) => {
    console.log(`  截图 ${i + 1}: ${path}`);
  });
});
