/** 数据集相关类型 */
export interface Dataset {
  id: number
  name: string
  original_filename: string
  file_type: string
  sheet_name?: string
  rows?: number
  cols?: number
  target_column?: string
  task_type?: 'classification' | 'regression'
  created_at: string
  updated_at: string
}

export interface DatasetSplit {
  id: number
  dataset_id: number
  train_ratio: number
  random_seed: number
  stratify: boolean
  train_rows?: number
  test_rows?: number
  created_at: string
}

export interface ColumnStat {
  name: string
  dtype: string
  non_null: number
  missing: number
  missing_rate: number
  mean?: number
  median?: number
  std?: number
  min?: number
  max?: number
  unique: number
}

export interface DatasetStats {
  rows: number
  cols: number
  columns: ColumnStat[]
}

export interface PreviewData {
  columns: string[]
  data: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
}

export interface QualityScore {
  score: number
  missing_rate: number
  outlier_rate: number
  duplicate_rate: number
  suggestions: string[]
}

/** 模型相关类型 */
export interface Model {
  id: number
  name: string
  task_type: 'classification' | 'regression'
  metrics_json?: string
  params_json?: string
  dataset_id?: number
  split_id?: number
  tags?: string
  description?: string
  training_time_s?: number
  created_at: string
  updated_at: string
}

export interface TrainingTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  dataset_id?: number
  split_id?: number
  params_json?: string
  model_id?: number
  error_msg?: string
  created_at: string
  completed_at?: string
}

export interface TuningTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  dataset_id?: number
  split_id?: number
  strategy: string
  n_trials: number
  best_params_json?: string
  best_score?: number
  model_id?: number
  error_msg?: string
  created_at: string
  completed_at?: string
}

/** 训练进度 SSE 消息 */
export interface TrainingProgress {
  round: number
  total: number
  train_logloss?: number
  val_logloss?: number
  train_rmse?: number
  val_rmse?: number
  elapsed_s: number
}

/** 调优进度 SSE 消息 */
export interface TuningProgress {
  trial: number
  total: number
  score: number
  params: Record<string, unknown>
  best_score: number
  elapsed_s: number
}

/** XGBoost 参数 */
export interface XGBParams {
  n_estimators: number
  max_depth: number
  learning_rate: number
  subsample: number
  colsample_bytree: number
  min_child_weight: number
  gamma: number
  reg_alpha: number
  reg_lambda: number
  objective: string
  eval_metric: string
  seed: number
  tree_method: string
  device: string
}
