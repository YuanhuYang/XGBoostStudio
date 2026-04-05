"use strict";
/**
 * Playwright 截图助手 - 按规范命名并输出到约定目�?
 * 遵循 xs-playwright-screenshot Skill 定义的契�?
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.takeScreenshot = takeScreenshot;
exports.cleanTestScreenshots = cleanTestScreenshots;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * 生成符合规范的文件名
 */
function generateFilename(stepName, addTimestamp) {
    // 验证名称只包含小写字母、连字符和数�?
    const validNameRegex = /^[a-z0-9-]+$/;
    if (!validNameRegex.test(stepName)) {
        throw new Error(`Invalid step name "${stepName}": must only contain lowercase letters, numbers, and hyphens`);
    }
    if (addTimestamp) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        return `${stepName}_${timestamp}.png`;
    }
    return `${stepName}.png`;
}
/**
 * 计算完整输出路径
 */
function getOutputPath(testSuite, filename, saveToDocsAsset, docsFeatureDir) {
    const rootDir = path_1.default.resolve(__dirname, '../../..');
    if (saveToDocsAsset && docsFeatureDir) {
        // 文档用图输出�?docs/assets/screenshots/{docsFeatureDir}/
        return path_1.default.join(rootDir, 'docs', 'assets', 'screenshots', docsFeatureDir, filename);
    }
    else if (saveToDocsAsset) {
        // 文档用图输出�?docs/assets/screenshots/{testSuite}/
        return path_1.default.join(rootDir, 'docs', 'assets', 'screenshots', testSuite, filename);
    }
    // 测试截图输出�?client/e2e/screenshots/{testSuite}/
    return path_1.default.join(rootDir, 'client', 'e2e', 'screenshots', testSuite, filename);
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
 * 生成 Markdown 链接模板，方便复制粘贴到文档
 */
function generateMarkdownLink(filePath, saveToDocsAsset) {
    // 相对路径从项目根开�?
    if (saveToDocsAsset) {
        const relPath = path_1.default.relative(path_1.default.resolve(__dirname, '../../..'), filePath);
        // 转换为正斜杠用于 Markdown
        const webPath = relPath.replace(/\\/g, '/');
        return `![描述](${webPath})`;
    }
    return '';
}
/**
 * 按规范截�?
 * @returns 输出文件的绝对路�?
 */
async function takeScreenshot(options) {
    const { testSuite, stepName, page, addTimestamp = true, clip, saveToDocsAsset = false, docsFeatureDir, } = options;
    // 验证测试套件名称格式
    const validNameRegex = /^[a-z0-9-]+$/;
    if (!validNameRegex.test(testSuite)) {
        throw new Error(`Invalid testSuite name "${testSuite}": must only contain lowercase letters, numbers, and hyphens`);
    }
    // 生成文件名和路径
    const filename = generateFilename(stepName, addTimestamp);
    const outputPath = getOutputPath(testSuite, filename, saveToDocsAsset, docsFeatureDir);
    // 确保目录存在
    ensureDirectoryExists(outputPath);
    // 计算 clip 区域（如果提供了 selector�?
    let clipRect;
    if (clip) {
        const element = await page.locator(clip.selector).first();
        const box = await element.boundingBox();
        if (!box) {
            throw new Error(`Could not find element with selector "${clip.selector}" for clip`);
        }
        // 添加 padding
        const padding = clip.padding || 0;
        clipRect = {
            x: box.x - padding,
            y: box.y - padding,
            width: box.width + 2 * padding,
            height: box.height + 2 * padding,
        };
    }
    // 截图
    await page.screenshot({
        path: outputPath,
        fullPage: !clip,
        clip: clipRect,
        type: 'png',
    });
    // 输出日志�?Markdown 模板
    // eslint-disable-next-line no-console
    console.log(`\n�?Screenshot saved to: ${outputPath}`);
    if (saveToDocsAsset) {
        // eslint-disable-next-line no-console
        console.log(`  Markdown link:\n  ${generateMarkdownLink(outputPath, saveToDocsAsset)}`);
    }
    return outputPath;
}
/**
 * 清理测试截图目录（保�?.gitkeep�?
 */
async function cleanTestScreenshots(testSuite) {
    const rootDir = path_1.default.resolve(__dirname, '../../../client/e2e/screenshots');
    if (testSuite) {
        const dir = path_1.default.join(rootDir, testSuite);
        if (fs_1.default.existsSync(dir)) {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
        return;
    }
    // 清理所有截图，保留 .gitkeep
    const items = fs_1.default.readdirSync(rootDir);
    for (const item of items) {
        if (item !== '.gitkeep') {
            const fullPath = path_1.default.join(rootDir, item);
            fs_1.default.rmSync(fullPath, { recursive: true, force: true });
        }
    }
}
