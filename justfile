UI_DIR := "extensions/resource-metrics/resource-metrics-extention/ui"

# List available recipes
default:
    @just --list

# Configure git identity for KiralCreation
git-init:
    git config user.name "KiralCreation"
    git config user.email "dev@kiralcreation.com"

# Show current git config and remote
git-status:
    @echo "Git user: $(git config user.name) <$(git config user.email)>"
    @echo "Remote:   $(git remote get-url origin 2>/dev/null || echo 'none')"
    @echo "Branch:   $(git branch --show-current)"

# Build Go binary (with ldflags via make)
build:
    make build

# Build Docker image
image:
    make image

# Run Go tests
test:
    go test -v ./...

# Run Go tests with coverage (via make)
test-coverage:
    make test-coverage

# Run the server locally
run:
    go run ./cmd

# Install UI dependencies
ui-install:
    yarn --cwd {{UI_DIR}} install

# Build the UI
ui-build:
    make build-ui

# Lint Go code
lint:
    golangci-lint run ./...

# Tidy Go dependencies
tidy:
    go mod tidy

# Clean Go build artifacts
clean:
    make clean

# Clean UI build artifacts
clean-ui:
    make clean-ui

# Clean everything
clean-all: clean clean-ui

# Check if .pen files are saved to disk (size > 1KB means saved)
pen-check:
    #!/usr/bin/env bash
    found=0
    for f in $(find . -name "*.pen"); do
        found=1
        size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
        if [ "$size" -lt 1000 ]; then
            echo "NO GUARDADO: $f (${size} bytes) — presiona Ctrl+S en Pencil"
        else
            echo "OK: $f (${size} bytes)"
        fi
    done
    if [ "$found" -eq 0 ]; then
        echo "No se encontraron archivos .pen"
    fi
