import type { AccountPoolOperatorState, AccountPoolRecord } from '@/api/accounts'

import { extractRateLimitDisplaysFromSnapshots } from './utils.ts'

export type AccountPoolSortColumn = 'account' | 'operationalStatus' | 'quota' | 'recentSignal'

export interface AccountPoolSortDescriptor {
  column: AccountPoolSortColumn
  direction: 'ascending' | 'descending'
}

const ACCOUNT_POOL_STATE_ORDER: Record<AccountPoolOperatorState, number> = {
  routable: 0,
  cooling: 1,
  inventory: 2,
  pending_delete: 3,
}

function parseTimestamp(value?: string) {
  if (!value) {
    return null
  }
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function getRecordPrimaryLabel(record: AccountPoolRecord) {
  return record.email?.trim() || record.label
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function compareNumber(left: number, right: number, direction: 'ascending' | 'descending') {
  return direction === 'ascending' ? left - right : right - left
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: 'ascending' | 'descending',
) {
  if (left === null && right === null) {
    return 0
  }
  if (left === null) {
    return 1
  }
  if (right === null) {
    return -1
  }
  return compareNumber(left, right, direction)
}

function getStateRank(record: AccountPoolRecord) {
  return ACCOUNT_POOL_STATE_ORDER[record.operator_state] ?? 99
}

function getTrafficSignalTimestamp(record: AccountPoolRecord) {
  return record.last_signal_source === 'passive'
    ? parseTimestamp(record.last_signal_at)
    : null
}

function getRecentSignalTimestamp(record: AccountPoolRecord) {
  return (
    parseTimestamp(record.last_signal_at)
    ?? parseTimestamp(record.last_probe_at)
    ?? parseTimestamp(record.updated_at)
  )
}

function getQuotaSortValue(record: AccountPoolRecord) {
  const displays = extractRateLimitDisplaysFromSnapshots(record.rate_limits)
  if (displays.length === 0) {
    return null
  }
  return displays.reduce((min, item) => Math.min(min, item.remainingPercent), 100)
}

function compareRecordIdentity(left: AccountPoolRecord, right: AccountPoolRecord) {
  return compareText(getRecordPrimaryLabel(left), getRecordPrimaryLabel(right))
    || compareText(left.label, right.label)
    || compareText(left.id, right.id)
}

function compareDefaultRecords(left: AccountPoolRecord, right: AccountPoolRecord) {
  return compareNumber(getStateRank(left), getStateRank(right), 'ascending')
    || compareNullableNumber(
      getTrafficSignalTimestamp(left),
      getTrafficSignalTimestamp(right),
      'descending',
    )
    || compareRecordIdentity(left, right)
}

function compareOperationalStatusRecords(
  left: AccountPoolRecord,
  right: AccountPoolRecord,
  direction: 'ascending' | 'descending',
) {
  return compareNumber(getStateRank(left), getStateRank(right), direction)
    || compareNullableNumber(
      getTrafficSignalTimestamp(left),
      getTrafficSignalTimestamp(right),
      'descending',
    )
    || compareRecordIdentity(left, right)
}

function compareRecentSignalRecords(
  left: AccountPoolRecord,
  right: AccountPoolRecord,
  direction: 'ascending' | 'descending',
) {
  return compareNullableNumber(
    getTrafficSignalTimestamp(left),
    getTrafficSignalTimestamp(right),
    direction,
  )
    || compareNullableNumber(
      getRecentSignalTimestamp(left),
      getRecentSignalTimestamp(right),
      direction,
    )
    || compareRecordIdentity(left, right)
}

function compareQuotaRecords(
  left: AccountPoolRecord,
  right: AccountPoolRecord,
  direction: 'ascending' | 'descending',
) {
  return compareNullableNumber(
    getQuotaSortValue(left),
    getQuotaSortValue(right),
    direction,
  )
    || compareRecordIdentity(left, right)
}

function compareByDescriptor(
  left: AccountPoolRecord,
  right: AccountPoolRecord,
  descriptor: AccountPoolSortDescriptor,
) {
  switch (descriptor.column) {
    case 'account':
      return compareText(getRecordPrimaryLabel(left), getRecordPrimaryLabel(right))
        || compareText(left.label, right.label)
        || compareText(left.id, right.id)
    case 'operationalStatus':
      return compareOperationalStatusRecords(left, right, descriptor.direction)
    case 'quota':
      return compareQuotaRecords(left, right, descriptor.direction)
    case 'recentSignal':
      return compareRecentSignalRecords(left, right, descriptor.direction)
    default:
      return compareDefaultRecords(left, right)
  }
}

export function sortAccountPoolRecords(
  records: AccountPoolRecord[],
  descriptor?: AccountPoolSortDescriptor | null,
) {
  const next = [...records]
  next.sort((left, right) =>
    descriptor
      ? compareByDescriptor(left, right, descriptor)
      : compareDefaultRecords(left, right),
  )
  return next
}
