package tui

import "github.com/charmbracelet/lipgloss"

// Color palette (aligned with Python KamaClaude TUI theme).
var (
	primaryColor = lipgloss.Color("#8B5CF6") // violet
	successColor = lipgloss.Color("#10B981") // green
	errorColor   = lipgloss.Color("#EF4444") // red
	warningColor = lipgloss.Color("#F59E0B") // amber
	dimColor     = lipgloss.Color("#6B7280") // gray
	accentColor  = lipgloss.Color("#3B82F6") // blue
	toolColor    = lipgloss.Color("#EC4899") // pink
)

// Reusable lipgloss styles for the TUI.
var (
	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(primaryColor)

	subtitleStyle = lipgloss.NewStyle().Foreground(dimColor)

	successStyle = lipgloss.NewStyle().Foreground(successColor)

	errorStyle = lipgloss.NewStyle().Foreground(errorColor)

	warningStyle = lipgloss.NewStyle().Foreground(warningColor)

	dimStyle = lipgloss.NewStyle().Foreground(dimColor)

	accentStyle = lipgloss.NewStyle().Foreground(accentColor)

	toolStyle = lipgloss.NewStyle().Foreground(toolColor).Bold(true)

	boldStyle = lipgloss.NewStyle().Bold(true)

	// headerStyle renders the top header line.
	headerStyle = lipgloss.NewStyle()

	// bannerStyle renders the ASCII logo banner.
	bannerStyle = lipgloss.NewStyle().Foreground(primaryColor).Bold(true)

	// stepDividerStyle renders step separators.
	stepDividerStyle = lipgloss.NewStyle().Foreground(dimColor).PaddingLeft(1)

	// runHeaderStyle renders the run started line.
	runHeaderStyle = lipgloss.NewStyle().PaddingLeft(1)

	// runOKStyle renders a successful run completion.
	runOKStyle = lipgloss.NewStyle().Foreground(successColor).Bold(true).PaddingLeft(1)

	// runErrStyle renders a failed run completion.
	runErrStyle = lipgloss.NewStyle().Foreground(errorColor).Bold(true).PaddingLeft(1)

	// usageStyle renders the token usage line.
	usageStyle = lipgloss.NewStyle().PaddingLeft(1)

	// logLineStyle renders generic log lines.
	logLineStyle = lipgloss.NewStyle().PaddingLeft(1)

	// userTurnStyle renders the user's echoed input.
	userTurnStyle = lipgloss.NewStyle().PaddingLeft(1)

	// statusBarStyle renders the bottom status bar.
	statusBarStyle = lipgloss.NewStyle().
			Foreground(dimColor).
			BorderStyle(lipgloss.NormalBorder()).
			BorderTop(true).
			BorderForeground(dimColor)

	// permissionStyle renders the permission request card.
	permissionStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(warningColor).
			Padding(0, 1).
			MarginLeft(1)

	// completionStyle renders the slash-command completion popup.
	completionStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(accentColor).
			Padding(0, 1).
			MarginLeft(1)

	// inputBoxStyle renders the multi-line input box border.
	inputBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(dimColor).
			Padding(0, 0)

	// inputBoxFocusStyle renders the input box border when focused.
	inputBoxFocusStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(primaryColor).
				Padding(0, 0)
)

// banner is the ASCII art logo shown on startup.
const banner = `██╗      █████╗ ███╗   ███╗ █████╗  ██████╗██╗  ██╗ █████╗ ██╗   ██╗██████╗ ███████╗
██║     ██╔══██╗████╗ ████║██╔══██╗██╔════╝██║  ██║██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ███████║██╔████╔██║███████║██║     ███████║███████║██║   ██║██║  ██║█████╗  
██║     ██╔══██║██║╚██╔╝██║██╔══██║██║     ██╔══██║██╔══██║██║   ██║██║  ██║██╔══╝  
███████╗██║  ██║██║ ╚═╝ ██║██║  ██║╚██████╗██║  ██║██║  ██║╚██████╔╝██████╔╝███████╗
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`

// bannerHint is the dim hint line below the banner.
const bannerHint = "  type a message to start  ·  press / for skills  ·  ctrl+c to quit"
