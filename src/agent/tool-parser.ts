/**
 * Content sanitizer — strips stray tool call artifacts from text responses.
 *
 * With native OpenAI function calling, tool calls come as structured data.
 * This sanitizer is defense-in-depth for the rare case where a model
 * leaks tool call markup into text content.
 */

/**
 * Strip tool call artifacts from text content before sending to UI.
 */
export function sanitizeContent(content: string): string {
  let text = content;

  // Closed <tool_call>...</tool_call> tags
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");

  // Unclosed tags: up to next <tool_call> or end of string
  text = text.replace(/<tool_call>[\s\S]*?(?=<tool_call>|$)/g, "");

  // Fenced ```tool_calls``` blocks
  text = text.replace(/```tool_calls[\s\S]*?```/g, "");

  // Orphan tags and reasoning artifacts
  text = text.replace(/<\/?tool_call>/g, "");
  text = text.replace(/<\/think>/g, "");

  return text.trim();
}
