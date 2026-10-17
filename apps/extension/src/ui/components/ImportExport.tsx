import type { Bindings, ExportFile, ImportError, LauncherData, ProfileInfo } from '@account-launcher/core'
import type { UiError, UiResults } from '@account-launcher/protocol'
import { useId, useState, type ChangeEvent } from 'react'
import type { MessageKey } from '../../i18n/i18n'
import { useClock } from '../clock-context'
import { useI18n } from '../i18n-context'
import { BINDINGS_SECTION_ID } from '../lib/anchors'
import { formatList } from '../lib/format'
import { buildExport, checkFileSize, previewImport, readImportText } from '../lib/import-export'
import type { Launcher } from '../state/useLauncher'
import { Dialog } from './Dialog'
import { ErrorBanner } from './ErrorBanner'

interface ImportExportProps {
  readonly data: LauncherData
  readonly bindings: Bindings
  readonly profiles: readonly ProfileInfo[]
  readonly send: Launcher['send']
  // Tras importar, vuelve a leer el estado sin esperar al aviso del almacenamiento.
  readonly reload: () => Promise<void>
  readonly download: (filename: string, text: string) => void
}

type Preview = { readonly file: ExportFile; readonly counts: ReturnType<typeof previewImport> }
type ImportResult = UiResults['data.import']
type Mode = 'merge' | 'replace'

const ERROR_KEYS: Readonly<Record<ImportError['code'], MessageKey>> = {
  too_large: 'import.error.too_large',
  invalid_json: 'import.error.invalid_json',
  not_launcher_file: 'import.error.not_launcher_file',
  unsupported_version: 'import.error.unsupported_version',
  invalid: 'import.error.invalid',
}

const COUNT_LABELS = [
  ['added', 'import.count.added'],
  ['updated', 'import.count.updated'],
  ['unchanged', 'import.count.unchanged'],
  ['removed', 'import.count.removed'],
] as const

// Exportar e importar una copia (§5.4). El archivo se mide antes de leerlo y se valida entero con core antes de enseñar
// nada; los problemas que se muestran ya vienen saneados (solo ruta y tipo de regla, como mucho 50).
export function ImportExport({ data, bindings, profiles, send, reload, download }: ImportExportProps) {
  const { t, language } = useI18n()
  const now = useClock()
  const [problem, setProblem] = useState<ImportError | undefined>()
  const [preview, setPreview] = useState<Preview | undefined>()
  const [result, setResult] = useState<
    { readonly summary: ImportResult; readonly names: readonly string[] } | undefined
  >()

  const exportCopy = (): void => {
    const { filename, text } = buildExport(data, bindings, profiles, now())
    download(filename, text)
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Permite elegir de nuevo el mismo archivo.
    event.target.value = ''
    setResult(undefined)
    if (file === undefined) return
    const size = checkFileSize(file.size)
    if (!size.ok) {
      setProblem(size.error)
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      setProblem({ code: 'invalid_json' })
      return
    }
    const parsed = readImportText(text)
    if (!parsed.ok) {
      setProblem(parsed.error)
      return
    }
    setProblem(undefined)
    setPreview({ file: parsed.value, counts: previewImport(data, parsed.value) })
  }

  const finish = (summary: ImportResult, file: ExportFile): void => {
    // Las identidades sin revincular solo importan en Varios perfiles; se nombran por su etiqueta.
    const names =
      data.settings.mode === 'multi'
        ? summary.unresolved.map((id) => {
            const known = [...file.data.identities, ...data.identities].find((identity) => identity.id === id)
            return known?.label ?? id
          })
        : []
    setResult({ summary, names })
    setPreview(undefined)
    void reload()
  }

  return (
    <div className="backup">
      <div className="backup__row">
        <button type="button" className="button" onClick={exportCopy}>
          {t('export.action')}
        </button>
        <p className="backup__note">{t('export.warning')}</p>
      </div>
      <div className="backup__row">
        <label className="button file-button">
          <input
            type="file"
            className="visually-hidden"
            accept="application/json,.json"
            onChange={(event) => {
              void chooseFile(event)
            }}
          />
          {t('import.action')}
        </label>
      </div>
      {problem === undefined ? null : <ImportProblem problem={problem} />}
      {result === undefined ? null : (
        <div className="backup__result" role="status">
          <p>
            {t('import.done', {
              added: result.summary.added,
              updated: result.summary.updated,
              unchanged: result.summary.unchanged,
              removed: result.summary.removed,
            })}
          </p>
          {result.names.length === 0 ? null : (
            <p>
              {t('import.unresolved', { list: formatList(language, result.names) })}{' '}
              <a
                href={`#${BINDINGS_SECTION_ID}`}
                onClick={(event) => {
                  // Sin esto el hash cambia la URL y el icono de la extensión abre otro dashboard en lugar de este.
                  event.preventDefault()
                  document.getElementById(BINDINGS_SECTION_ID)?.focus()
                }}
              >
                {t('import.unresolved.link')}
              </a>
            </p>
          )}
        </div>
      )}
      {preview === undefined ? null : (
        <ImportDialog
          preview={preview}
          revision={data.revision}
          send={send}
          onCancel={() => {
            setPreview(undefined)
          }}
          onDone={finish}
        />
      )}
    </div>
  )
}

function ImportProblem({ problem }: { readonly problem: ImportError }) {
  const { t } = useI18n()
  return (
    <div className="banner" role="alert">
      <div className="banner__text">
        <p className="banner__title">{t(ERROR_KEYS[problem.code])}</p>
        {problem.issues === undefined || problem.issues.length === 0 ? null : (
          <>
            <p className="banner__detail">{t('import.issues')}</p>
            <ul className="banner__list">
              {problem.issues.map((issue, position) => (
                <li key={position}>
                  <code>{issue}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

// Cierre ignorado mientras hay una importación en curso.
function ignore(): void {
  return
}

interface ImportDialogProps {
  readonly preview: Preview
  readonly revision: number
  readonly send: Launcher['send']
  readonly onCancel: () => void
  readonly onDone: (summary: ImportResult, file: ExportFile) => void
}

// Vista previa con los recuentos de cada modo. Elegir un modo confirma la importación.
function ImportDialog({ preview, revision, send, onCancel, onDone }: ImportDialogProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState<Mode | undefined>()
  const [failure, setFailure] = useState<UiError | undefined>()

  const confirm = async (mode: Mode): Promise<void> => {
    setPending(mode)
    setFailure(undefined)
    const { file } = preview
    const response = await send({
      type: 'data.import',
      revision,
      mode,
      data: file.data,
      bindingHints: file.bindingHints,
    })
    setPending(undefined)
    if (response.ok) onDone(response.result, file)
    else setFailure(response.error)
  }

  return (
    // Con una importación en curso, Escape no cierra el diálogo: la respuesta llegaría a un diálogo ya cerrado.
    <Dialog title={t('import.title')} onClose={pending === undefined ? onCancel : ignore}>
      <p className="dialog__message">{t('import.intro')}</p>
      {(['merge', 'replace'] as const).map((mode) => (
        <ImportMode
          key={mode}
          mode={mode}
          counts={preview.counts[mode]}
          busy={pending !== undefined}
          working={pending === mode}
          onChoose={() => {
            void confirm(mode)
          }}
        />
      ))}
      {failure === undefined ? null : <ErrorBanner error={failure} />}
      <div className="dialog__actions">
        <button type="button" className="button" disabled={pending !== undefined} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  )
}

interface ImportModeProps {
  readonly mode: Mode
  readonly counts: Preview['counts'][Mode]
  readonly busy: boolean
  readonly working: boolean
  readonly onChoose: () => void
}

function ImportMode({ mode, counts, busy, working, onChoose }: ImportModeProps) {
  const { t } = useI18n()
  const titleId = useId()
  return (
    <section className="import-mode" aria-labelledby={titleId}>
      <h3 id={titleId} className="import-mode__title">
        {t(mode === 'merge' ? 'import.merge' : 'import.replace')}
      </h3>
      <p className="import-mode__hint">{t(mode === 'merge' ? 'import.merge.hint' : 'import.replace.hint')}</p>
      {counts.ok ? (
        <dl className="counts">
          {COUNT_LABELS.filter(([name]) => mode === 'replace' || name !== 'removed').map(([name, label]) => (
            <div key={name} className="counts__item">
              <dt>{t(label)}</dt>
              <dd>{counts.value[name]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="import-mode__hint">{t(mode === 'merge' ? 'import.merge.blocked' : 'import.replace.blocked')}</p>
      )}
      <button
        type="button"
        className={mode === 'replace' ? 'button button--danger' : 'button button--primary'}
        disabled={busy || !counts.ok}
        onClick={onChoose}
      >
        {working ? t('import.working') : t(mode === 'merge' ? 'import.merge' : 'import.replace')}
      </button>
    </section>
  )
}
