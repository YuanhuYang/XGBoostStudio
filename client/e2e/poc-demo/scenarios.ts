/**
 * POC演示场景定义
 * 遵循 xs-poc-demo Skill 契约
 */

import path from 'path';

export interface POCScenario {
  // 场景唯一ID
  id: string;
  // 场景显示名称
  name: string;
  // 场景描述
  description: string;
  // 预期执行时长（毫秒）
  estimatedDuration: number;
  // 是否需要用户提供数据源
  requireDataSource: boolean;
  // 默认数据源路径（内置场景??
  defaultDataSourcePath?: string;
  // 任务类型（分??回归??
  taskType?: 'classification' | 'regression';
  // 目标列名称（若用户不指定则用默认??
  defaultTargetColumn?: string;
}

// 内置场景定义
export const builtInScenarios: POCScenario[] = [
  {
    id: 'full-pipeline',
    name: '完整端到端流水线',
    description: '数据导入 ??特征分析 ??模型训练 ??模型评估 ??报告生成，完整走通全流程',
    estimatedDuration: 5 * 60 * 1000, // 5分钟
    requireDataSource: false,
    defaultDataSourcePath: path.join(__dirname, 'fixtures', 'breast-cancer-sample.csv'),
    defaultTargetColumn: 'diagnosis',
    taskType: 'classification',
  },
  {
    id: 'data-import',
    name: '数据导入演示',
    description: '上传CSV/Excel ??数据预览 ??目标列选择 ??确认导入',
    estimatedDuration: 30 * 1000, // 30??
    requireDataSource: true,
    defaultTargetColumn: 'target',
    taskType: 'classification',
  },
  {
    id: 'feature-analysis',
    name: '特征分析演示',
    description: '导入????相关性热力图 ??重要性排????特征分布查看',
    estimatedDuration: 60 * 1000, // 1分钟
    requireDataSource: false,
    defaultDataSourcePath: path.join(__dirname, 'fixtures', 'breast-cancer-sample.csv'),
    defaultTargetColumn: 'diagnosis',
    taskType: 'classification',
  },
  {
    id: 'model-training',
    name: '模型训练演示',
    description: '参数配置 ??启动训练 ??实时进度监控 ??训练完成展示',
    estimatedDuration: 2 * 60 * 1000, // 2分钟
    requireDataSource: false,
    defaultDataSourcePath: path.join(__dirname, 'fixtures', 'breast-cancer-sample.csv'),
    defaultTargetColumn: 'diagnosis',
    taskType: 'classification',
  },
  {
    id: 'report-export',
    name: '报告生成演示',
    description: '训练完成 ??生成HTML报告 ??关键指标截图展示',
    estimatedDuration: 60 * 1000, // 1分钟
    requireDataSource: false,
    defaultDataSourcePath: path.join(__dirname, 'fixtures', 'breast-cancer-sample.csv'),
    defaultTargetColumn: 'diagnosis',
    taskType: 'classification',
  },
];

/**
 * 列出所有内置场??
 */
export function listScenarios(): POCScenario[] {
  return builtInScenarios;
}

/**
 * 根据ID获取场景
 */
export function getScenarioById(id: string): POCScenario | undefined {
  return builtInScenarios.find(s => s.id === id);
}

/**
 * 验证场景配置是否完整
 */
export function validateScenario(scenario: POCScenario, userDataSourcePath?: string): {
  valid: boolean;
  error?: string;
} {
  if (scenario.requireDataSource && !userDataSourcePath) {
    return {
      valid: false,
      error: `场景 "${scenario.name}" 需要用户提供数据源路径，但未指定`,
    };
  }

  if (!scenario.requireDataSource && !scenario.defaultDataSourcePath) {
    return {
      valid: false,
      error: `内置场景 "${scenario.name}" 缺少默认数据源配置`,
    };
  }

  if (userDataSourcePath) {
    const ext = path.extname(userDataSourcePath).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      return {
        valid: false,
        error: `不支持的文件格式 "${ext}"，仅支持 .csv, .xlsx, .xls`,
      };
    }
  }

  return { valid: true };
}
