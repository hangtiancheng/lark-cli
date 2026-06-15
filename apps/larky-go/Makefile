.PHONY: dev build test lint clean

# Run with hot reload (requires: go install github.com/air-verse/air@latest)
dev:
	air

# Build the binary
build:
	go build -o larky ./cmd/larky

# Run tests
test:
	go test ./...

# Run linter
lint:
	go vet ./...

# Clean build artifacts
clean:
	rm -rf tmp/ larky build-errors.log
