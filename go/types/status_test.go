// ===== go/types 留守域补测：StatusToLevel =====
package types

import (
	"testing"
)

func TestStatusToLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected LogLevel
	}{
		{"success", LevelInfo},
		{"failed", LevelError},
		{"warn", LevelWarn},
		{"skipped", LevelDebug},
		{"unknown", LevelInfo},
		{"", LevelInfo},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := StatusToLevel(tt.input)
			if got != tt.expected {
				t.Errorf("StatusToLevel(%q) = %q, 期望 %q", tt.input, got, tt.expected)
			}
		})
	}
}
