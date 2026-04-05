import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { formatApiErrorDetail, getRequestErrorMessage } from './apiError'

describe('formatApiErrorDetail', () => {
  it('returns "请求失败" for null/empty input', () => {
    expect(formatApiErrorDetail(null)).toBe('请求失败')
    expect(formatApiErrorDetail('')).toBe('请求失败')
  })

  it('returns directly input when input is string', () => {
    expect(formatApiErrorDetail('测试错误')).toBe('测试错误')
  })

  it('formats array of error items with loc and msg', () => {
    const input = [
      { loc: ['body', 'name'], msg: '不能为空' },
      { loc: ['body', 'age'], msg: '必须大于0' },
    ]
    expect(formatApiErrorDetail(input)).toBe('name: 不能为空；age: 必须大于0')
  })

  it('handles mixed array of errors', () => {
    const input = [
      'string error',
      { msg: 'object error' },
      null,
      undefined,
    ]
    expect(formatApiErrorDetail(input)).toContain('string error')
    expect(formatApiErrorDetail(input)).toContain('object error')
  })
})

describe('getRequestErrorMessage', () => {
  it('returns Error message when error is standard Error', () => {
    const error = new Error('测试错误消息')
    expect(getRequestErrorMessage(error, 'fallback')).toBe('测试错误消息')
  })

  it('returns fallback when error has no message field', () => {
    expect(getRequestErrorMessage({}, 'fallback')).toBe('fallback')
  })

  it('extracts detail from axios error structure', () => {
    const error = {
      response: {
        data: {
          detail: '请求参数不正确',
        },
      },
    }
    expect(getRequestErrorMessage(error, 'fallback')).toBe('请求参数不正确')
  })

  it('extracts message from top level message field', () => {
    const error = {
      message: '网络错误',
    }
    expect(getRequestErrorMessage(error, 'fallback')).toBe('网络错误')
  })
})
