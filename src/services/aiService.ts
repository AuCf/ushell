import { AIConfig } from '../types';

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat'
};

export function getStoredAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem('ushell_ai_config');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return DEFAULT_AI_CONFIG;
}

export function saveStoredAIConfig(config: AIConfig) {
  localStorage.setItem('ushell_ai_config', JSON.stringify(config));
}

/**
 * Real AI Query Function
 * Connects to DeepSeek / OpenAI / Ollama OpenAI-compatible chat endpoints
 * with automatic fallback to built-in rules if no API Key is set.
 */
export async function queryAICopilot(
  prompt: string, 
  contextError?: string,
  customConfig?: AIConfig
): Promise<{ answer: string; suggestedCommand?: string }> {
  const config = customConfig || getStoredAIConfig();

  // If user configured an API key or local Ollama URL, send real HTTP request to LLM!
  if (config.apiKey || config.provider === 'ollama' || config.baseUrl.includes('localhost')) {
    try {
      const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const systemPrompt = `你是一个专业的 Linux 系统运维与 Shell 命令行 AI 助手。
当用户询问问题或提供终端报错时：
1. 用简明专业的中文解释原因或解法。
2. 如果存在可直接执行的 Shell 命令，请将该命令用标准的 markdown 代码块标记，例如：
\`\`\`bash
sudo systemctl restart nginx
\`\`\`
请保持回答精炼，直奔主题。`;

      const userContent = contextError 
        ? `终端报告如下报错：\n${contextError}\n\n请帮我分析该错误的原因，并给出最佳的解决 Shell 命令。`
        : prompt;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        throw new Error(`API HTTP Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '未获取到 AI 回复';

      // Extract markdown code blocks for suggested commands
      const codeBlockMatch = content.match(/```(?:bash|sh|zsh)?\n([\s\S]*?)\n```/i);
      const suggestedCommand = codeBlockMatch ? codeBlockMatch[1].trim() : undefined;

      return {
        answer: content.replace(/```(?:bash|sh|zsh)?\n[\s\S]*?\n```/gi, '').trim() || content,
        suggestedCommand
      };
    } catch (e: any) {
      console.warn('Real AI API call failed, falling back to smart rules:', e);
      return {
        answer: `[API 连接失败]: ${e.message || e}。请在配置中检查 API Key 与 Base URL，以下为本地推导建议：`,
        suggestedCommand: getLocalFallbackCommand(prompt, contextError)
      };
    }
  }

  // Fallback Rule Engine when no API Key configured
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    answer: getLocalRuleAnswer(prompt, contextError),
    suggestedCommand: getLocalFallbackCommand(prompt, contextError)
  };
}

function getLocalRuleAnswer(prompt: string, contextError?: string): string {
  if (contextError) {
    if (contextError.includes('Permission denied')) {
      return '检测到权限不足（Permission denied）。建议使用 `sudo` 提升权限执行或变更文件属主。';
    }
    if (contextError.includes('command not found')) {
      return '系统未查找到对应命令。可能缺少相关依赖软件包或环境变量配置。';
    }
    if (contextError.includes('Address already in use')) {
      return '服务端口已被占用。可通过 `lsof` 排查占用进程并释放端口。';
    }
  }
  return `（提示：当前未配置 AI API Key，使用内置规则解析中。前往右上方 ⚙️ 可配置 DeepSeek / OpenAI / Ollama 密钥）\n针对问题："${prompt}"，推荐命令如下：`;
}

function getLocalFallbackCommand(prompt: string, contextError?: string): string {
  const lower = (prompt + ' ' + (contextError || '')).toLowerCase();
  if (lower.includes('permission denied')) return `sudo ${prompt.split('\n')[0] || ''}`;
  if (lower.includes('command not found')) return `sudo apt-get update && sudo apt-get install -y htop`;
  if (lower.includes('address already in use') || lower.includes('端口')) return `sudo lsof -i :8080 -t | xargs -r kill -9`;
  if (lower.includes('内存') || lower.includes('mem')) return `free -h && ps aux --sort=-%mem | head -n 10`;
  if (lower.includes('压缩') || lower.includes('zip') || lower.includes('tar')) return `tar -czvf backup.tar.gz ./logs`;
  return `echo "Executing: ${prompt}"`;
}
