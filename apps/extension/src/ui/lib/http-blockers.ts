import {
  isValidTemplate,
  normalizeUrl,
  type Account,
  type CustomService,
  type LauncherData,
} from '@account-launcher/core'

// Lo que impide desactivar allowHttp (punto 30 de f1a-decisiones): las cuentas y los servicios propios que dejarían de
// ser válidos con la política https. Se usa la misma comprobación que validateData, así que la lista coincide siempre
// con lo que el service worker rechazaría.
export function httpBlockers(data: LauncherData): {
  readonly accounts: readonly Account[]
  readonly services: readonly CustomService[]
} {
  const policy = { allowHttp: false }
  return {
    accounts: data.accounts.filter((account) => account.url !== undefined && !normalizeUrl(account.url, policy).ok),
    services: data.customServices.filter((service) => !isValidTemplate(service.urlTemplate, policy)),
  }
}
