# Larky

An AI programming assistant running in the terminal, written in Go.

## Build

```
go build -o larky ./cmd/larky
```

## Development

Install [air](https://github.com/air-verse/air) for live-reload during development:

```
go install github.com/air-verse/air@latest
```

Then run `air` from the project root. It watches `.go`, `.tpl`, `.tmpl`, and `.html` files and automatically rebuilds on changes.

## Test

```
go test ./...
```
