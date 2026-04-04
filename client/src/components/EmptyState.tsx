import React from 'react'
import { Button, Typography } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

const { Text } = Typography

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      gap: 12,
    }}
  >
    <div style={{ fontSize: 48, color: '#334155', lineHeight: 1 }}>
      {icon ?? <InboxOutlined />}
    </div>
    <Text style={{ color: '#94a3b8', fontSize: 15, fontWeight: 500 }}>{title}</Text>
    {description && (
      <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
        {description}
      </Text>
    )}
    {actionText && onAction && (
      <Button type="primary" onClick={onAction} style={{ marginTop: 8 }}>
        {actionText}
      </Button>
    )}
  </div>
)

export default EmptyState
