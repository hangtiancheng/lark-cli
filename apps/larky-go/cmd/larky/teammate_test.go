package main

import "testing"

func TestParseTeammateFlagsAbsent(t *testing.T) {
	cases := [][]string{
		{},
		{"--help"},
		{"--something", "else"},
	}
	for _, args := range cases {
		if _, ok := parseTeammateFlags(args); ok {
			t.Errorf("parseTeammateFlags(%v) returned ok=true, want false", args)
		}
	}
}

func TestParseTeammateFlagsBasic(t *testing.T) {
	args := []string{"--teammate", "--team-name", "alpha", "--agent-name", "ann"}
	got, ok := parseTeammateFlags(args)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if got.teamName != "alpha" || got.memberName != "ann" {
		t.Errorf("parsed = %+v", got)
	}
}

func TestParseTeammateFlagsMissingValue(t *testing.T) {
	// Trailing flag without its value should not panic and just leave
	// the field empty so runTeammate can return a friendly error.
	args := []string{"--teammate", "--team-name"}
	got, ok := parseTeammateFlags(args)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if got.teamName != "" {
		t.Errorf("expected empty teamName, got %q", got.teamName)
	}
}

func TestParseTeammateFlagsIgnoresUnknown(t *testing.T) {
	args := []string{"--teammate", "--noise", "x", "--team-name", "t", "--agent-name", "m"}
	got, ok := parseTeammateFlags(args)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if got.teamName != "t" || got.memberName != "m" {
		t.Errorf("parsed = %+v", got)
	}
}
