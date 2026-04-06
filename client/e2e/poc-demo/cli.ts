/**
 * POC 演示 CLI 工具
 * 允许从命令行直接运行指定的 POC 演示场景
 */

const { chromium } = require('playwright');
const { listScenarios, runPOCScenario } = require('./runner');
const { findDataFiles } = require('./utils');

/**
 * 打印帮助信息
 */
function printHelp(): void {
  console.log(`
XGBoost Studio POC Demo CLI

Usage:
  npm run poc -- <command> [options]

Commands:
  list                List all built-in scenarios
  find <directory>    Find CSV/Excel files in directory
  run <scenario-id>   Run specified scenario

Options for run:
  --data <path>       Path to custom CSV/Excel data file
  --target <column>   Target column name (required if custom data)
  --base-url <url>    Frontend base URL (default: http://localhost:5173)
  --gif               Enable GIF recording (default: false)
  --no-screenshots    Disable screenshots (default: enabled)
  --save-to-docs      Save output to docs assets (default: false)
  --docs-dir <name>   Docs feature directory name (default: poc/{scenario-id})
  --fps <number>      GIF FPS (default: 10)
  --timeout <ms>      Timeout in milliseconds (default: 300000)

Examples:
  npm run poc -- list
  npm run poc -- find ./data
  npm run poc -- run full-pipeline --gif --save-to-docs
  npm run poc -- run data-import --data ./my/data.csv --target target
`);
}

/**
 * 解析命令行参数
 */
function parseArgs(): {
  command: string;
  options: Record<string, string | boolean>;
  args: string[];
} {
  const args = process.argv.slice(2);
  const result = {
    command: '',
    options: {} as Record<string, string | boolean>,
    args: [] as string[],
  };

  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      // Flag without value
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        result.options[key] = true;
        i++;
      } else {
        // Option with value
        result.options[key] = args[i + 1];
        i += 2;
      }
    } else if (!result.command) {
      result.command = args[i];
      i++;
    } else {
      result.args.push(args[i]);
      i++;
    }
  }

  return result;
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const { command, options, args } = parseArgs();

  switch (command) {
    case 'list': {
      const scenarios = listScenarios();
      console.log('\n=== Built-in POC Scenarios ===\n');
      console.table(
        scenarios.map(s => ({
          ID: s.id,
          Name: s.name,
          Description: s.description.length > 40 ? s.description.slice(0, 40) + '...' : s.description,
          'Expected Duration': `${(s.estimatedDuration / 60000).toFixed(1)} min`,
          'Requires Data': s.requireDataSource ? 'Yes' : 'No',
        }))
      );
      console.log('\nRun with: npm run poc -- run <scenario-id>');
      break;
    }

    case 'find': {
      const directory = args[0] || '.';
      const files = findDataFiles(directory);
      console.log(`\n=== Found ${files.length} data file(s) in ${directory} ===\n`);
      files.forEach(f => console.log(`  ${f}`));
      break;
    }

    case 'run': {
      const scenarioId = args[0];
      if (!scenarioId) {
        console.error('Error: Missing scenario-id');
        printHelp();
        process.exit(1);
      }

      const scenarios = listScenarios();
      const scenario = scenarios.find(s => s.id === scenarioId);
      if (!scenario) {
        console.error(`Error: Scenario "${scenarioId}" not found. Run "npm run poc -- list" to see available scenarios.`);
        process.exit(1);
      }

      // Check if requires data
      if (scenario.requireDataSource && !('data' in options) && !scenario.defaultDataSourcePath) {
        console.error(`Error: Scenario "${scenarioId}" requires custom data. Use --data <path> to specify.`);
        process.exit(1);
      }

      const browser = await chromium.launch({
        headless: process.env.CI ? true : false,
      });

      try {
        const result = await runPOCScenario(browser, {
          scenario: scenarioId,
          dataSourcePath: typeof options.data === 'string' ? options.data : undefined,
          targetColumn: typeof options.target === 'string' ? options.target : undefined,
          baseURL: typeof options['base-url'] === 'string' ? options['base-url'] : 'http://localhost:5173',
          recordGif: !!options.gif,
          takeScreenshots: !options['no-screenshots'],
          saveToDocsAsset: !!options['save-to-docs'],
          docsFeatureDir: typeof options['docs-dir'] === 'string' ? options['docs-dir'] : `poc/${scenarioId}`,
          gifFps: typeof options.fps === 'string' ? parseInt(options.fps, 10) : 10,
          timeout: typeof options.timeout === 'string' ? parseInt(options.timeout, 10) : 5 * 60 * 1000,
        });

        await browser.close();

        console.log('\n=== POC Execution Result ===\n');
        console.log(`Scenario: ${result.scenario.name}`);
        console.log(`Status: ${result.success ? '? SUCCESS' : '? FAILED'}`);
        console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)} seconds`);
        console.log(`Screenshots: ${result.screenshotPaths.length}`);
        if (result.gifPath) {
          console.log(`GIF: ${result.gifPath}`);
        }

        if (!result.success && result.error) {
          console.log(`\nError at step: ${result.error.step}`);
          console.log(`Message: ${result.error.message}`);
          process.exit(1);
        }

        if (result.screenshotPaths.length > 0) {
          console.log('\nScreenshot files:');
          result.screenshotPaths.forEach((path, i) => {
            console.log(`  ${i + 1}. ${path}`);
          });
        }

        break;
      } catch (e) {
        await browser.close();
        console.error('\n? Unexpected error:', e);
        process.exit(1);
      }

      break;
    }

    case 'help':
    default: {
      printHelp();
      break;
    }
  }
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
