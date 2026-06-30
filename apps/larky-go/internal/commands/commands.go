package commands

import (
	"fmt"
	"sort"
	"strings"
)

type CommandType string

const (
	TypeLocal   CommandType = "local"
	TypeLocalUI CommandType = "local-ui"
	TypePrompt  CommandType = "prompt"
	// TypeSkillFork is for skills declared with `mode: fork`. The handler
	// runs the skill in an isolated sub-agent (no main-loop touch) and
	// returns the final assistant text; the TUI dispatcher inserts that
	// text into the main chat as an assistant message instead of pumping
	// it through the regular Agent Loop.
	TypeSkillFork CommandType = "skill-fork"
)

type Context struct {
	Args              string
	MemoryList        func() []string
	MemoryClear       func()
	TokenCount        func() (input, output int)
	PermissionMode    func() string
	SetPermissionMode func(mode string) error
	ToolCount         func() int
	SessionInfo       func() string
	SkillList         func() []SkillInfo
	MCPInfo           func() string
	WorkDir           string
	Model             string
}

type SkillInfo struct {
	Name        string
	Description string
}

type Handler func(ctx *Context) string

type Command struct {
	Name        string
	Description string
	Aliases     []string
	Type        CommandType
	ArgPrompt   string
	Hidden      bool
	Handler     Handler
}

type Registry struct {
	commands map[string]*Command
	aliases  map[string]string
}

func NewRegistry() *Registry {
	return &Registry{
		commands: make(map[string]*Command),
		aliases:  make(map[string]string),
	}
}

func (r *Registry) Register(cmd *Command) {
	if _, exists := r.commands[cmd.Name]; exists {
		panic(fmt.Sprintf("commands: duplicate command name %q", cmd.Name))
	}
	if owner, exists := r.aliases[cmd.Name]; exists {
		panic(fmt.Sprintf("commands: command name %q collides with alias of %q", cmd.Name, owner))
	}
	for _, alias := range cmd.Aliases {
		if _, exists := r.commands[alias]; exists {
			panic(fmt.Sprintf("commands: alias %q for %q collides with existing command name", alias, cmd.Name))
		}
		if owner, exists := r.aliases[alias]; exists {
			panic(fmt.Sprintf("commands: alias %q for %q already registered by %q", alias, cmd.Name, owner))
		}
	}
	r.commands[cmd.Name] = cmd
	for _, alias := range cmd.Aliases {
		r.aliases[alias] = cmd.Name
	}
}

// HasConflict reports whether cmd's name or any of its aliases would collide
// with something already in the registry. Dynamic loaders (e.g. user
// commands from disk) should call this before Register to filter out
// conflicting entries, since Register panics on collision.
func (r *Registry) HasConflict(cmd *Command) bool {
	if r.Find(cmd.Name) != nil {
		return true
	}
	for _, alias := range cmd.Aliases {
		if r.Find(alias) != nil {
			return true
		}
	}
	return false
}

func (r *Registry) Find(name string) *Command {
	if cmd, ok := r.commands[name]; ok {
		return cmd
	}
	if canonical, ok := r.aliases[name]; ok {
		return r.commands[canonical]
	}
	return nil
}

func (r *Registry) ListCommands() []*Command {
	var cmds []*Command
	for _, cmd := range r.commands {
		if !cmd.Hidden {
			cmds = append(cmds, cmd)
		}
	}
	sort.Slice(cmds, func(i, j int) bool {
		return cmds[i].Name < cmds[j].Name
	})
	return cmds
}

func (r *Registry) Complete(prefix string) []string {
	var matches []string
	for name, cmd := range r.commands {
		if !cmd.Hidden && strings.HasPrefix(name, prefix) {
			matches = append(matches, name)
		}
	}
	for alias, canonical := range r.aliases {
		if cmd := r.commands[canonical]; cmd != nil && !cmd.Hidden && strings.HasPrefix(alias, prefix) {
			matches = append(matches, alias)
		}
	}
	sort.Strings(matches)
	return matches
}

func Parse(input string) (name string, args string) {
	input = strings.TrimSpace(input)
	if !strings.HasPrefix(input, "/") {
		return "", ""
	}
	input = input[1:]
	parts := strings.SplitN(input, " ", 2)
	name = strings.ToLower(parts[0])
	if len(parts) > 1 {
		args = strings.TrimSpace(parts[1])
	}
	return
}

func CreateDefaultRegistry() *Registry {
	r := NewRegistry()

	r.Register(&Command{
		Name:        "help",
		Description: "Show available commands",
		Aliases:     []string{"h", "?"},
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			if ctx.Args != "" {
				cmd := r.Find(ctx.Args)
				if cmd == nil {
					return fmt.Sprintf("Unknown command: %s", ctx.Args)
				}
				var sb strings.Builder
				sb.WriteString(fmt.Sprintf("/%s — %s\n", cmd.Name, cmd.Description))
				if len(cmd.Aliases) > 0 {
					sb.WriteString(fmt.Sprintf("  Aliases: %s\n", strings.Join(cmd.Aliases, ", ")))
				}
				if cmd.ArgPrompt != "" {
					sb.WriteString(fmt.Sprintf("  Usage: %s\n", cmd.ArgPrompt))
				}
				return sb.String()
			}
			var sb strings.Builder
			sb.WriteString("Available commands:\n\n")
			for _, cmd := range r.ListCommands() {
				aliases := ""
				if len(cmd.Aliases) > 0 {
					aliases = ", /" + strings.Join(cmd.Aliases, ", /")
				}
				sb.WriteString(fmt.Sprintf("  /%s%s\n    %s\n", cmd.Name, aliases, cmd.Description))
			}
			sb.WriteString("\nType /help <command> for details.")
			return sb.String()
		},
	})

	r.Register(&Command{
		Name:        "mcp",
		Description: "Show MCP server status",
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			if ctx.MCPInfo == nil {
				return "No MCP servers configured"
			}
			info := ctx.MCPInfo()
			if info == "" {
				return "No MCP servers connected"
			}
			return info
		},
	})

	r.Register(&Command{
		Name:        "clear",
		Description: "Clear conversation and start fresh",
		Type:        TypeLocalUI,
	})

	r.Register(&Command{
		Name:        "compact",
		Description: "Compress conversation context",
		Aliases:     []string{"c"},
		Type:        TypeLocalUI,
	})

	r.Register(&Command{
		Name:        "status",
		Description: "Show current status",
		Aliases:     []string{"s"},
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			var sb strings.Builder
			sb.WriteString("Larky Status\n")
			sb.WriteString("──────────────\n")
			sb.WriteString(fmt.Sprintf("  Mode:      %s\n", ctx.PermissionMode()))
			input, output := ctx.TokenCount()
			sb.WriteString(fmt.Sprintf("  Tokens:    %d in / %d out\n", input, output))
			sb.WriteString(fmt.Sprintf("  Tools:     %d enabled\n", ctx.ToolCount()))
			memories := ctx.MemoryList()
			sb.WriteString(fmt.Sprintf("  Memories:  %d entries\n", len(memories)))
			sb.WriteString(fmt.Sprintf("  Model:     %s\n", ctx.Model))
			sb.WriteString(fmt.Sprintf("  Directory: %s\n", ctx.WorkDir))
			return sb.String()
		},
	})

	r.Register(&Command{
		Name:        "memory",
		Description: "Manage auto-memories",
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			sub, subArgs := parseSubcommand(ctx.Args)

			switch sub {
			case "", "list":
				memories := ctx.MemoryList()
				if len(memories) == 0 {
					return "No memories stored yet."
				}
				var sb strings.Builder
				sb.WriteString(fmt.Sprintf("Memories (%d entries):\n\n", len(memories)))
				for i, mem := range memories {
					preview := mem
					if len(preview) > 80 {
						preview = preview[:80] + "…"
					}
					sb.WriteString(fmt.Sprintf("  %d. %s\n", i+1, preview))
				}
				return sb.String()

			case "clear":
				ctx.MemoryClear()
				return "All auto-memories cleared."

			default:
				_ = subArgs
				return "Usage: /memory [list|clear]"
			}
		},
	})

	r.Register(&Command{
		Name:        "plan",
		Description: "Switch to plan mode (read-only)",
		Aliases:     []string{"p"},
		Type:        TypeLocalUI,
	})

	r.Register(&Command{
		Name:        "session",
		Description: "Session management",
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			sub, _ := parseSubcommand(ctx.Args)
			switch sub {
			case "", "info":
				return ctx.SessionInfo()
			case "list":
				return ctx.SessionInfo()
			default:
				return "Usage: /session [list|info]"
			}
		},
	})

	r.Register(&Command{
		Name:        "permission",
		Description: "Permission management",
		Aliases:     []string{"perm"},
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			sub, rest := parseSubcommand(ctx.Args)
			switch sub {
			case "", "info":
				return fmt.Sprintf("Current permission mode: %s", ctx.PermissionMode())
			case "mode":
				if rest == "" {
					return "Usage: /permission mode <default|acceptEdits|plan|bypassPermissions>"
				}
				if ctx.SetPermissionMode == nil {
					return "Permission mode switching is not supported in this context."
				}
				if err := ctx.SetPermissionMode(rest); err != nil {
					return err.Error()
				}
				return fmt.Sprintf("Permission mode set to: %s", rest)
			default:
				return "Usage: /permission [info|mode <mode>|rules]"
			}
		},
	})

	r.Register(&Command{
		Name:        "resume",
		Description: "Resume a previous session",
		Aliases:     []string{"r"},
		Type:        TypeLocalUI,
	})

	r.Register(&Command{
		Name:        "rewind",
		Description: "Rewind conversation and files to a previous checkpoint",
		Type:        TypeLocalUI,
	})

	r.Register(&Command{
		Name:        "skills",
		Description: "List available skills",
		Type:        TypeLocal,
		Handler: func(ctx *Context) string {
			skills := ctx.SkillList()
			if len(skills) == 0 {
				return "No skills installed.\n\nAdd skills to .larky/skills/<skill-name>/SKILL.md"
			}
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Available skills (%d):\n\n", len(skills)))
			for _, s := range skills {
				desc := s.Description
				if len(desc) > 100 {
					desc = desc[:100] + "…"
				}
				sb.WriteString(fmt.Sprintf("  /%s\n    %s\n\n", s.Name, desc))
			}
			sb.WriteString("Type /<skill-name> to invoke a skill.")
			return sb.String()
		},
	})

	r.Register(&Command{
		Name:        "review",
		Description: "Review current code changes",
		Type:        TypePrompt,
		Handler: func(ctx *Context) string {
			prompt := "Please review the current git diff for code changes. Focus on:\n" +
				"1. Logic errors\n2. Security issues\n3. Performance problems\n4. Code style"
			if ctx.Args != "" {
				prompt += "\n\nAdditional focus: " + ctx.Args
			}
			return prompt
		},
	})

	return r
}

func parseSubcommand(args string) (sub string, rest string) {
	args = strings.TrimSpace(args)
	if args == "" {
		return "", ""
	}
	parts := strings.SplitN(args, " ", 2)
	sub = strings.ToLower(parts[0])
	if len(parts) > 1 {
		rest = strings.TrimSpace(parts[1])
	}
	return
}
