package main

import (
	"reflect"
	"testing"
)

func TestReadProfilesExcludesSystemAndDeleted(t *testing.T) {
	got, err := readProfiles("testdata/userdata/Local State")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"Default": "Work", "Profile 1": "Spike B"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestReadContainersExactNames(t *testing.T) {
	got, err := readContainers("testdata/userdata/Default/Preferences")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"SpikeA": true, "Spike B": true, "Diseño": true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got["spikea"] {
		t.Fatal("container names must be case-sensitive")
	}
}

func TestReadContainersProfileWithoutList(t *testing.T) {
	got, err := readContainers("testdata/userdata/Profile 1/Preferences")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
}
