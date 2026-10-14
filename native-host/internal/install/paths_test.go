package install

import (
	"slices"
	"testing"
)

func TestBrowsersPaths(t *testing.T) {
	want := []Browser{
		{
			Name:        "brave",
			Exe:         "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			UserDataDir: "/h/Library/Application Support/BraveSoftware/Brave-Browser",
			ManifestDir: "/h/Library/Application Support/Google/Chrome/NativeMessagingHosts",
		},
		{
			Name:        "chrome",
			Exe:         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			UserDataDir: "/h/Library/Application Support/Google/Chrome",
			ManifestDir: "/h/Library/Application Support/Google/Chrome/NativeMessagingHosts",
		},
		{
			Name:        "edge",
			Exe:         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			UserDataDir: "/h/Library/Application Support/Microsoft Edge",
			ManifestDir: "/h/Library/Application Support/Microsoft Edge/NativeMessagingHosts",
		},
	}
	if got := Browsers("/h"); !slices.Equal(got, want) {
		t.Fatalf("Browsers = %+v\nquiero   %+v", got, want)
	}
}

func TestAppDir(t *testing.T) {
	for browser, want := range map[string]string{
		"brave":  "/h/Library/Application Support/AccountLauncher/brave",
		"chrome": "/h/Library/Application Support/AccountLauncher/chrome",
		"edge":   "/h/Library/Application Support/AccountLauncher/edge",
	} {
		if got := AppDir("/h", browser); got != want {
			t.Fatalf("AppDir(%q) = %q, quiero %q", browser, got, want)
		}
	}
}
