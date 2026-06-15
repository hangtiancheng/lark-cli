package main

import (
	"fmt"
	"os"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/app"
)

func main() {
	coreApp := app.NewCoreApp()
	if err := coreApp.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "larkd: %s\n", err)
		os.Exit(1)
	}
}
