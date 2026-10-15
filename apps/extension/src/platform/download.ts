// Descarga un texto como archivo JSON. Solo toca el DOM (un <a download> con un Blob), sin red ni API del navegador.
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // La descarga empieza de forma asíncrona: se libera la URL un poco después.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
