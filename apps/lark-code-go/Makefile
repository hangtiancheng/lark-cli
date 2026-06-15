.PHONY: dev build build-daemon build-cli build-tui test coverage lint clean start stop status

# Binaries
BINARY_DAEMON = larkd
BINARY_CLI = lark
BINARY_TUI = tui
TMP_DIR = tmp

# Run daemon with hot reload (requires: go install github.com/air-verse/air@latest)
dev:
	@echo "Starting daemon with hot reload..."
	air

# Build all three binaries
build: build-daemon build-cli build-tui

# Build daemon
build-daemon:
	@echo "Building $(BINARY_DAEMON)..."
	go build -o $(BINARY_DAEMON) ./cmd/larkd

# Build CLI
build-cli:
	@echo "Building $(BINARY_CLI)..."
	go build -o $(BINARY_CLI) ./cmd/lark

# Build TUI
build-tui:
	@echo "Building $(BINARY_TUI)..."
	go build -o $(BINARY_TUI) ./cmd/tui

# Run all tests
test:
	@echo "Running tests..."
	go test ./...

# Run tests with coverage
coverage:
	@echo "Running tests with coverage..."
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# Run linter
lint:
	@echo "Running linter..."
	go vet ./...

# Start daemon in background
start: build-daemon
	@echo "Starting daemon..."
	@./$(BINARY_CLI) core start || (./$(BINARY_DAEMON) & echo $$! > ~/.lark/$(BINARY_DAEMON).pid && echo "Daemon started (PID: $$(cat ~/.lark/$(BINARY_DAEMON).pid))")

# Stop daemon
stop:
	@echo "Stopping daemon..."
	@./$(BINARY_CLI) core stop || (if [ -f ~/.lark/$(BINARY_DAEMON).pid ]; then kill $$(cat ~/.lark/$(BINARY_DAEMON).pid) && rm ~/.lark/$(BINARY_DAEMON).pid && echo "Daemon stopped"; else echo "Daemon not running"; fi)

# Check daemon status
status:
	@./$(BINARY_CLI) core status || echo "Daemon not running"

# Ping daemon
ping:
	@./$(BINARY_CLI) ping

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf $(TMP_DIR)
	rm -f $(BINARY_DAEMON) $(BINARY_CLI) $(BINARY_TUI)
	rm -f build-errors.log
	rm -f coverage.out coverage.html

# Run in development mode (build all, start daemon, tail logs)
run: build
	@echo "Starting daemon..."
	./$(BINARY_DAEMON)

# Format code
fmt:
	@echo "Formatting code..."
	go fmt ./...

# Tidy dependencies
tidy:
	@echo "Tidying dependencies..."
	go mod tidy

# Show help
help:
	@echo "lark-code-go development commands:"
	@echo ""
	@echo "  make dev       - Start daemon with hot reload (requires air)"
	@echo "  make build     - Build all binaries (daemon, cli, tui)"
	@echo "  make test      - Run all tests"
	@echo "  make coverage  - Run tests with coverage report"
	@echo "  make lint      - Run static analysis"
	@echo "  make start     - Start daemon in background"
	@echo "  make stop      - Stop daemon"
	@echo "  make status    - Check daemon status"
	@echo "  make ping      - Ping daemon"
	@echo "  make clean     - Remove build artifacts"
	@echo "  make fmt       - Format code"
	@echo "  make tidy      - Tidy dependencies"
	@echo ""
	@echo "Individual builds:"
	@echo "  make build-daemon  - Build daemon only"
	@echo "  make build-cli     - Build CLI only"
	@echo "  make build-tui     - Build TUI only"
