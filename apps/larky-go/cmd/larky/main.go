package main

import (
	"fmt"
	"os"
)

const version = "0.1.0"

func main() {
	fmt.Println("larky-go v" + version)
	fmt.Println("AI coding assistant (Go port)")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  larky ping              Ping the daemon")
	fmt.Println("  larky run --goal \"...\"  Run an agent task")
	fmt.Println("  larky chat              Interactive chat session")
	fmt.Println("  larky version           Show version")
	fmt.Println()
	fmt.Println("Status: early development")
	os.Exit(0)
}
