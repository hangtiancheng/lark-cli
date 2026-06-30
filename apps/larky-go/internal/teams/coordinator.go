package teams

// CoordinatorMode restricts the Lead agent's tools to coordination-only.
// When active, Lead can only use: Agent, TaskStop, SendMessage, and
// task management tools (TaskCreate, TaskGet, TaskList, TaskUpdate).
//
// The four-phase workflow:
// 1. Research: Lead explores the problem space
// 2. Synthesis: Lead creates a plan and task decomposition
// 3. Implementation: Lead spawns teammates to execute tasks
// 4. Verification: Lead verifies results and resolves conflicts

var CoordinatorAllowedTools = map[string]bool{
	"Agent":       true,
	"SendMessage": true,
	"TaskCreate":  true,
	"TaskGet":     true,
	"TaskList":    true,
	"TaskUpdate":  true,

	"TeamCreate": true,
	"TeamDelete": true,
	"ReadFile":   true,
	"Glob":       true,
	"Grep":       true,
	"Bash":       true,
}

// IsCoordinatorTool checks if a tool is allowed in Coordinator Mode.
func IsCoordinatorTool(name string) bool {
	return CoordinatorAllowedTools[name]
}
