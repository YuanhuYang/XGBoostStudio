import { useState, useEffect } from 'react'
import apiClient from '../api/client'

interface ColumnStat {
  name: string
  dtype: string
  mean?: number | null
}

interface UseDatasetColumnsResult {
  allColumns: string[]
  numericColumns: string[]
  loading: boolean
}

/**
 * 从 /api/datasets/{id}/stats 获取数据集列名
 * allColumns: 所有列
 * numericColumns: 数值列（dtype 含 int/float）
 */
export function useDatasetColumns(datasetId: number | null): UseDatasetColumnsResult {
  const [allColumns, setAllColumns] = useState<string[]>([])
  const [numericColumns, setNumericColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!datasetId) {
      setAllColumns([])
      setNumericColumns([])
      return
    }
    setLoading(true)
    apiClient
      .get(`/api/datasets/${datasetId}/stats`)
      .then(r => {
        const cols: ColumnStat[] = r.data?.columns ?? []
        setAllColumns(cols.map(c => c.name))
        setNumericColumns(
          cols
            .filter(c => /int|float/.test(c.dtype))
            .map(c => c.name)
        )
      })
      .catch(() => {
        setAllColumns([])
        setNumericColumns([])
      })
      .finally(() => setLoading(false))
  }, [datasetId])

  return { allColumns, numericColumns, loading }
}
