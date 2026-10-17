export const LOCAL_KEYS = {
  installation: 'installation',
  pairing: 'pairing',
  localData: 'localData',
  localBindings: 'localBindings',
  backup: 'backup',
  // Lista de las claves de imagen (icon:<id>) guardadas en storage.local: permite contarlas sin enumerar el área.
  iconIndex: 'iconIndex',
  // Carpetas de perfil que el aviso de "perfil nuevo" ya vio (máximo 200, las más antiguas se descartan).
  seenProfiles: 'seenProfiles',
} as const

// iconCache: índice de la caché de imágenes del host; cada imagen vive en su propia clave iconCache:<clave>.
export const SESSION_KEYS = { shared: 'shared', iconCache: 'iconCache' } as const
