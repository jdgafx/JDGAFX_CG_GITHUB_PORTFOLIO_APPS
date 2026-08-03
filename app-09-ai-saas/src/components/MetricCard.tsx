import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  /** Signed percentage change. Always rendered verbatim — never flipped to force a colour. */
  trend: number
  /** Whether a rising number is good. Drives the colour only; the arrow follows the sign. */
  higherIsBetter: boolean
  icon: React.ReactNode
  hint: string
  delay: number
}

export default function MetricCard({
  label,
  value,
  trend,
  higherIsBetter,
  icon,
  hint,
  delay,
}: MetricCardProps) {
  const isRising = trend > 0
  const isGood = higherIsBetter ? trend >= 0 : trend <= 0
  const trendLabel = `${isRising ? '+' : ''}${trend}%`
  const direction = isRising ? 'up' : trend < 0 ? 'down' : 'flat'
  const trendTitle = `${label} is ${direction} ${Math.abs(trend)}% versus the prior period — ${isGood ? 'an improvement' : 'a regression'}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      title={hint}
      style={{
        background: 'rgba(15, 15, 30, 0.8)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        borderRadius: '16px',
        padding: '24px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '120px',
          height: '120px',
          background: 'radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 70%)',
        }}
      />
      <div className="flex items-start justify-between mb-4">
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#818cf8',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <span
          title={trendTitle}
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: '6px',
            background: isGood ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)',
            color: isGood ? '#34d399' : '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            whiteSpace: 'nowrap',
          }}
        >
          {isRising ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {trendLabel}
        </span>
      </div>
      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
        {value}
      </p>
    </motion.div>
  )
}
