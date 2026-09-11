/**
 * Loomy account + points card contributed to Harness Plugin configuration.
 *
 * The chrome mirrors the official card shell byte for byte — see
 * `./card-css.ts` for why it is copied rather than imported — and every
 * interactive part is an official primitive: `IconChevronDownOutline14` for the
 * header chevron, `StateDot` for sign-in state, `Button` for the refresh
 * action, `Tag` for the model count. Those come from
 * `@deepseek-ai/dsh-client-ui-primitives`, which the web shell publishes in its
 * static module table, so they cost this bundle nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconRefreshOutline14,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { LOOMY_STATUS_PATH } from '../status-paths.ts'
import type { LoomyWebStatus } from '../status-paths.ts'
import type { LoomySettingsKey } from './locales.ts'
import { CSS } from './card-css.ts'

/** Localized copy injected by the browser-plugin registration. */
export interface LoomyPluginCardInjected {
  t: (key: LoomySettingsKey, params?: Record<string, unknown>) => string
}

/** Props delivered by the Plugin configuration item slot. */
export type LoomyPluginCardProps =
  PropsRuntime<'settings.plugin.item'>
  & Partial<LoomyPluginCardInjected>

const POLL_INTERVAL_MS = 60_000

/** Shortest time the refresh button stays visibly busy. */
const MIN_BUSY_MS = 600

/** Join the base class with its modifier, the way the official shell does. */
function withModifier(base: string, modifier: string, on: boolean): string {
  return on ? `${base} ${modifier}` : base
}

/** Map our transport outcome onto the primitive's state vocabulary. */
function dotState(status: LoomyWebStatus['status']): StateDotState {
  switch (status) {
    case 'signed-in': return 'done'
    case 'error': return 'error'
    default: return 'idle'
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value)
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

/**
 * The rate or promo Loomy appends to a model name — `…（x3.0）`, `…（限时免费）`.
 *
 * Mirrors the tags `catalog.ts` parses, anchored to the end so a name that
 * legitimately contains parentheses keeps them.
 */
const NAME_TAG = /[（(]\s*(?:x\s*[0-9]+(?:\.[0-9]+)?|[^（）()]*免费[^（）()]*)\s*[）)]\s*$/u

/** The model name without the rate tag, which the card shows in its own column. */
function modelName(name: string): string {
  return name.replace(NAME_TAG, '').trim()
}

/** Loomy's own spelling, one decimal: 3 → `x3.0`, 3.3 → `x3.3`. */
function formatRate(rate: number): string {
  return `x${Number.isInteger(rate) ? rate.toFixed(1) : rate}`
}

/** Compact token count: 262144 → `262K`, 1_048_576 → `1M`. */
function formatContext(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Math.round(millions * 10) / 10}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

/**
 * Localize the promotional label Loomy prints, falling back to its own wording
 * for anything this card has no translation for yet.
 */
function promoLabel(promo: string, t: LoomyPluginCardInjected['t']): string {
  return /免费/u.test(promo) ? t('badgeLimitedFree') : promo
}

/** One labelled number: the permanent or the daily-gift balance. */
function PointsTile({ label, value, hint }: { label: string; value: number; hint: string }): ReactElement {
  return (
    <div className={CSS.tile}>
      <div className={CSS.tileLabel}>{label}</div>
      <div className={CSS.tileValue}>{formatNumber(value)}</div>
      <div className={CSS.tileHint}>{hint}</div>
    </div>
  )
}

/** Render Loomy sign-in state and points as one expandable card. */
export function LoomyPluginCard({ t }: LoomyPluginCardProps): ReactElement {
  if (t === undefined) throw new Error('Loomy plugin card requires its translation function')
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LoomyWebStatus>({ status: 'signed-out' })
  const [busy, setBusy] = useState(false)
  /** Which of the three tabs (积分 / 模型 / 生图) is showing. */
  const [tab, setTab] = useState<'account' | 'models' | 'imagegen'>('account')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const refresh = useCallback(
    async (signal?: AbortSignal, force = false) => {
      try {
        // `force` is the manual button: it makes the host re-pull the catalog
        // and re-read Loomy's points cache instead of answering from memory.
        const response = await fetch(force ? `${LOOMY_STATUS_PATH}?refresh=1` : LOOMY_STATUS_PATH, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          ...signal === undefined ? {} : { signal },
        })
        const value = (await response.json().catch(() => undefined)) as LoomyWebStatus | undefined
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (mounted.current && signal?.aborted !== true && value !== undefined) setStatus(value)
      } catch (error) {
        if (mounted.current && signal?.aborted !== true) {
          setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
        }
      }
    },
    [t],
  )
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => {
      controller.abort()
    }
  }, [open, refresh])
  useEffect(() => {
    if (!open || status.status !== 'signed-in') return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      void refresh(controller.signal)
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [open, refresh, status.status])
  const manualRefresh = async (): Promise<void> => {
    setBusy(true)
    const started = Date.now()
    try {
      await refresh(undefined, true)
    } finally {
      // A reply fast enough to skip the animation reads as a dead button, so
      // hold the busy state long enough to be seen.
      const elapsed = Date.now() - started
      if (elapsed < MIN_BUSY_MS) await new Promise(resolve => window.setTimeout(resolve, MIN_BUSY_MS - elapsed))
      if (mounted.current) setBusy(false)
    }
  }
  const title = t('title')
  const label =
    status.status === 'signed-in'
      ? status.account === undefined
        ? t('signedIn')
        : t('signedInAs', { account: status.account })
      : status.status === 'error'
        ? t('requestFailed')
        : t('signedOut')
  const rawUpdatedAt = status.status === 'signed-in' ? status.points?.updatedAt : undefined
  const updatedMs = rawUpdatedAt === undefined ? undefined : Date.parse(rawUpdatedAt)
  const models = status.status === 'signed-in' ? status.models : undefined
  // The list also carries image generators the provider never serves, so the
  // count in the tag and the row count differ unless both are explained.
  const imageCount = models === undefined ? 0 : models.filter(model => model.image === true).length
  return (
    <li className={withModifier(CSS.card, CSS.cardOpen, open)}>
      <button
        type="button"
        className={CSS.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className={CSS.headText}>
          <span className={CSS.name}>{title}</span>
          <span className={CSS.description}>{t('intro')}</span>
        </span>
        <IconChevronDownOutline14 className={withModifier(CSS.chevron, CSS.chevronOpen, open)} />
      </button>
      {open
        ? (
          <div className={CSS.body}>
            <div className={CSS.section}>
              <div className={CSS.row}>
                <div className={CSS.status} role="status">
                  <StateDot state={dotState(status.status)} />
                  <span>{label}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void manualRefresh()}
                >
                  <span className={CSS.refreshInner}>
                    <IconRefreshOutline14 className={busy ? CSS.refreshSpin : undefined} />
                    <span>{busy ? t('refreshing') : t('refresh')}</span>
                  </span>
                </Button>
              </div>
            </div>
            {status.status === 'signed-in'
              ? (
                <>
                  <div className={CSS.tabs} role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'account'}
                      className={withModifier(CSS.tab, CSS.tabActive, tab === 'account')}
                      onClick={() => setTab('account')}
                    >
                      {t('tabPoints')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'models'}
                      className={withModifier(CSS.tab, CSS.tabActive, tab === 'models')}
                      onClick={() => setTab('models')}
                    >
                      {t('tabModels')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'imagegen'}
                      className={withModifier(CSS.tab, CSS.tabActive, tab === 'imagegen')}
                      onClick={() => setTab('imagegen')}
                    >
                      {t('tabImagegen')}
                    </button>
                  </div>
                  {tab === 'account'
                    ? (
                      <>
                        {/* 登录态与账号在卡片顶部的状态行里已展示（StateDot + label），
                            这里不再重复渲染账号小节，「积分」标签页只承载积分余额。 */}
                        <div className={CSS.section}>
                          <h3 className={CSS.heading}>{t('pointsHeading')}</h3>
                          {status.points === undefined
                            ? <p className={CSS.text}>{t('pointsUnavailable')}</p>
                            : (
                              <>
                                <div className={CSS.tiles}>
                                  <PointsTile
                                    label={t('permanentPoints')}
                                    value={status.points.permanent}
                                    hint={t('permanentPointsHint')}
                                  />
                                  <PointsTile
                                    label={t('dailyPoints')}
                                    value={status.points.daily}
                                    hint={t('dailyPointsHint')}
                                  />
                                </div>
                                {updatedMs === undefined || Number.isNaN(updatedMs)
                                  ? null
                                  : <p className={CSS.hint}>{t('updatedAt', { time: formatTime(updatedMs) })}</p>}
                                <p className={CSS.hint}>{t('pointsSourceHint')}</p>
                              </>
                            )}
                          {status.pointsError === undefined
                            ? null
                            : <p className={CSS.error}>{t('pointsError', { message: status.pointsError })}</p>}
                        </div>
                      </>
                    )
                    : tab === 'models'
                      ? (
                      <div className={CSS.section}>
                        <div className={CSS.row}>
                          <h3 className={CSS.heading}>{t('modelsHeading')}</h3>
                          <Tag tone="neutral">{t('modelsTag', { count: status.modelCount })}</Tag>
                        </div>
                        {models === undefined
                          ? null
                          : (
                            <>
                              <ul className={CSS.list}>
                                {models.map(model => (
                                  <li key={model.id} className={CSS.listItem}>
                                    <span className={CSS.listMain}>
                                      <span className={CSS.listName}>{modelName(model.name)}</span>
                                      <span className={CSS.typeChip}>
                                        {model.image === true ? t('modelsImage') : t('typeChat')}
                                      </span>
                                    </span>
                                    <span className={CSS.listMeta}>
                                      {model.contextWindow === undefined
                                        ? <span className={CSS.ctx}>{t('modelsContextUnknown')}</span>
                                        : <span className={CSS.ctx}>{t('modelsContext', { size: formatContext(model.contextWindow) })}</span>}
                                      {model.rate === undefined
                                        ? null
                                        : <span className={CSS.pill}>{formatRate(model.rate)}</span>}
                                      {model.promo === undefined
                                        ? null
                                        : <span className={CSS.pill}>{promoLabel(model.promo, t)}</span>}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {imageCount === 0
                                ? null
                                : <p className={CSS.hint}>{t('modelsImageHint', { count: imageCount })}</p>}
                            </>
                          )}
                      </div>
                      )
                      : (
                        <div className={CSS.section}>
                          <div className={CSS.row}>
                            <h3 className={CSS.heading}>{t('imagegenHeading')}</h3>
                            {imageCount === 0 ? null : <Tag tone="neutral">{t('imagegenTag', { count: imageCount })}</Tag>}
                          </div>
                          <p className={CSS.text}>{t('imagegenComingSoon')}</p>
                          {models === undefined
                            ? null
                            : imageCount === 0
                              ? <p className={CSS.hint}>{t('imagegenNone')}</p>
                              : (
                                <>
                                  <ul className={CSS.list}>
                                    {models.filter(model => model.image === true).map(model => (
                                      <li key={model.id} className={CSS.listItem}>
                                        <span className={CSS.listMain}>
                                          <span className={CSS.listName}>{modelName(model.name)}</span>
                                          <span className={CSS.pill}>{t('imagegenPill')}</span>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className={CSS.hint}>{t('imagegenHint', { count: imageCount })}</p>
                                </>
                              )}
                        </div>
                      )}
                </>
              )
              : null}
            {status.status === 'signed-out' ? <p className={CSS.text}>{t('signedOutHint')}</p> : null}
            {status.status === 'error' ? <p className={CSS.error}>{status.message}</p> : null}
          </div>
        )
        : null}
    </li>
  )
}
