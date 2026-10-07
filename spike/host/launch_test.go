package main

import (
	"reflect"
	"testing"
)

func TestBuildArgs(t *testing.T) {
	got := buildArgs("Default", "Spike B", "https://example.com/")
	want := []string{"--profile-directory=Default", "--container=Spike B", "--", "https://example.com/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	got = buildArgs("Profile 1", "", "https://example.com/")
	want = []string{"--profile-directory=Profile 1", "--", "https://example.com/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
}
