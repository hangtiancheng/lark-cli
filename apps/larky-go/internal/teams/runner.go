package teams

import (
	"context"
	"fmt"
	"strings"
	"time"

	"larky/internal/agent"
	"larky/internal/conversation"
)

// LeadName is the conventional sender/recipient identifier used by the coordinator side. Teammates
// send idle notifications here and read the lead's task assignments from messages with From ==
// LeadName.
const LeadName = "lead"

// ShutdownPrefix marks a mailbox message as a request to terminate the teammate. The lead writes
// one of these to wind down a member cleanly; the runner sees it during idle polling and returns
// from the loop.
const ShutdownPrefix = "[shutdown]"

// IdlePollInterval is how often an idle teammate scans its inbox for new work.
const IdlePollInterval = 500 * time.Millisecond

// IsShutdownRequest reports whether a mailbox message asks the teammate to exit by matching the
// shutdown prefix.
func IsShutdownRequest(msg FileMailMessage) bool {
	return strings.HasPrefix(strings.TrimSpace(msg.Text), ShutdownPrefix)
}

// CreateIdleNotification builds the message a teammate sends to the lead after finishing a turn.
// The lead routes work by reading these.
func CreateIdleNotification(memberName, reason string) FileMailMessage {
	return FileMailMessage{
		From:      memberName,
		Text:      fmt.Sprintf("[idle] %s (reason: %s)", memberName, reason),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Summary:   "idle",
	}
}

// RunInProcessTeammate drives a teammate's main loop in the current process. It blocks until ctx is
// cancelled or a shutdown request lands in the inbox. Each iteration:
//
// 1. waitForNextPromptOrShutdown — fold any pending mailbox messages into a user prompt (or return
// on shutdown / cancellation). 2. runAgent — call agent.Run on the shared conversation; forward
// events through eventOut. The channel closing signals turn-end. 3. sendIdleNotification — drop an
// idle marker into the lead's inbox so it can dispatch the next task.
//
// This The initial prompt jump-starts the first iteration; subsequent iterations get their prompt
// from the mailbox.
func RunInProcessTeammate(
	ctx context.Context,
	team *Team,
	member *Member,
	initialPrompt string,
	addendum string,
	eventOut chan<- agent.AgentEvent,
) error {
	if addendum != "" {
		member.Conv.AddSystemReminder(addendum)
	}

	nextPrompt := initialPrompt
	idleReason := "available"

	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		// Fold any messages that landed in the inbox before this turn into the conversation as a system
		// reminder so the model sees them as inbound notifications, not user instructions.
		if reminder := InjectPendingMessages(team, member.Name); reminder != "" {
			member.Conv.AddSystemReminder(reminder)
		}

		if nextPrompt != "" {
			member.Conv.AddUserMessage(nextPrompt)
		}
		nextPrompt = ""

		ch := member.AgentRef.Run(ctx, member.Conv)
		for ev := range ch {
			// Update progress tracking
			if member.Progress != nil {
				switch e := ev.(type) {
				case agent.ToolUseEvent:
					member.Progress.RecordToolUse(e.ToolName, e.Args)
				case agent.UsageEvent:
					member.Progress.RecordTokens(int64(e.InputTokens), int64(e.OutputTokens))
				}
			}
			if eventOut != nil {
				select {
				case eventOut <- ev:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			if e, ok := ev.(agent.ErrorEvent); ok && e.Message != "" {
				idleReason = "failed"
			}
		}

		if member.Progress != nil {
			if idleReason == "failed" {
				member.Progress.SetStatus("failed")
			} else {
				member.Progress.SetStatus("idle")
			}
		}

		// Notify the lead that this teammate finished its turn so the lead can decide whether to feed it
		// more work.
		_ = team.MailBox.Send(LeadName, CreateIdleNotification(member.Name, idleReason))
		idleReason = "available"

		// Idle poll. Sleep IdlePollInterval, then drain the inbox. Stop on shutdown messages; otherwise
		// build the next prompt and loop back.
		prompt, shutdown, err := waitForNextPromptOrShutdown(ctx, team, member.Name)
		if err != nil {
			return err
		}
		if shutdown {
			return nil
		}
		nextPrompt = prompt
	}
}

// waitForNextPromptOrShutdown blocks until the inbox has at least one message, then turns the
// unread batch into the next user prompt. If any message is a shutdown request, the function
// returns shutdown=true without building a prompt.
func waitForNextPromptOrShutdown(ctx context.Context, team *Team, memberName string) (string, bool, error) {
	for {
		select {
		case <-ctx.Done():
			return "", false, ctx.Err()
		case <-time.After(IdlePollInterval):
		}

		msgs, err := team.MailBox.ReadUnread(memberName)
		if err != nil {
			return "", false, err
		}
		if len(msgs) == 0 {
			continue
		}

		var hasShutdown bool
		var keep []FileMailMessage
		for _, m := range msgs {
			if IsShutdownRequest(m) {
				hasShutdown = true
				continue
			}
			keep = append(keep, m)
		}
		_ = team.MailBox.MarkAllRead(memberName)

		if hasShutdown {
			return "", true, nil
		}
		return formatInboundAsPrompt(keep), false, nil
	}
}

// DrainLeadMailbox reads every unread notification in every team's lead inbox and returns them as
// system-reminder strings (one per team). The lead's main loop installs this in
// Agent.NotificationFn so teammate idle notifications surface to the model at the top of each turn.
func DrainLeadMailbox(mgr *TeamManager) []string {
	if mgr == nil {
		return nil
	}
	var notes []string
	for _, name := range mgr.ListTeams() {
		team := mgr.GetTeam(name)
		if team == nil {
			continue
		}
		msgs, err := team.MailBox.ReadUnread(LeadName)
		if err != nil || len(msgs) == 0 {
			continue
		}
		var sb strings.Builder
		sb.WriteString("<team-notification team=\"")
		sb.WriteString(name)
		sb.WriteString("\">\n")
		for _, m := range msgs {
			sb.WriteString("from=")
			sb.WriteString(m.From)
			sb.WriteString(": ")
			sb.WriteString(m.Text)
			sb.WriteString("\n")
		}
		sb.WriteString("</team-notification>")
		notes = append(notes, sb.String())
		_ = team.MailBox.MarkAllRead(LeadName)
	}
	return notes
}

// formatInboundAsPrompt turns an unread batch into a single user prompt. Each message is tagged
// with its sender so the teammate can route a reply. Matches formatAsTeammateMessage in ,
// simplified to plain text instead of XML.
func formatInboundAsPrompt(msgs []FileMailMessage) string {
	if len(msgs) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("You have new messages from your team:\n\n")
	for _, m := range msgs {
		sb.WriteString(fmt.Sprintf("From %s: %s\n\n", m.From, m.Text))
	}
	return sb.String()
}

// _ silences the unused-import warning when conversation is referenced only via Member.Conv
// methods.
var _ = conversation.NewManager
