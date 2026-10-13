import type { Result } from '@account-launcher/core'
import type { UiError, UiRequest, UiRequestType, UiResults } from '@account-launcher/protocol'
import type { SwEnv } from '../deps'

export type Handler<K extends UiRequestType> = (
  request: Extract<UiRequest, { type: K }>,
  env: SwEnv,
) => Promise<Result<UiResults[K], UiError>>
