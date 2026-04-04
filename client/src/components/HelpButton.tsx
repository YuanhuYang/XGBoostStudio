import React, { useState } from 'react'
import { Button, Drawer, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

interface HelpItem {
  title: string
  content: string
}

interface HelpButtonProps {
  pageTitle?: string
  items?: HelpItem[]
}

const defaultItems: HelpItem[] = [
  { title: '如何开始？', content: '依次完成：导入数据 → 特征分析 → 训练模型 → 查看评估 → 生成报告。' },
  { title: '训练卡住了怎么办？', content: '检查数据是否含有目标列，数据量建议 100 行以上，训练参数 n_estimators 不要设置过大。' },
  { title: '报告无法生成？', content: '确保模型已完成训练且评估指标已保存，若仍失败请重启后端服务。' },
]

const HelpButton: React.FC<HelpButtonProps> = ({ pageTitle, items }) => {
  const [open, setOpen] = useState(false)
  const helpItems = items ?? defaultItems

  return (
    <>
      <Button
        type="text"
        icon={<QuestionCircleOutlined />}
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 24,
          bottom: 40,
          zIndex: 999,
          color: '#94a3b8',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 20,
          padding: '4px 14px',
        }}
      >
        帮助
      </Button>
      <Drawer
        title={pageTitle ? `帮助 — ${pageTitle}` : '帮助'}
        placement="right"
        width={380}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { background: '#0f172a' }, header: { background: '#1e293b', color: '#f1f5f9' } }}
      >
        {helpItems.map((item) => (
          <div key={item.title} style={{ marginBottom: 20 }}>
            <Text strong style={{ color: '#f1f5f9', fontSize: 14 }}>
              {item.title}
            </Text>
            <Paragraph style={{ color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              {item.content}
            </Paragraph>
          </div>
        ))}
      </Drawer>
    </>
  )
}

export default HelpButton
