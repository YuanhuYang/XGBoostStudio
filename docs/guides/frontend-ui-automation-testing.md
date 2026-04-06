# XGBoost Studio 前端 UI 自动化测试方案调研

## 项目现状

XGBoost Studio 是一个 **Electron + React 18 + TypeScript + Vite** 全栈项目。

- 后端：FastAPI + Python，已具备 pytest 单元测试和 API 集成测试
- 前端：现有测试仅使用 **Vitest** 做单元测试，仅有 1 个测试文件（`reportSections.test.ts`）
- 测试环境：当前为 node 环境，不支持真实浏览器交互
- 覆盖率：极低，需要系统性提升
- CI：已有 GitHub Actions 工作流 `.github/workflows/ci.yml`，运行后端 pytest 和前端单元测试 + 类型检查

**需求目标**：引入可与浏览器/Electron 交互的自动化测试方案，覆盖关键用户流程，提升 UI 自动化覆盖率，保证交互符合测试预期与产品预期。

---

## 主流方案调研

本次调研对比四个主流方案：

1. **Playwright** - 微软出品，现代化 E2E 测试框架
2. **Cypress** - 流行的前端测试框架，开发者体验友好
3. **Vitest + Testing Library** - 组件级单测/集成测试，jsdom 环境
4. **WebDriverIO** - 基于 WebDriver 协议的老牌测试框架

---

## 各方案对比分析

### 1. Playwright

**核心特点**：
- 官方支持 **Electron** 测试（`@playwright/test` 内置 `_electron` API）
- 支持所有现代浏览器：Chromium、Firefox、WebKit（包含 Safari）
- 一流的 TypeScript 支持，类型定义完整
- 内置并行执行，无额外付费限制
- 优秀的调试工具：tracing、截图、视频、DOM 查看
- 支持 **组件测试** 与 **E2E 测试** 一体化
- 活跃的社区增长，6.5M+ 每周 npm 下载
- GitHub Actions 集成一流，官方提供 Action

**与当前项目适配性**：
- 对 Electron 原生支持，可测试打包后的桌面应用
- 同时支持 Web 模式测试（`npm run dev:web`）和 Electron 桌面模式
- 与现有 Vite/Vitest 架构无冲突，可渐进引入
- CI 集成简单，已有 GitHub Actions 可直接扩展
- 组件测试仍处于实验阶段，但对本项目不是核心需求

**学习曲线**：中等，API 设计清晰，文档完整

**资源开销**：需要下载浏览器二进制文件（~100-150MB），CI 时间可接受

---

### 2. Cypress

**核心特点**：
- Electron 也有官方支持
- 优秀的交互式调试体验，时间旅行调试
- 成熟的组件测试支持
- 开发者友好，学习曲线平缓

**局限性**：
- 并行执行需要付费 Cypress Cloud
- WebKit/Safari 支持仍是实验性
- 执行速度比 Playwright 慢（约 2x）
- TypeScript 支持良好但存在一些已知问题
- 架构限制在单一浏览器上下文，无法测试多标签

**与当前项目适配性**：
- 集成简单，上手快
- 并行测试在 CI 上受限，对于未来测试规模扩大不利
- 开源版无法充分利用 CI 并行能力，本项目开源，付费不适用

---

### 3. Vitest + Testing Library（React Testing Library）

**核心特点**：
- 在 jsdom 环境中测试 React 组件
- 不启动真实浏览器，测试执行快
- 提倡“按用户交互方式测试”的理念，与现有 React 开发契合
- 已存在 Vitest 配置，只需添加 jsdom 和 Testing Library 依赖
- API 稳定，社区成熟

**局限性**：
- jsdom 不是真实浏览器，无法测试真实浏览器行为
- 无法测试 Electron 桌面应用的原生交互
- 不支持跨页面流程、文件上传下载等真实用户操作

**与当前项目适配性**：
- 非常适合 **组件级单元测试**，可快速提升组件覆盖率
- 与现有 Vitest 配置无缝集成
- 执行速度快，不影响 CI 时间
- 无法满足“浏览器交互 + 端到端用户流程”测试需求

**建议**：作为测试金字塔的底层，与 E2E 框架互补使用，而非替代 E2E。

---

### 4. WebDriverIO

**核心特点**：
- 基于 WebDriver 协议，支持所有 WebDriver 兼容浏览器
- 支持移动测试（通过 Appium）
- 丰富的插件生态

**局限性**：
- 比 Playwright 慢约 2-3x（WebDriver 协议开销）
- 调试能力依赖插件，不如 Playwright 内置工具链完整
- 社区活跃度和增长速度远低于 Playwright
- GitHub stars: ~9.5k vs Playwright ~72.5k（2026）

**与当前项目适配性**：
- 可以工作但无明显优势
- 对于新项目不是现代最优选择

---

## 综合对比

| 评估维度 | Playwright | Cypress 开源版 | Vitest + Testing Library | WebDriverIO |
|---------|------------|----------------|---------------------------|-------------|
| Electron 原生支持 | ✅ 官方 | ✅ 官方 | ❌（仅 jsdom） | ⚠️ 间接 |
| 多浏览器支持 | ✅ 全部（含 Safari） | ⚠️ Safari 实验性 | ❌ | ✅ |
| 免费原生并行 | ✅ | ❌ | ✅ | ✅ |
| TypeScript 支持 | ✅ 一流 | ✅ 良好 | ✅ 一流 | ✅ 良好 |
| 执行速度 | 最快 | 中等 | 极快 | 较慢 |
| CI 集成易用性 | ✅ 一流 | ✅ 良好 | ✅ 已集成 | ✅ 良好 |
| 调试工具 | ✅ 内置 tracing | ✅ 交互式时间旅行 | ✅ 基础 | ⚠️ 插件依赖 |
| 学习曲线 | 中等 | 平缓 | 平缓 | 中等 |
| 社区活跃度 2026 | ⭐⭐⭐⭐⭐ 最强 | ⭐⭐⭐⭐ 较高 | ⭐⭐⭐⭐ 极高 | ⭐⭐ 一般 |
| 适合开源项目 | ✅ 完全免费 | ⚠️ 并行受限 | ✅ 完全免费 | ✅ 完全免费 |

---

## 选型建议

### 推荐方案：**Playwright + Vitest + Testing Library 混合架构**

采用 **测试金字塔** 策略：

```text
         ┌─────────────────────────────┐
         │      Playwright E2E         │  关键用户流程、端到端交互
         ├─────────────────────────────┤
         │   组件集成测试（Vitest）     │  Testing Library + Vitest
         ├─────────────────────────────┤
         │      单元测试（Vitest）      │  现有工具链复用
         └─────────────────────────────┘
```

**核心理由**：

1. **双模式支持**：Playwright 同时支持 **Web 模式**（开发版 `dev:web`）和 **Electron 桌面模式**（打包后的应用），完美匹配本项目同时支持 Web 与 Electron 发布的特性。
2. **开源友好**：原生并行执行完全免费，适合开源项目在 GitHub Actions 上运行。
3. **速度与调试平衡**：执行速度快，内置 tracing，对 CI 失败调试非常方便。
4. **微软维护**：持续活跃开发，生态健康，2026 年已超越 Cypress 成为市场第一选择。
5. **渐进引入**：不破坏现有测试体系，可从关键用户路径开始逐步增加覆盖率。
6. **Testing Library 补强**：对于纯 React 组件测试，使用 Testing Library + Vitest + jsdom 快速跑测，与 Playwright 形成互补。

---

## 分阶段实施路线图

### 阶段一：基础设施搭建（预计 1-2 个工作日）

**目标**：集成 Playwright 到项目，运行第一个测试。

- [ ] 安装依赖：`npm i -D playwright @playwright/test @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom`
- [ ] 创建 `playwright.config.ts` 配置
  - 配置 Web 模式测试（针对 `dev:web`）
  - 配置 Electron 模式测试（针对编译后的应用）
- [ ] 更新 `vitest.config.ts` 启用 `jsdom` 环境
- [ ] 创建 `client/src/test-setup.ts` 配置 Testing Library
- [ ] 更新 `.github/workflows/ci.yml` 添加 Playwright 测试作业
- [ ] 编写第一条 E2E 测试：数据上传页面 smoke test

**交付物**：PR 合入后，CI 可自动运行 Playwright 测试。

### 阶段二：关键用户路径覆盖（预计 2-4 个工作日）

**目标**：覆盖 P0 核心用户流程。

P0 关键用户路径测点建议：

1. **数据导入流程**
   - 正常 CSV 文件上传
   - 错误格式文件处理
   - 空文件/超大文件边界情况
   - 目标列选择交互

2. **向导流程**
   - 从数据导入到特征工程再到模型训练的完整向导
   - 步骤之间状态保持
   - 上一步/下一步按钮交互

3. **报告生成与预览**
   - 报告章节选择交互
   - PDF 预览渲染
   - 报告导出功能

4. **模型训练**
   - 参数配置表单交互
   - 训练启动/进度显示
   - 训练结果展示

**交付物**：P0 流程自动化测试用例，覆盖率 > 30% 核心 UI 代码。

### 阶段三：组件测试补全（预计持续进行）

**目标**：提升组件级测试覆盖率。

- 对通用 constants、utils 逐步补全单元测试
- 对可复用纯组件（按钮、表单、卡片）添加 Testing Library 测试
- 对复杂状态逻辑使用组件测试保证行为一致

### 阶段四：CI 优化与规范（预计 1 个工作日）

- [ ] 配置测试分片，利用 GitHub Actions 并行加速
- [ ] 配置失败自动截图与 trace 上传，方便调试
- [ ] 添加 `npm run test:e2e` 与 `npm run test:e2e:web` 脚本，方便本地开发
- [ ] 文档更新：在 `docs/guides/` 添加测试运行指南

---

## 关键用户路径测点建议

按风险驱动排序，优先测试高风险路径：

### P0（必须覆盖）

| 页面/模块 | 测点 | 测试类型 | 预期断言 |
|-----------|------|----------|----------|
| 数据导入 | 正常 CSV 上传流程 | E2E | 成功解析，显示数据预览，可进入下一步 |
| 数据导入 | 错误文件格式提示 | E2E | 显示友好错误消息，不崩溃 |
| 特征工程 | 特征选择交互 | E2E | 勾选/取消勾选后状态正确更新 |
| 模型训练 | 参数提交 | E2E | 参数正确传递给后端，训练开始 |
| 报告 | 章节勾选变更 | 组件+E2E | 选中章节反映在预览中 |

### P1（高优先级）

| 页面/模块 | 测点 | 测试类型 |
|-----------|------|----------|
| 导航侧边栏 | 各页面路由跳转正确 | E2E |
| 模型评估 | 特征重要性图表渲染 | E2E |
| 模型调参 | 网格搜索/随机搜索配置交互 | E2E |
| 智能工作流 | 一键完整流程 | E2E |

### P2（后续迭代）

- 更多异常场景测试（网络断开、后端错误等）
- 响应式布局测试（不同窗口尺寸）
- 多标签页交互（若支持）

---

## 与现有测试体系的融合

1. **保留现有 Vitest**：继续用于单元测试和组件测试，不替换。
2. **新增 Playwright**：放在 `client/e2e/` 目录，不影响现有代码结构。
3. **CI 分阶段执行**：
   - 单元测试 + 类型检查先跑，快速反馈
   - E2E 测试后跑，利用并行加速
   - 可配置：PR 只跑 P0 测试，主干跑全量

4. **目录结构建议**：

```text
client/
├── src/
│   ├── **/*.test.ts(x)          # 单元/组件测试（Vitest + Testing Library）
│   └── test-setup.ts            # Testing Library 全局设置
├── e2e/
│   ├── **/*.spec.ts             # E2E 测试用例（Playwright）
│   └── fixtures/                # E2E 测试数据
├── vitest.config.ts
└── playwright.config.ts
```

---

## 本地开发运行命令建议

更新 `client/package.json` scripts：

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run",
    "test:e2e:web": "playwright test --headed",
    "test:e2e:electron": "playwright test --project=electron",
    "test:e2e:ci": "playwright test"
  }
}
```

---

## 风险与注意事项

1. **Electron 测试需要先构建应用**：Playwright 测试 Electron 需要先执行 `npm run build:vite` 编译应用，比纯 Web 测试多一步构建，CI 时间会增加。建议：Electron E2E 只在主干运行，PR 只跑 Web E2E。
2. **浏览器二进制大小**：Playwright 需要下载浏览器，CI 首次运行会增加安装时间，可缓存浏览器目录优化。
3. **Flakiness 防控**：
   - 使用 Playwright 自动等待机制，减少硬编码 `waitForTimeout`
   - CI 配置适当重试（通常 2 次足够）
   - 失败自动保存 trace，便于调试
4. **Windows 路径兼容性**：本项目开发环境包含 Windows，Playwright 在 Windows 路径处理良好，已知问题少于 Cypress。

---

## 总结

| 项目 | 结论 |
|------|------|
| **推荐架构** | Playwright（E2E）+ Vitest（单元）+ Testing Library（组件） |
| **路线图** | 分四阶段渐进引入，从基础设施到 P0 覆盖再到补全组件测试 |
| **CI 集成** | 可直接扩展现有 GitHub Actions workflow，利用并行加速 |
| **学习成本** | 团队熟悉 JavaScript/TypeScript 即可快速上手 |
| **长期维护** | Playwright 社区活跃，微软持续投入，适合长期投资 |

该方案贴合 XGBoost Studio 同时支持 Web 与 Electron 的项目实际情况，能够最大化提升 UI 自动化覆盖率，同时保持良好的开发体验和可维护性。

---

## 自动化截图与 GIF 录制能力

项目提供了专门的 Skill `xs-playwright-screenshot`，测试专家可以通过它自动进行符合命名规范的截图和 GIF 录制，方便文档编写和项目展示。

### 能力特点

- **强制命名规范**：统一使用 `{test-suite}_{step-name}_{timestamp}.png/gif`，小写字母 + 连字符
- **目录结构自动创建**：自动处理 Windows 路径兼容
- **两种输出目的**：测试临时产物 / 文档固定资源
- **支持区域截图**：可选择指定元素截图，自动处理 padding
- **支持 GIF 录制**：基于 Playwright 视频录制，通过 ffmpeg 自动转 GIF

### 目录结构

```text
client/
├── e2e/
│   ├── utils/
│   │   ├── screenshot-helper.ts  # 截图工具
│   │   └── gif-recorder.ts       # GIF 录制工具
│   ├── screenshots/              # 测试截图（忽略，保留 .gitkeep）
│   ├── recordings/               # 录制产物（忽略，保留 .gitkeep）
│   └── examples/
│       ├── data-import-smoke.spec.ts   # 截图示例
│       └── full-workflow-demo.spec.ts  # GIF 录制示例
docs/
├── assets/
│   ├── screenshots/  # 文档用固定截图（仅提交选中的）
│   └── gifs/         # 文档用固定 GIF（仅提交选中的）
```

### 使用示例 - 截图

```typescript
import { test, expect } from '@playwright/test';
import { takeScreenshot } from '../utils/screenshot-helper';

test('data-import page loaded', async ({ page }) => {
  await page.goto('/data-import');
  await expect(page.getByText(/upload/i)).toBeVisible();

  // 按规范截图，自动输出到正确目录
  await takeScreenshot({
    testSuite: 'data-import',
    stepName: 'page-loaded',
    page,
    addTimestamp: true,
  });

  // 保存到文档资源目录用于文档展示
  await takeScreenshot({
    testSuite: 'data-import',
    stepName: 'main-upload-area',
    page,
    addTimestamp: false,
    saveToDocsAsset: true,
    docsFeatureDir: 'data-import-guide',
    clip: { selector: '[role="main"]', padding: 8 },
  });
  // 输出会自动提示 Markdown 链接模板，可直接复制到文档
});
```

### 使用示例 - GIF 录制

```typescript
import { test } from '@playwright/test';
import { startGifRecording, stopGifRecording } from '../utils/gif-recorder';

// 启用视频录制
test.use({ video: 'on' });

test('record full workflow', async ({ page, context }) => {
  // 开始录制
  const outputPath = startGifRecording(context, {
    testSuite: 'demo',
    scenarioName: 'full-pipeline',
    addTimestamp: true,
    fps: 10,
    saveToDocsAsset: true,
    docsFeatureDir: 'project-demo',
  });

  // 执行用户操作流程...
  await page.goto('/');
  // ... 导航、点击等操作

  // 停止并输出 GIF
  const video = page.video();
  if (video) {
    await stopGifRecording(await video.path(), outputPath, { fps: 10 });
  }
  // 输出 GIF 文件可直接放到项目 README 或首页展示
});
```

### 命名规范检查

工具内置了命名规范检查：
- 只允许小写字母（`a-z`）、数字（`0-9`）和连字符（`-`）
- 不允许大写字母、空格、下划线、中文或其他特殊字符
- 不符合规范会立即抛出错误提醒修正

### 依赖

- Playwright 内置视频录制功能，无需额外依赖
- GIF 转换需要 **ffmpeg**（可选，如果没有安装则输出 WebM 文件，可手动转换）
- 推荐在本地安装 ffmpeg 用于生成文档 GIF：
  - Windows: `choco install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `apt install ffmpeg`

### 最佳实践

- **文档用图**：使用 `saveToDocsAsset: true` + `addTimestamp: false` 输出固定名称，方便文档链接
- **测试调试**：保留时间戳避免覆盖，便于对比多次运行结果
- **GIF 文件大小**：FPS 推荐 8-15，更高 FPS 会导致文件过大不利于 GitHub 展示；录制时间控制在 30 秒以内
- **提交到仓库**：只有文档确定要使用的截图/GIF 才提交到 Git，其他临时产物由 `.gitignore` 忽略
