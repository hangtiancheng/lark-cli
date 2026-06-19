 # ~/.bashrc
  # =============================================================================                                    
  # Bash configuration for Git Bash on Windows                                                                       
  # Enhanced with ble.sh for zsh-like autosuggestions and syntax highlighting                                        
  # =============================================================================                                    
                                                                                                                       # -----------------------------------------------------------------------------                                    
  # Guard: only run in interactive shells
  # -----------------------------------------------------------------------------
  [[ $- == *i* ]] || return                                                                                          
                                                                                                                       # =============================================================================                                    
  # ble.sh — Bash Line Editor (must be loaded before any readline configuration)
  # Provides: real-time syntax highlighting, history-based autosuggestions,
  #           and enhanced line editing                                                                              
  # =============================================================================                                    
  source ~/.local/share/blesh/ble.sh --noattach                                                                      
                                                                                                                       # --- Autosuggestions (equivalent to zsh-autosuggestions) ---                                                      

  # Enable history-based and completion-based suggestions
  bleopt complete_auto_history=1
  bleopt complete_auto_complete=1
                                                                                                                       # Delay in milliseconds before displaying suggestion (0 = instant)                                                 
  bleopt complete_auto_delay=100

  # Suppress suggestions when the cursor is at the beginning of the line                                             
  bleopt complete_auto_wordbreaks='/=-+,:;'

  # Suggestion text style (dimmed gray)                                                                              
  ble-face auto_complete=fg=245

  # Key bindings for accepting suggestions                                                                           
  ble-bind -f right    auto-complete-enter      # Right arrow: accept full suggestion
  ble-bind -f C-f      auto-complete-enter      # Ctrl+F:    accept full suggestion
  ble-bind -f C-e      auto-complete-enter-end  # Ctrl+E:    accept suggestion to end of line                        
  ble-bind -f S-right  auto-complete-enter-word # Shift+Right: accept one word                                       
                                                                                                                       # --- Syntax highlighting (equivalent to zsh-syntax-highlighting) ---                                              

  # Commands
  ble-face syntax_command=fg=green,bold       # Valid command (green, bold)
  ble-face syntax_error=fg=red,underline       # Invalid command (red, underlined)
                                                                                                                       # Arguments and paths                                                                                              
  ble-face syntax_filename=underline           # Existing file path (underlined)
  ble-face syntax_glob=fg=magenta              # Glob patterns like *, ? (magenta)
  ble-face syntax_option=fg=cyan               # Flags like --verbose (cyan)                                         
                                                                                                                       # Strings and quoting                                                                                              
  ble-face syntax_quoted=fg=yellow             # Quoted strings (yellow)
  ble-face syntax_quotation=fg=yellow,bold     # Quote characters themselves
                                                                                                                       # Variables                                                                                                        
  ble-face syntax_varname=fg=cyan              # Variable names like $HOME (cyan)
  ble-face syntax_expr=fg=cyan                 # Arithmetic expressions
                                                                                                                       # Other                                                                                                            
  ble-face syntax_comment=fg=242               # Comments (dim gray)
  ble-face syntax_function=fg=blue,bold        # Function declarations
  ble-face syntax_alias=fg=green               # Alias definitions                                                   
                                                                                                                       # --- Additional ble.sh options ---                                                                                

  # Show command execution time after completion
  bleopt exec_elapsed_enabled=1
  bleopt exec_elapsed_format='%s ms'
                                                                                                                       # Show exit status when non-zero                                                                                   
  bleopt prompt_status_line=1

  # Highlight matching brackets                                                                                      
  bleopt highlight_bracket=1

  # --- Activate ble.sh ---                                                                                          
  ble-attach

  # =============================================================================                                    
  # History configuration
  # =============================================================================
  export HISTSIZE=50000
  export HISTFILESIZE=100000
  export HISTTIMEFORMAT='%F %T  '                                                                                    
  export HISTCONTROL=ignoredups:erasedups:ignorespace                                                                
  export HISTIGNORE='ls:ll:la:cd:pwd:clear:history:h'                                                                
                                                                                                                       # Append to history file instead of overwriting                                                                    
  shopt -s histappend

  # Flush history after every command (shared across sessions)                                                       
  PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND; }history -a; history -n"

  # =============================================================================                                    
  # Shell options
  # =============================================================================
  shopt -s extglob           # Extended pattern matching (+(pattern), *(pattern), etc.)                              
  shopt -s globstar          # Recursive globbing with **                                                            
  shopt -s nocaseglob        # Case-insensitive pathname expansion                                                   
  shopt -s cdspell           # Auto-correct minor typos in cd arguments                                              
  shopt -s checkwinsize      # Update LINES/COLUMNS after each command                                               
  shopt -s dirspell 2>/dev/null  # Auto-correct directory name typos during completion                               
                                                                                                                       # =============================================================================                                    
  # Prompt (starship)
  # =============================================================================
  if command -v starship &>/dev/null; then                                                                           
      eval "$(starship init bash)"                                                                                   
  else                                                                                                               
      # Fallback prompt with git branch info
      _git_branch() { git branch 2>/dev/null | sed -n 's/* \(.*\)/ (\1)/p'; }
      PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[33m\]$(_git_branch)\[\033[00m\]\n> '             
  fi                                                                                                                 
                                                                                                                       # =============================================================================                                    
  # Tool integrations
  # =============================================================================
                                                                                                                       # zoxide — smarter cd with frequency-based directory jumping                                                       
  if command -v zoxide &>/dev/null; then
      eval "$(zoxide init bash)"
      alias cd='z'                                                                                                   
  fi                                                                                                                 
                                                                                                                       # fzf — fuzzy finder for history (Ctrl+R) and files (Ctrl+T)                                                       
  if command -v fzf &>/dev/null; then
      eval "$(fzf --bash 2>/dev/null)"
      export FZF_DEFAULT_OPTS='--height 40% --layout=reverse --border --cycle'                                       
      export FZF_CTRL_T_OPTS='--preview "bat --color=always --style=numbers --line-range=:200 {}"'                   
  fi                                                                                                                 

  # =============================================================================
  # Aliases
  # =============================================================================
                                                                                                                       # --- Directory navigation ---                                                                                     
  alias ..='cd ..'
  alias ...='cd ../..'
  alias ....='cd ../../..'                                                                                           
                                                                                                                       # --- File listing ---                                                                                             
  if command -v eza &>/dev/null; then
      alias ls='eza --icons'
      alias ll='eza -lh --icons --git'                                                                               
      alias la='eza -lah --icons'                                                                                    
      alias lt='eza --tree --level=2 --icons'                                                                        
  else                                                                                                               
      alias ls='ls --color=auto'                                                                                     
      alias ll='ls -lh --color=auto'                                                                                 
      alias la='ls -la --color=auto'                                                                                 
  fi                                                                                                                 
                                                                                                                       # --- File viewing ---                                                                                             
  command -v bat &>/dev/null && alias cat='bat --paging=never'

  # --- Safety nets ---                                                                                              
  alias rm='rm -i'
  alias cp='cp -i'
  alias mv='mv -i'                                                                                                   
                                                                                                                       # --- Git ---                                                                                                      
                                                                                        
                                                                                                                       # --- Development ---                                                                                                                                                                                  
                                                                                                                       # --- Utilities ---                                                                                                
  alias h='history'
  alias path='echo $PATH | tr ":" "\n"'
  alias myip='curl -s ifconfig.me'                                                                                   
  alias weather='curl -s wttr.in'                                                                                    
                                                                                                                       # =============================================================================                                      # Environment
  # =============================================================================
  export LANG=en_US.UTF-8
  export EDITOR=vim                                                                                                  
  export VISUAL=vim                                                                                                  
                                                                                                                       # =============================================================================                                    
  # .bash_profile bridge (Git Bash loads .bash_profile, not .bashrc by default)
  # =============================================================================
  # Ensure ~/.bash_profile contains:                                                                                 
  #   [[ -f ~/.bashrc ]] && source ~/.bashrc              
