/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon'
import { lexicons } from '../../../lexicons'
import { isObj, hasProp } from '../../../util'
import { CID } from 'multiformats/cid'
import * as ComAtprotoRepoStrongRef from '../../com/atproto/repo/strongRef'

export interface Record {
  /** comment body */
  content: string
  /** comment creation timestamp */
  createdAt: string
  post: ComAtprotoRepoStrongRef.Main
  [k: string]: unknown
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'li.plonk.comment#main' || v.$type === 'li.plonk.comment')
  )
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('li.plonk.comment#main', v)
}
