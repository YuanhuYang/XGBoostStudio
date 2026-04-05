import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI 
    ? [['github'], ['html'], ['junit', { outputFile: 'playwright-results.xml' }]]
    : [['html'], ['list']],
  
  // 截图配置：每个测试后都保存截图
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  
  projects: [
    // Web 模式测试（针对 dev:web）
    {
      name: 'web',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL || 'http://localhost:5173',
      },
    },

    // Electron 模式测试（针对编译后的应用）
    {
      name: 'electron',
      use: {
        // Electron 测试配置由启动脚本设置
      },
    },
  ],

  // 输出目录
  outputDir: './test-results/',
});
