package compact

// TruncateToolResults truncates oversized tool_result content blocks within messages.
// Messages whose content exceeds limitChars are truncated to keepChars, preserving a truncation marker.
// Non-tool_result blocks are left unchanged.
func TruncateToolResults(messages []map[string]any, limitChars, keepChars int) []map[string]any {
	if limitChars <= 0 {
		return messages
	}

	result := make([]map[string]any, 0, len(messages))
	for _, msg := range messages {
		content := msg["content"]
		arr, ok := content.([]any)
		if !ok {
			result = append(result, msg)
			continue
		}

		newContent := make([]any, 0, len(arr))
		for _, block := range arr {
			m, ok := block.(map[string]any)
			if !ok {
				newContent = append(newContent, block)
				continue
			}

			blockType, _ := m["type"].(string)
			if blockType != "tool_result" {
				newContent = append(newContent, block)
				continue
			}

			// Truncate the text content of the tool_result block
			truncated := truncateBlock(m, limitChars, keepChars)
			newContent = append(newContent, truncated)
		}

		newMsg := make(map[string]any)
		for k, v := range msg {
			newMsg[k] = v
		}
		newMsg["content"] = newContent
		result = append(result, newMsg)
	}
	return result
}

// truncateBlock truncates a single tool_result block if its content exceeds limitChars.
func truncateBlock(block map[string]any, limitChars, keepChars int) map[string]any {
	result := make(map[string]any)
	for k, v := range block {
		result[k] = v
	}

	content := block["content"]
	switch c := content.(type) {
	case string:
		if len(c) > limitChars {
			result["content"] = c[:keepChars] + "\n\n... (content truncated) ..."
		}
	case []any:
		newArr := make([]any, 0, len(c))
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				if text, ok := m["text"].(string); ok && len(text) > limitChars {
					truncated := make(map[string]any)
					for k, v := range m {
						truncated[k] = v
					}
					truncated["text"] = text[:keepChars] + "\n\n... (content truncated) ..."
					newArr = append(newArr, truncated)
				} else {
					newArr = append(newArr, item)
				}
			} else {
				newArr = append(newArr, item)
			}
		}
		result["content"] = newArr
	}

	return result
}
