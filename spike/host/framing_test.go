package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"testing"
)

func TestReadMessageRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := writeMessage(&buf, map[string]string{"cmd": "ping"}); err != nil {
		t.Fatal(err)
	}
	got, err := readMessage(&buf, maxMessage)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"cmd":"ping"}` {
		t.Fatalf("got %s", got)
	}
}

func TestReadMessageRejectsTooLarge(t *testing.T) {
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, uint32(maxMessage+1))
	_, err := readMessage(&buf, maxMessage)
	if !errors.Is(err, errTooLarge) {
		t.Fatalf("want errTooLarge, got %v", err)
	}
}
