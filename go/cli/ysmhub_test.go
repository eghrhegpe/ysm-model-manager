package cli

import "testing"

func TestHubCommandIsRegistered(t *testing.T) {
	cmd, ok := GetCommand("hub")
	if !ok {
		t.Fatal("hub command was not registered")
	}
	if cmd.Name != "hub" {
		t.Fatalf("unexpected command: %#v", cmd)
	}
}

func TestParseHubFlagsValidatesFormatAndPageSize(t *testing.T) {
	flags, err := parseHubFlags("hub models", []string{"--format", "JSON", "--page-size", "60"})
	if err != nil {
		t.Fatal(err)
	}
	if flags.format != "json" || flags.pageSize != 60 {
		t.Fatalf("unexpected flags: %#v", flags)
	}
	if _, err := parseHubFlags("hub models", []string{"--format", "xml"}); err == nil {
		t.Fatal("invalid format should fail")
	}
	if _, err := parseHubFlags("hub models", []string{"--page-size", "61"}); err == nil {
		t.Fatal("page size above documented maximum should fail")
	}
}
