import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatDateTime } from '@/lib/i18n-format'

export interface TrendChartProps {
  data: Array<{ timestamp: string | number; [key: string]: unknown }>
  lines: Array<{ dataKey: string; stroke: string; name?: string }>
  height?: number
  locale?: string
  xAxisFormatter?: (val: string | number) => string
  valueFormatter?: (value: number) => string
}

function safeFormatDateTime(
  value: string | number,
  fallbackFormat: 'time' | 'datetime',
  locale?: string,
): string {
  const preset = fallbackFormat === 'time' ? 'time' : 'datetime'
  const directFormatted = formatDateTime(value, { locale, preset, fallback: '' })
  if (directFormatted) {
    return directFormatted
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      const numericFormatted = formatDateTime(numeric, { locale, preset, fallback: '' })
      if (numericFormatted) {
        return numericFormatted
      }
    }
  }

  return String(value)
}

export default function TrendChartCore({
  data,
  lines,
  height = 300,
  locale,
  xAxisFormatter,
  valueFormatter,
}: TrendChartProps) {
  const defaultFormatter = (val: string | number) => safeFormatDateTime(val, 'time', locale)
  const formatValue = (value: unknown) => {
    if (typeof value === 'number') {
      return valueFormatter ? valueFormatter(value) : String(value)
    }

    if (typeof value === 'string') {
      const numeric = Number(value)
      if (Number.isFinite(numeric) && valueFormatter) {
        return valueFormatter(numeric)
      }
    }

    return String(value ?? '')
  }

  return (
    <div style={{ width: '100%', minWidth: 0, minHeight: 1, height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <LineChart
          data={data}
          margin={{
            top: 5,
            right: 10,
            left: 10,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={xAxisFormatter || defaultFormatter}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            tickFormatter={formatValue}
            tickLine={false}
            axisLine={false}
            dx={-10}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              color: 'var(--popover-foreground)',
              borderRadius: '8px',
              fontSize: '14px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
            }}
            labelFormatter={(label) => safeFormatDateTime(label, 'datetime', locale)}
            formatter={(value) => formatValue(value)}
          />
          {lines.map((line, idx) => (
            <Line
              key={idx}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name || line.dataKey}
              stroke={line.stroke}
              strokeWidth={2}
              activeDot={{ r: 6, strokeWidth: 0 }}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
