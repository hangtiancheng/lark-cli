package teams

import (
	"context"
	"strings"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/agent"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/tools"
)

// StartInProcessMember registers a teammate on the team and launches its long-running main loop in
// a background goroutine. The returned channel forwards every AgentEvent emitted across all turns;
// it closes when the loop exits (ctx cancellation or shutdown request in the inbox).
//
// The lifecycle of the goroutine is bound to ctx: the caller cancels ctx to stop the teammate. Each
// pass through the loop calls RunInProcessTeammate, which handles waiting, agent execution, and
// idle notification.
func StartInProcessMember(
	ctx context.Context,
	team *Team,
	memberName string,
	client llm.Client,
	registry *tools.Registry,
	protocol string,
	task string,
	addendum string,
) <-chan agent.AgentEvent {
	member := team.AddMember(memberName, client, registry, protocol)
	member.Progress = NewTeammateProgress(memberName, team.Name, randomVerb())

	memberCtx, cancel := context.WithCancel(ctx)
	member.Active = true
	member.Cancel = cancel

	eventCh := make(chan agent.AgentEvent, 32)
	go func() {
		defer close(eventCh)
		defer func() {
			// 队友退出时持久化对话记录，用于调试
			if member.Conv != nil {
				_, _ = SaveTranscript(team.Name, memberName, member.Conv)
			}
			team.mu.Lock()
			member.Active = false
			team.mu.Unlock()
		}()
		_ = RunInProcessTeammate(memberCtx, team, member, task, addendum, eventCh)
	}()
	return eventCh
}

// BuildTeammateAddendum creates the system-reminder text injected at the top of every teammate's
// conversation. It tells the model its identity, who else is on the team, and how to send messages.
func BuildTeammateAddendum(teamName, memberName string, otherMembers []string) string {
	var sb strings.Builder
	sb.WriteString("You are a member of team \"" + teamName + "\". Your name is \"" + memberName + "\".\n\n")
	sb.WriteString("The lead is reachable as \"" + LeadName + "\". Deliver your final result to the lead with SendMessage(to=\"" + LeadName + "\", content=...) — the idle notification alone only signals completion, it does not carry your output.\n")
	if len(otherMembers) > 0 {
		sb.WriteString("Other team members: " + strings.Join(otherMembers, ", ") + "\n")
	}
	sb.WriteString("\nYou can communicate with the lead and teammates using the SendMessage tool.\n")
	sb.WriteString("Messages from the team arrive as system reminders at the start of each turn.\n")
	sb.WriteString("When you finish your current task, send your final result to \"" + LeadName + "\" via SendMessage, then stop calling tools — an idle notification will be sent to the lead automatically.\n")
	return sb.String()
}

// InjectPendingMessages returns any unread mailbox messages formatted as a system-reminder string
// and marks them read. It is called at the top of every teammate turn by RunInProcessTeammate; the
// empty return means no new mail.
func InjectPendingMessages(team *Team, memberName string) string {
	msgs, err := team.MailBox.ReadUnread(memberName)
	if err != nil || len(msgs) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("You have new messages:\n\n")
	for _, msg := range msgs {
		sb.WriteString("From " + msg.From + ": " + msg.Text + "\n\n")
	}

	_ = team.MailBox.MarkAllRead(memberName)
	return sb.String()
}
