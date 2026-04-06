/**
 * Playwright GIF 录制助手
 * 基于 Playwright 视频输出，提供命名规范和生成 GIF 能力
 * 遵循 xs-playwright-screenshot Skill 定义
 */

import path from 'path';
import fs from 'fs';
import type { BrowserContext } from '@playwright/test';

/**
 * GIF 录制选项
 */
export interface GifRecordingOptions {
  /** 测试套件名称（对应页面功能模块，小写连字符 */
  testSuite: string;
  /** 场景名称（对应录制的流程，小写连字符 */
  scenarioName: string;
  /** 是否添加时间戳避免覆盖，默认 true */
  addTimestamp?: boolean;
  /** FPS，默认 10 */
  fps?: number;
  /** 是否保存到文档目录（docs/assets/gifs）用于项目展示，默认 false */
  saveToDocsAsset?: boolean;
  /** 文档功能目录名（仅当 saveToDocsAsset = true 时使用 */
  docsFeatureDir?: string;
}

/**
 * 生成符合规范的 GIF 文件
 */
function generateGifFilename(scenarioName: string, addTimestamp: boolean): string {
  // 验证名称只包含小写字母、连字符和数字
  const validNameRegex = /^[a-z0-9-]+$/;
  if (!validNameRegex.test(scenarioName)) {
    throw new Error(
      `Invalid scenario name "${scenarioName}": must only contain lowercase letters, numbers, and hyphens`
    );
  }

  if (addTimestamp) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    return `${scenarioName}_${timestamp}.gif`;
  }
  return `${scenarioName}.gif`;
}

/**
 * 获取输出路径
 */
function getOutputPath(
  testSuite: string,
  filename: string,
  saveToDocsAsset: boolean,
  docsFeatureDir?: string
): string {
  const rootDir = path.resolve(__dirname, '../../..');

  if (saveToDocsAsset && docsFeatureDir) {
    return path.join(
      rootDir,
      'docs',
      'assets',
      'gifs',
      docsFeatureDir,
      filename
    );
  } else if (saveToDocsAsset) {
    return path.join(
      rootDir,
      'docs',
      'assets',
      'gifs',
      testSuite,
      filename
    );
  }

  return path.join(
    rootDir,
    'client',
    'e2e',
    'recordings',
    testSuite,
    filename
  );
}

/**
 * 确保输出目录存在
 */
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 生成 Markdown 链接模板
 */
function generateMarkdownLink(filePath: string, saveToDocsAsset: boolean): string {
  if (!saveToDocsAsset) return '';

  const rootDir = path.resolve(__dirname, '../../..');
  const relPath = path.relative(rootDir, filePath);
  const webPath = relPath.replace(/\\/g, '/');
  return `![演示](${webPath})`;
}

/**
 * 启动 GIF 录制（通过开启上下文视频录制）
 * @returns 最终输出文件路径（调用 stopRecording 后会保存到此路径）
 */
export function startGifRecording(
  context: BrowserContext,
  options: GifRecordingOptions
): string {
  const {
    testSuite,
    scenarioName,
    addTimestamp = true,
  } = options;

  // 验证测试套件名称格式
  const validNameRegex = /^[a-z0-9-]+$/;
  if (!validNameRegex.test(testSuite)) {
    throw new Error(
      `Invalid testSuite name "${testSuite}": must only contain lowercase letters, numbers, and hyphens`
    );
  }

  // 计算输出路径
  const filename = generateGifFilename(scenarioName, addTimestamp);
  const outputPath = getOutputPath(
    testSuite,
    filename,
    options.saveToDocsAsset || false,
    options.docsFeatureDir
  );

  ensureDirectoryExists(outputPath);

  // Playwright 会自动处理视频录制到配置的 outputDir
  // 这里我们只记录最终目标路径，在 stop 阶段移动并转换
  // eslint-disable-next-line no-console
  console.log(`\n▶️  GIF recording started. Final output will be: ${outputPath}`);

  return outputPath;
}

/**
 * 停止录制并完成处理
 * 注意：Playwright 输出是 WebM 格式，如果需要 GIF 需要额外转换
 * 推荐使用 ffmpeg 进行转换
 *   ffmpeg -i input.webm -vf "fps=10,scale=iw:-1:flags=lanczos" output.gif
 *
 * @param recordedVideoPath Playwright 自动录制的 .webm 文件路径
 * @param finalOutputPath 从 startGifRecording 获取的最终路径
 * @param options 录制选项
 */
export async function stopGifRecording(
  recordedVideoPath: string,
  finalOutputPath: string,
  options: GifRecordingOptions
): Promise<string> {
  const { fps = 10 } = options;

  ensureDirectoryExists(finalOutputPath);

  // 如果系统有 ffmpeg，可以自动转换
  // 否则提醒用户手动转换
  try {
    // 检查 ffmpeg 是否可用
    const checkFfmpeg = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      checkFfmpeg.exec('ffmpeg -version', (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // ffmpeg 可用，自动转换
    // eslint-disable-next-line no-console
    console.log(`\n🎬 Converting video to GIF...`);

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-i', recordedVideoPath,
        '-vf', `fps=${fps},scale=iw:-1:flags=lanczos`,
        finalOutputPath,
      ];

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('child_process').exec(`ffmpeg ${args.join(' ')}`, (error: Error | null) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // eslint-disable-next-line no-console
    console.log(`\n✅ GIF saved to: ${finalOutputPath}`);
    if (options.saveToDocsAsset) {
      // eslint-disable-next-line no-console
      console.log(`  Markdown link:\n  ${generateMarkdownLink(finalOutputPath, true)}`);
    }

    return finalOutputPath;
  } catch {
    // ffmpeg 不可用，直接复制原始视频
    const webmOutput = finalOutputPath.replace(/\.gif$/, '.webm');
    fs.copyFileSync(recordedVideoPath, webmOutput);
    // eslint-disable-next-line no-console
    console.warn(`\n⚠️  ffmpeg not found. Video saved as WebM: ${webmOutput}`);
    // eslint-disable-next-line no-console
    console.warn(`   To convert to GIF manually, install ffmpeg and run:`);
    // eslint-disable-next-line no-console
    console.warn(`   ffmpeg -i ${webmOutput} -vf "fps=${fps},scale=iw:-1" ${finalOutputPath}`);
    return webmOutput;
  }
}

/**
 * 清理录制
 */
export async function cleanRecordings(testSuite?: string): Promise<void> {
  const rootDir = path.resolve(__dirname, '../../../client/e2e/recordings');

  if (testSuite) {
    const dir = path.join(rootDir, testSuite);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return;
  }

  // 清理所有录制，保留 .gitkeep
  if (!fs.existsSync(rootDir)) return;

  const items = fs.readdirSync(rootDir);
  for (const item of items) {
    if (item !== '.gitkeep') {
      const fullPath = path.join(rootDir, item);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}