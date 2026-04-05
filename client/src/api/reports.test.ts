import { describe, it, expect, vi } from 'vitest'
import * as api from './reports'
import apiClient from './client'

vi.mock('./client', () => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  const mockDelete = vi.fn()
  return {
    default: {
      get: mockGet,
      post: mockPost,
      delete: mockDelete,
    },
  }
})

describe('api/reports', () => {
  describe('listReportTemplates', () => {
    it('calls GET /api/report-templates and returns data', async () => {
      const mockData = [{
        id: 1,
        name: '测试模板',
        description: '描述',
        is_builtin: false,
        sections: ['data_summary'],
        format_style: 'default' as const,
        created_at: '2026-01-01',
      }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })
      const result = await api.listReportTemplates()
      expect(apiClient.get).toHaveBeenCalledWith('/api/report-templates')
      expect(result).toEqual(mockData)
    })
  })

  describe('createReportTemplate', () => {
    it('calls POST /api/report-templates with correct payload', async () => {
      const mockPayload = {
        name: '测试',
        description: 'desc',
        sections: ['a', 'b'],
        format_style: 'apa' as const,
      }
      const mockData = { id: 1, ...mockPayload, created_at: 'x' }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockData })
      const result = await api.createReportTemplate(mockPayload)
      expect(apiClient.post).toHaveBeenCalledWith('/api/report-templates', mockPayload)
      expect(result).toEqual(mockData)
    })
  })

  describe('deleteReportTemplate', () => {
    it('calls DELETE /api/report-templates/{id}', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})
      await api.deleteReportTemplate(1)
      expect(apiClient.delete).toHaveBeenCalledWith('/api/report-templates/1')
    })
  })

  describe('generateReport', () => {
    it('calls POST /api/reports/generate with payload', async () => {
      const mockPayload = {
        model_id: 1,
        name: 'test',
        include_sections: ['a', 'b'],
        title: 'title',
        notes: 'notes',
      }
      const mockData = { id: 1, name: 'test', path: '/path', created_at: 'x' }
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockData })
      const result = await api.generateReport(mockPayload)
      expect(apiClient.post).toHaveBeenCalledWith('/api/reports/generate', mockPayload)
      expect(result).toEqual(mockData)
    })
  })

  describe('listReports', () => {
    it('calls GET /api/reports', async () => {
      const mockData = [{ id: 1, name: 'test', model_id: 1, path: 'x', report_type: 'single', created_at: 'x' }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData })
      const result = await api.listReports()
      expect(apiClient.get).toHaveBeenCalledWith('/api/reports')
      expect(result).toEqual(mockData)
    })
  })

  describe('deleteReport', () => {
    it('calls DELETE /api/reports/{id}', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})
      await api.deleteReport(1)
      expect(apiClient.delete).toHaveBeenCalledWith('/api/reports/1')
    })
  })
})
