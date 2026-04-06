/**
 * 示例：完整工作流 GIF 录制
 *
 * 演示如何使用 xs-playwright-screenshot Skill 的 GIF 录制能力
 * 录制完整的用户操作流程，输出 GIF 可放到项目首页展示
 */

import { test } from '@playwright/test';
import { startGifRecording, stopGifRecording } from '../utils/gif-recorder';

test.describe.configure({ mode: 'parallel' });

// 注意：要启用视频录制，需要在顶层配置
test.use({ video: 'on' });

test.describe('demo full workflow recording', () => {
  test('record navigation through main pages @demo', async ({ page, context }) => {
    // 开始 GIF 录制
    const outputPath = startGifRecording(context, {
      testSuite: 'demo',
      scenarioName: 'navigation-tour',
      addTimestamp: true,
      fps: 10,
      // 保存到文档资源目录，用于项目展示
      saveToDocsAsset: true,
      docsFeatureDir: 'project-demo',
    });

    // 执行操作流程（示例导航）
    await page.goto('/');
    await page.waitForTimeout(1000);

    // 导航到数据导入
    // await page.click('[data-testid="nav-data-import"]');
    await page.waitForTimeout(1000);

    // 这里添加更多操作步骤...
    // 例如上传数据、点击按钮等

    // 获取 Playwright 自动录制的视频路径
    const video = page.video();
    if (!video) {
      throw new Error('Video recording not enabled');
    }
    const recordedPath = await video.path();

    // 停止录制并转换为 GIF
    await stopGifRecording(recordedPath, outputPath, {
      testSuite: 'demo',
      scenarioName: 'navigation-tour',
      fps: 10,
    });
  });
});