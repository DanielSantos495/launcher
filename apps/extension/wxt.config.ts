import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'es',
    minimum_chrome_version: '116',
    permissions: ['storage', 'nativeMessaging'],
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5SgBGbWJFiEsNwr8Naf4cOuejzzm6D0CDrxZUrrQVdDUK/+x6OA8yUZznAJd00wp4v7HgaY5uKzeuiCumgpsvTIkIJTY9JBgrJOcGhPhpdRD2IjeAUzPKAw6fu2s0bLRy7KjfJzP6X9vWfUCyf4fEJh/b1p9pmFzx9k4gyl1cwZ5A4RrAqnh8VBO4X8wZFOz1TS33GYmmq6U/6xgUX/QALIjuOqchsjc/RSfzf++F4jRbkN7/3TActTwpp88RWtHWmCEHlwp8ZmpzWKpmll31Asl8RDMXj1kmdn7Y2toq/iiAG2dnvdz/QGeTHB9UUlACdV9Ng5lJgXPsikNVRP93wIDAQAB',
    // WXT añade `icons` solo a partir de public/icon; el icono de la barra de herramientas se declara aquí.
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    commands: { _execute_action: { suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' } } },
  },
})
