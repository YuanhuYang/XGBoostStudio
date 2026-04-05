"use strict";
/**
 * Playwright GIF 录制助手
 * 基于 Playwright 视频输出，提供命名规范和�?GIF 能力
 * 遵循 xs-playwright-screenshot Skill 定义
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGifRecording = startGifRecording;
exports.stopGifRecording = stopGifRecording;
exports.cleanRecordings = cleanRecordings;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * 生成符合规范�?GIF 文件�?
 */
function generateGifFilename(scenarioName, addTimestamp) {
    // 验证名称只包含小写字母、连字符和数�?
    const validNameRegex = /^[a-z0-9-]+$/;
    if (!validNameRegex.test(scenarioName)) {
        throw new Error(`Invalid scenario name "${scenarioName}": must only contain lowercase letters, numbers, and hyphens`);
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
function getOutputPath(testSuite, filename, saveToDocsAsset, docsFeatureDir) {
    const rootDir = path_1.default.resolve(__dirname, '../../..');
    if (saveToDocsAsset && docsFeatureDir) {
        return path_1.default.join(rootDir, 'docs', 'assets', 'gifs', docsFeatureDir, filename);
    }
    else if (saveToDocsAsset) {
        return path_1.default.join(rootDir, 'docs', 'assets', 'gifs', testSuite, filename);
    }
    return path_1.default.join(rootDir, 'client', 'e2e', 'recordings', testSuite, filename);
}
/**
 * 确保输出目录存在
 */
function ensureDirectoryExists(filePath) {
    const dir = path_1.default.dirname(filePath);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
}
/**
 * 生成 Markdown 链接模板
 */
function generateMarkdownLink(filePath, saveToDocsAsset) {
    if (!saveToDocsAsset)
        return '';
    const rootDir = path_1.default.resolve(__dirname, '../../..');
    const relPath = path_1.default.relative(rootDir, filePath);
    const webPath = relPath.replace(/\\/g, '/');
    return `![演示](${webPath})`;
}
/**
 * 启动 GIF 录制（通过开启上下文视频录制�?
 * @returns 最终输出文件路径（调用 stopRecording 后会保存到此路径�?
 */
function startGifRecording(context, options) {
    const { testSuite, scenarioName, addTimestamp = true, } = options;
    // 验证测试套件名称格式
    const validNameRegex = /^[a-z0-9-]+$/;
    if (!validNameRegex.test(testSuite)) {
        throw new Error(`Invalid testSuite name "${testSuite}": must only contain lowercase letters, numbers, and hyphens`);
    }
    // 计算输出路径
    const filename = generateGifFilename(scenarioName, addTimestamp);
    const outputPath = getOutputPath(testSuite, filename, options.saveToDocsAsset || false, options.docsFeatureDir);
    ensureDirectoryExists(outputPath);
    // Playwright 会自动处理视频录制到配置�?outputDir
    // 这里我们只记录最终目标路径，�?stop 阶段移动并转�?
    // eslint-disable-next-line no-console
    console.log(`\n▶️  GIF recording started. Final output will be: ${outputPath}`);
    return outputPath;
}
/**
 * 停止录制并完成处�?
 * 注意：Playwright 输出�?WebM 格式，如果需�?GIF 需要额外转�?
 * 推荐使用 ffmpeg 进行转换�?
 *   ffmpeg -i input.webm -vf "fps=10,scale=iw:-1:flags=lanczos" output.gif
 *
 * @param recordedVideoPath Playwright 自动录制�?.webm 文件路径
 * @param finalOutputPath �?startGifRecording 获取的最终路�?
 * @param options 录制选项
 */
async function stopGifRecording(recordedVideoPath, finalOutputPath, options) {
    const { fps = 10 } = options;
    ensureDirectoryExists(finalOutputPath);
    // 如果系统�?ffmpeg，可以自动转�?
    // 否则提醒用户手动转换
    try {
        // 检�?ffmpeg 是否可用
        const checkFfmpeg = await Promise.resolve().then(() => __importStar(require('child_process')));
        await new Promise((resolve, reject) => {
            checkFfmpeg.exec('ffmpeg -version', (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
        // ffmpeg 可用，自动转�?
        // eslint-disable-next-line no-console
        console.log(`\n🎬 Converting video to GIF...`);
        await new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-i', recordedVideoPath,
                '-vf', `fps=${fps},scale=iw:-1:flags=lanczos`,
                finalOutputPath,
            ];
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('child_process').exec(`ffmpeg ${args.join(' ')}`, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
        // eslint-disable-next-line no-console
        console.log(`\n�?GIF saved to: ${finalOutputPath}`);
        if (options.saveToDocsAsset) {
            // eslint-disable-next-line no-console
            console.log(`  Markdown link:\n  ${generateMarkdownLink(finalOutputPath, true)}`);
        }
        return finalOutputPath;
    }
    catch {
        // ffmpeg 不可用，直接复制原始视频
        const webmOutput = finalOutputPath.replace(/\.gif$/, '.webm');
        fs_1.default.copyFileSync(recordedVideoPath, webmOutput);
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
 * 清理录制�?
 */
async function cleanRecordings(testSuite) {
    const rootDir = path_1.default.resolve(__dirname, '../../../client/e2e/recordings');
    if (testSuite) {
        const dir = path_1.default.join(rootDir, testSuite);
        if (fs_1.default.existsSync(dir)) {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
        return;
    }
    // 清理所有录制，保留 .gitkeep
    if (!fs_1.default.existsSync(rootDir))
        return;
    const items = fs_1.default.readdirSync(rootDir);
    for (const item of items) {
        if (item !== '.gitkeep') {
            const fullPath = path_1.default.join(rootDir, item);
            fs_1.default.rmSync(fullPath, { recursive: true, force: true });
        }
    }
}
