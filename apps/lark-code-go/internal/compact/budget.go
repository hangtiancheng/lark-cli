package compact

// TruncateToolResults 截断过大的 tool_result 内容
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

			// 截断 tool_result 的 text 内容
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

// truncateBlock 截断单个 tool_result 块
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
