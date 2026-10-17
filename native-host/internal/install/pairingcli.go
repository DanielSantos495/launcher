package install

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/DanielSantos495/launcher/native-host/internal/pairing"
	"github.com/DanielSantos495/launcher/native-host/internal/protocol"
	"github.com/DanielSantos495/launcher/native-host/internal/store"
)

// storeLockTimeout es lo que espera la línea de órdenes a que otro proceso suelte el almacén.
const storeLockTimeout = 5 * time.Second

// Pairing cambia el emparejamiento del navegador indicado (D20). reset borra las instalaciones emparejadas, el código y
// las pruebas pendientes y conserva la revisión, los datos, los vínculos y los iconos; max (de 1 a 16, 0 = sin cambio)
// fija el máximo de perfiles emparejados. Necesita un almacén ya creado.
func Pairing(o Options, reset bool, max int) error {
	o = o.defaults()
	if err := checkOS(); err != nil {
		return err
	}
	if len(o.Browsers) != 1 {
		return usageError("indica un navegador con --browser")
	}
	b, err := byName(o.Home, o.Browsers[0])
	if err != nil {
		return err
	}
	if max < 0 || max > protocol.MaxPairedProfilesLimit {
		return usageError(fmt.Sprintf("--max debe estar entre 1 y %d", protocol.MaxPairedProfilesLimit))
	}
	if !reset && max == 0 {
		return usageError("indica --reset y/o --max N")
	}

	app := AppDir(o.Home, b.Name)
	if _, err := os.Stat(filepath.Join(app, store.FileName)); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("no hay almacén compartido de %s todavía (se crea con el primer emparejamiento)", b.Name)
		}
		return fmt.Errorf("no se pudo comprobar el almacén de %s: %w", b.Name, err)
	}
	s, err := store.Open(app, storeLockTimeout)
	if err != nil {
		return fmt.Errorf("no se pudo abrir el almacén de %s: %w", b.Name, err)
	}
	defer s.Close()
	st, err := s.Load()
	if err != nil {
		return fmt.Errorf("el almacén de %s no es válido: %w", b.Name, err)
	}
	if st == nil {
		return fmt.Errorf("no hay almacén compartido de %s todavía", b.Name)
	}
	if reset {
		pairing.Reset(st)
	}
	if max > 0 {
		st.MaxPairedProfiles = max
	}
	if err := s.Save(st); err != nil {
		return fmt.Errorf("no se pudo guardar el almacén de %s: %w", b.Name, err)
	}
	if reset {
		fmt.Fprintf(o.Out, "%s: emparejamientos borrados (se conservan los datos y los iconos).\n", b.Name)
	}
	if max > 0 {
		fmt.Fprintf(o.Out, "%s: máximo de perfiles emparejados = %d.\n", b.Name, max)
		if len(st.Paired) > max {
			fmt.Fprintf(o.Out, "Aviso: hay %d instalaciones emparejadas, más que el nuevo máximo.\n", len(st.Paired))
		}
	}
	return nil
}
