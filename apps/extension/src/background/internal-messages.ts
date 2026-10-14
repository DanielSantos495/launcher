import { NonceSchema } from '@account-launcher/protocol'
import * as v from 'valibot'

// Mensajes internos de la extensión que no forman parte de UiRequestSchema (DC6). `whoami.prove` solo lo acepta el
// router desde /whoami.html: la página lo envía con el nonce que el host puso en el fragmento de la URL.
export const WhoamiProveSchema = v.strictObject({ type: v.literal('whoami.prove'), nonce: NonceSchema })

export type WhoamiProve = v.InferOutput<typeof WhoamiProveSchema>

export interface WhoamiResult {
  readonly verifiedAt: string
}
