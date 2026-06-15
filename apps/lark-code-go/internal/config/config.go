package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

const (
	defaultHost      = "127.0.0.1"
	defaultPort      = 7437
	defaultLogLevel  = "INFO"
	defaultLogFile   = "~/.lark/logs/core.log"
	defaultLogFormat = "text"
	defaultMaxSteps  = 20
	defaultModel     = "claude-sonnet-4-6"
	defaultTraceFile = "~/.lark/traces/daemon.jsonl"
)

// LoggingConfig 控制日志输出行为
type LoggingConfig struct {
	Level  string `toml:"level"`
	File   string `toml:"file"`
	Format string `toml:"format"`
}

// AgentConfig 控制 agent 运行参数
type AgentConfig struct {
	MaxSteps int `toml:"max_steps"`
}

// LlmConfig 控制 LLM 调用参数
type LlmConfig struct {
	DefaultModel string `toml:"default_model"`
	Router       string `toml:"router"`
}

// TraceConfig 控制系统级追踪行为
type TraceConfig struct {
	Enabled           bool   `toml:"enabled"`
	File              string `toml:"file"`
	IncludeLLMPayload bool   `toml:"include_llm_payload"`
}

// PermissionConfig 控制权限审批行为
type PermissionConfig struct {
	TimeoutS float64 `toml:"timeout_s"`
}

// CompactionConfig 控制上下文压缩参数
type CompactionConfig struct {
	AutoThreshold   float64 `toml:"auto_threshold"`
	ToolResultLimit int     `toml:"tool_result_limit"`
	ToolResultKeep  int     `toml:"tool_result_keep"`
}

// McpServerConfig 描述单个 MCP 服务器连接
type McpServerConfig struct {
	Name      string            `toml:"name"`
	Transport string            `toml:"transport"`
	Command   string            `toml:"command"`
	Args      []string          `toml:"args"`
	Env       map[string]string `toml:"env"`
	Host      string            `toml:"host"`
	Port      int               `toml:"port"`
}

// McpConfig 控制 MCP 集成
type McpConfig struct {
	Servers []McpServerConfig `toml:"servers"`
}

// Config 是运行时配置的根结构
type Config struct {
	Host       string           `toml:"host"`
	Port       int              `toml:"port"`
	Logging    LoggingConfig    `toml:"logging"`
	Agent      AgentConfig      `toml:"agent"`
	LLM        LlmConfig        `toml:"llm"`
	Trace      TraceConfig      `toml:"trace"`
	Permission PermissionConfig `toml:"permission"`
	Compaction CompactionConfig `toml:"compaction"`
	MCP        McpConfig        `toml:"mcp"`
}

// DefaultConfig 返回带默认值的配置
func DefaultConfig() *Config {
	return &Config{
		Host: defaultHost,
		Port: defaultPort,
		Logging: LoggingConfig{
			Level:  defaultLogLevel,
			File:   defaultLogFile,
			Format: defaultLogFormat,
		},
		Agent: AgentConfig{
			MaxSteps: defaultMaxSteps,
		},
		LLM: LlmConfig{
			DefaultModel: defaultModel,
			Router:       "static",
		},
		Trace: TraceConfig{
			Enabled:           true,
			File:              defaultTraceFile,
			IncludeLLMPayload: true,
		},
		Permission: PermissionConfig{
			TimeoutS: 60.0,
		},
		Compaction: CompactionConfig{
			AutoThreshold:   0.0,
			ToolResultLimit: 8000,
			ToolResultKeep:  4000,
		},
	}
}

// GetConfig 构建并返回运行时配置：默认值 -> 全局 TOML -> 项目本地 TOML -> .env -> 系统环境变量
func GetConfig() (*Config, error) {
	cfg := DefaultConfig()

	// 加载 .env 文件（不覆盖已有环境变量）
	loadDotEnv(".env")

	// 确定 TOML 文件路径
	explicit := os.Getenv("LARK_CONFIG")
	var configPaths []string
	if explicit != "" {
		configPaths = []string{expandUser(explicit)}
	} else {
		configPaths = []string{
			expandUser("~/.lark/config.toml"),
			".lark/config.toml",
		}
	}

	// 按优先级叠加 TOML 文件
	for _, p := range configPaths {
		if _, err := os.Stat(p); err == nil {
			if err := applyTOML(cfg, p); err != nil {
				return nil, fmt.Errorf("config parse error (%s): %w", p, err)
			}
		}
	}

	// 环境变量覆盖（最高优先级）
	if err := applyEnv(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

// tomlData 定义 TOML 文件解析结构
type tomlData struct {
	Core       *tomlCore       `toml:"core"`
	Logging    *tomlLogging    `toml:"logging"`
	Agent      *tomlAgent      `toml:"agent"`
	LLM        *tomlLLM        `toml:"llm"`
	Trace      *tomlTrace      `toml:"trace"`
	Permission *tomlPermission `toml:"permission"`
	Compaction *tomlCompaction `toml:"compaction"`
	MCP        *tomlMCP        `toml:"mcp"`
}

type tomlCore struct {
	Host string `toml:"host"`
	Port int    `toml:"port"`
}

type tomlLogging struct {
	Level  string `toml:"level"`
	File   string `toml:"file"`
	Format string `toml:"format"`
}

type tomlAgent struct {
	MaxSteps int `toml:"max_steps"`
}

type tomlLLM struct {
	DefaultModel string `toml:"default_model"`
	Router       string `toml:"router"`
}

type tomlTrace struct {
	Enabled           *bool  `toml:"enabled"`
	File              string `toml:"file"`
	IncludeLLMPayload *bool  `toml:"include_llm_payload"`
}

type tomlPermission struct {
	TimeoutS *float64 `toml:"timeout_s"`
}

type tomlCompaction struct {
	AutoThreshold   *float64 `toml:"auto_threshold"`
	ToolResultLimit *int     `toml:"tool_result_limit"`
	ToolResultKeep  *int     `toml:"tool_result_keep"`
}

type tomlMCP struct {
	Servers []tomlMcpServer `toml:"servers"`
}

type tomlMcpServer struct {
	Name      string            `toml:"name"`
	Transport string            `toml:"transport"`
	Command   string            `toml:"command"`
	Args      []string          `toml:"args"`
	Env       map[string]string `toml:"env"`
	Host      string            `toml:"host"`
	Port      int               `toml:"port"`
}

// applyTOML 解析并应用 TOML 文件到配置
func applyTOML(cfg *Config, path string) error {
	var data tomlData
	if _, err := toml.DecodeFile(path, &data); err != nil {
		return err
	}

	if data.Core != nil {
		if data.Core.Host != "" {
			cfg.Host = data.Core.Host
		}
		if data.Core.Port != 0 {
			cfg.Port = data.Core.Port
		}
	}

	if data.Logging != nil {
		if data.Logging.Level != "" {
			cfg.Logging.Level = data.Logging.Level
		}
		if data.Logging.File != "" {
			cfg.Logging.File = data.Logging.File
		}
		if data.Logging.Format != "" {
			cfg.Logging.Format = data.Logging.Format
		}
	}

	if data.Agent != nil {
		if data.Agent.MaxSteps > 0 {
			cfg.Agent.MaxSteps = data.Agent.MaxSteps
		}
	}

	if data.LLM != nil {
		if data.LLM.DefaultModel != "" {
			cfg.LLM.DefaultModel = data.LLM.DefaultModel
		}
		if data.LLM.Router != "" {
			cfg.LLM.Router = data.LLM.Router
		}
	}

	if data.Trace != nil {
		if data.Trace.Enabled != nil {
			cfg.Trace.Enabled = *data.Trace.Enabled
		}
		if data.Trace.File != "" {
			cfg.Trace.File = data.Trace.File
		}
		if data.Trace.IncludeLLMPayload != nil {
			cfg.Trace.IncludeLLMPayload = *data.Trace.IncludeLLMPayload
		}
	}

	if data.Permission != nil {
		if data.Permission.TimeoutS != nil {
			v := *data.Permission.TimeoutS
			if v < 0 {
				return fmt.Errorf("permission.timeout_s must be >= 0")
			}
			cfg.Permission.TimeoutS = v
		}
	}

	if data.Compaction != nil {
		if data.Compaction.AutoThreshold != nil {
			v := *data.Compaction.AutoThreshold
			if v < 0 || v > 1 {
				return fmt.Errorf("compaction.auto_threshold must be between 0 and 1")
			}
			cfg.Compaction.AutoThreshold = v
		}
		if data.Compaction.ToolResultLimit != nil {
			v := *data.Compaction.ToolResultLimit
			if v <= 0 {
				return fmt.Errorf("compaction.tool_result_limit must be > 0")
			}
			cfg.Compaction.ToolResultLimit = v
		}
		if data.Compaction.ToolResultKeep != nil {
			v := *data.Compaction.ToolResultKeep
			if v <= 0 {
				return fmt.Errorf("compaction.tool_result_keep must be > 0")
			}
			cfg.Compaction.ToolResultKeep = v
		}
	}

	if data.MCP != nil {
		for i, srv := range data.MCP.Servers {
			if srv.Name == "" {
				return fmt.Errorf("mcp.servers[%d].name must be non-empty", i)
			}
			transport := srv.Transport
			if transport == "" {
				transport = "stdio"
			}
			if transport != "stdio" && transport != "tcp" {
				return fmt.Errorf("mcp.servers[%d].transport must be 'stdio' or 'tcp'", i)
			}
			s := McpServerConfig{
				Name:      srv.Name,
				Transport: transport,
				Command:   srv.Command,
				Args:      srv.Args,
				Env:       srv.Env,
				Host:      srv.Host,
				Port:      srv.Port,
			}
			if s.Host == "" {
				s.Host = "localhost"
			}
			if s.Port == 0 {
				s.Port = 3000
			}
			if s.Env == nil {
				s.Env = make(map[string]string)
			}
			if s.Args == nil {
				s.Args = []string{}
			}
			cfg.MCP.Servers = append(cfg.MCP.Servers, s)
		}
	}

	return nil
}

// applyEnv 用 LARK_* 环境变量覆盖配置
func applyEnv(cfg *Config) error {
	if v := os.Getenv("LARK_HOST"); v != "" {
		cfg.Host = v
	}

	if v := os.Getenv("LARK_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("LARK_PORT must be an integer, got: %q", v)
		}
		cfg.Port = port
	}

	if v := os.Getenv("LARK_LOG_LEVEL"); v != "" {
		cfg.Logging.Level = v
	}
	if v := os.Getenv("LARK_LOG_FILE"); v != "" {
		cfg.Logging.File = v
	}
	if v := os.Getenv("LARK_LOG_FORMAT"); v != "" {
		cfg.Logging.Format = v
	}

	if v := os.Getenv("LARK_MAX_STEPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return fmt.Errorf("LARK_MAX_STEPS must be a positive integer, got: %q", v)
		}
		cfg.Agent.MaxSteps = n
	}

	if v := os.Getenv("LARK_LLM_DEFAULT_MODEL"); v != "" {
		cfg.LLM.DefaultModel = v
	}

	if v := os.Getenv("LARK_TRACE_ENABLED"); v != "" {
		cfg.Trace.Enabled = !isFalsy(v)
	}
	if v := os.Getenv("LARK_TRACE_FILE"); v != "" {
		cfg.Trace.File = v
	}
	if v := os.Getenv("LARK_TRACE_INCLUDE_LLM_PAYLOAD"); v != "" {
		cfg.Trace.IncludeLLMPayload = !isFalsy(v)
	}

	if v := os.Getenv("LARK_PERMISSION_TIMEOUT_S"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f < 0 {
			return fmt.Errorf("LARK_PERMISSION_TIMEOUT_S must be >= 0, got: %q", v)
		}
		cfg.Permission.TimeoutS = f
	}

	if v := os.Getenv("LARK_COMPACT_THRESHOLD"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f < 0 || f > 1 {
			return fmt.Errorf("LARK_COMPACT_THRESHOLD must be between 0 and 1, got: %q", v)
		}
		cfg.Compaction.AutoThreshold = f
	}

	if v := os.Getenv("LARK_COMPACT_TOOL_LIMIT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return fmt.Errorf("LARK_COMPACT_TOOL_LIMIT must be a positive integer, got: %q", v)
		}
		cfg.Compaction.ToolResultLimit = n
	}

	if v := os.Getenv("LARK_COMPACT_TOOL_KEEP"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return fmt.Errorf("LARK_COMPACT_TOOL_KEEP must be a positive integer, got: %q", v)
		}
		cfg.Compaction.ToolResultKeep = n
	}

	return nil
}

// isFalsy 判断字符串是否为假值
func isFalsy(s string) bool {
	lower := strings.ToLower(s)
	return lower == "0" || lower == "false" || lower == "no"
}

// expandUser 将 ~ 展开为用户主目录
func expandUser(path string) string {
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return filepath.Join(home, path[2:])
}

// loadDotEnv 加载 .env 文件中的环境变量（不覆盖已有值）
func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		// 去除引号
		value = strings.Trim(value, `"'`)
		// 不覆盖已有环境变量
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}
