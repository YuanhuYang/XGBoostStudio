/**
 * POC 运行器
 * 用于批量运行 POC 场景并生成截图/GIF
 */

import { Browser, Page } from '@playwright/test';
import {
  POCScenario,
  builtInScenarios,
  getScenarioById,
  validateScenario,
} from './scenarios';
import {
  validateDataFile,
  wait,
} from './utils';
import { takeScreenshot } from '../utils/screenshot-helper';
import { startGifRecording, stopGifRecording } from '../utils/gif-recorder';

export * from './scenarios';
export * from './utils';

export interface POCRunOptions {
  scenario: string | POCScenario;
  dataSourcePath?: string;
  targetColumn?: string;
  baseURL?: string;
  recordGif?: boolean;
  takeScreenshots?: boolean;
  saveToDocsAsset?: boolean;
  docsFeatureDir?: string;
  gifFps?: number;
  timeout?: number;
}

export interface POCRunResult {
  success: boolean;
  scenario: POCScenario;
  screenshotPaths: string[];
  gifPath?: string;
  error?: {
    step: string;
    message: string;
    originalError?: unknown;
  };
  durationMs: number;
}

export function listScenarios(): POCScenario[] {
  return builtInScenarios;
}

export async function runPOCScenario(
  browser: Browser,
  options: POCRunOptions
): Promise<POCRunResult> {
  const startTime = Date.now();
  const screenshotPaths: string[] = [];
  let gifPath: string | undefined;

  let scenario: POCScenario;
  if (typeof options.scenario === 'string') {
    const found = getScenarioById(options.scenario);
    if (!found) {
      return {
        success: false,
        scenario: { id: options.scenario } as POCScenario,
        screenshotPaths: [],
        durationMs: Date.now() - startTime,
        error: {
          step: '查找场景',
          message: `找不到场景ID: ${options.scenario}`,
        },
      };
    }
    scenario = found;
  } else {
    scenario = options.scenario;
  }

  const validation = validateScenario(scenario, options.dataSourcePath);
  if (!validation.valid) {
    return {
      success: false,
      scenario,
      screenshotPaths: [],
      durationMs: Date.now() - startTime,
      error: {
        step: '验证场景',
        message: validation.error!,
      },
    };
  }

  const dataPath = options.dataSourcePath || scenario.defaultDataSourcePath!;
  const targetCol = options.targetColumn || scenario.defaultTargetColumn!;

  const fileValidation = validateDataFile(dataPath);
  if (!fileValidation.valid) {
    return {
      success: false,
      scenario,
      screenshotPaths: [],
      durationMs: Date.now() - startTime,
      error: {
        step: '验证数据文件',
        message: fileValidation.error!,
      },
    };
  }

  const baseURL = options.baseURL || process.env.BASE_URL || 'http://localhost:5173';
  const timeout = options.timeout || 5 * 60 * 1000;
  const recordGif = options.recordGif || false;
  const takeScreenshots = options.takeScreenshots !== false;
  const saveToDocsAsset = options.saveToDocsAsset || false;
  const docsFeatureDir = options.docsFeatureDir || `poc/${scenario.id}`;
  const gifFps = options.gifFps || 10;

  const p = require('path');
  const context = await browser.newContext({
    baseURL,
    recordVideo: recordGif ? { dir: p.join(process.cwd(), 'client', 'e2e', 'recordings') } : undefined,
  });
  const page = await context.newPage();

  try {
    if (recordGif) {
      gifPath = startGifRecording(context, {
        testSuite: 'poc',
        scenarioName: scenario.id,
        addTimestamp: true,
        saveToDocsAsset,
        docsFeatureDir,
      });
    }

    await executeScenarioSteps({
      scenario,
      page,
      baseURL,
      dataPath,
      targetCol,
      takeScreenshots,
      saveToDocsAsset,
      docsFeatureDir,
      screenshotPaths,
      timeout,
    });

    if (recordGif && page.video() && gifPath) {
      const recordedPath = await page.video()!.path();
      await stopGifRecording(recordedPath, gifPath, {
        testSuite: 'poc',
        scenarioName: scenario.id,
        fps: gifFps,
        addTimestamp: true,
        saveToDocsAsset,
        docsFeatureDir,
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(`POC 场景 "${scenario.name}" 完成，耗时 ${(durationMs / 1000).toFixed(2)} 秒`);
    console.log(`截图数量: ${screenshotPaths.length}`);
    if (gifPath) {
      console.log(`GIF 路径: ${gifPath}`);
    }

    await context.close();

    return {
      success: true,
      scenario,
      screenshotPaths,
      gifPath,
      durationMs,
    };
  } catch (e: unknown) {
    await context.close();
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      scenario,
      screenshotPaths,
      gifPath,
      durationMs,
      error: {
        step: '执行场景',
        message: e instanceof Error ? e.message : String(e),
        originalError: e,
      },
    };
  }
}

interface StepExecutionOptions {
  scenario: POCScenario;
  page: Page;
  baseURL: string;
  dataPath: string;
  targetCol: string;
  takeScreenshots: boolean;
  saveToDocsAsset: boolean;
  docsFeatureDir: string;
  screenshotPaths: string[];
  timeout: number;
}

async function executeScenarioSteps(
  options: StepExecutionOptions
): Promise<void> {
  const {
    scenario,
    page,
    dataPath,
    targetCol,
    takeScreenshots,
    saveToDocsAsset,
    docsFeatureDir,
    screenshotPaths,
    timeout,
  } = options;

  switch (scenario.id) {
    case 'full-pipeline':
      await executeFullPipeline();
      break;
    case 'data-import':
      await executeDataImport();
      break;
    case 'feature-analysis':
      await executeFeatureAnalysis();
      break;
    case 'model-training':
      await executeModelTraining();
      break;
    case 'report-export':
      await executeReportExport();
      break;
    default:
      throw new Error(`未知场景ID: ${scenario.id}`);
  }

  async function takeStepScreenshot(stepName: string): Promise<void> {
    if (!takeScreenshots) return;

    const filePath = await takeScreenshot({
      testSuite: 'poc',
      stepName: `${scenario.id}_${stepName}`,
      page,
      addTimestamp: true,
      saveToDocsAsset,
      docsFeatureDir,
    });
    screenshotPaths.push(filePath);
  }

  async function navigateTo(pagePath: string): Promise<void> {
    await page.goto(`${options.baseURL}${pagePath}`);
    await page.waitForSelector('body', { timeout: 10000 });
    await wait(500);
  }

  async function uploadDataFile(): Promise<void> {
    await navigateTo('/data-import');
    await takeStepScreenshot('before-upload');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(dataPath);
    await wait(2000);

    await page.waitForSelector('table', { timeout: 10000 });
    await takeStepScreenshot('after-upload-preview');

    if (targetCol) {
      await page.selectOption('select[name="targetColumn"]', targetCol);
      await wait(500);
    }

    await page.click('button[type="submit"], button:has-text("提交"), button:has-text("Import")');
    await page.waitForSelector('text=导入成功', { timeout: 15000 });
    await takeStepScreenshot('import-success');
    await wait(1000);
  }

  async function executeFullPipeline(): Promise<void> {
    await uploadDataFile();

    await navigateTo('/feature-analysis');
    await page.waitForSelector('text=特征分析', { timeout: 10000 });
    await wait(2000);
    await takeStepScreenshot('feature-analysis');

    await navigateTo('/param-config');
    await page.waitForSelector('text=参数配置', { timeout: 10000 });
    await takeStepScreenshot('param-config');
    await wait(500);

    await navigateTo('/model-training');
    await page.waitForSelector('text=模型训练', { timeout: 10000 });
    await takeStepScreenshot('before-training');
    await page.click('button:has-text("开始训练")');
    await page.waitForSelector('text=训练完成', { timeout });
    await takeStepScreenshot('training-complete');
    await wait(1000);

    await navigateTo('/model-eval');
    await page.waitForSelector('text=模型评估', { timeout: 10000 });
    await wait(3000);
    await takeStepScreenshot('model-eval');

    await navigateTo('/report');
    await page.waitForSelector('text=报告', { timeout: 10000 });
    await wait(3000);
    await takeStepScreenshot('report-final');
  }

  async function executeDataImport(): Promise<void> {
    await uploadDataFile();
  }

  async function executeFeatureAnalysis(): Promise<void> {
    await uploadDataFile();
    await navigateTo('/feature-analysis');
    await page.waitForSelector('text=特征', { timeout: 10000 });
    await wait(3000);
    await takeStepScreenshot('correlation-heatmap');
    await wait(1000);
    await takeStepScreenshot('feature-importance');
  }

  async function executeModelTraining(): Promise<void> {
    await uploadDataFile();
    await navigateTo('/param-config');
    await page.waitForSelector('text=参数配置', { timeout: 10000 });
    await page.fill('input[name="n_estimators"]', '50');
    await wait(500);
    await takeStepScreenshot('params-set');
    await navigateTo('/model-training');
    await page.waitForSelector('text=模型训练', { timeout: 10000 });
    await takeStepScreenshot('before-start');
    await page.click('button:has-text("开始训练")');
    await page.waitForSelector('text=训练', { timeout: 10000 });
    await takeStepScreenshot('training-in-progress');
    await page.waitForSelector('text=训练完成', { timeout });
    await takeStepScreenshot('training-completed');
  }

  async function executeReportExport(): Promise<void> {
    await navigateTo('/report');
    await page.waitForSelector('text=报告', { timeout: 10000 });
    await wait(3000);
    await takeStepScreenshot('report-overview');
    await takeStepScreenshot('metrics-summary');
  }
}