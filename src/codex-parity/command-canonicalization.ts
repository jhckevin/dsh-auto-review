import Parser from 'tree-sitter'
import Bash from 'tree-sitter-bash'

const CANONICAL_BASH_SCRIPT_PREFIX = '__codex_shell_script__'
const CANONICAL_POWERSHELL_SCRIPT_PREFIX = '__codex_powershell_script__'
const ALLOWED_KINDS = new Set([
  'program', 'list', 'pipeline', 'command', 'command_name', 'word', 'string',
  'string_content', 'raw_string', 'number', 'concatenation',
])
const ALLOWED_PUNCT = new Set(['&&', '||', ';', '|', '"', "'"])
const parser = new Parser()
parser.setLanguage(Bash)

function shellStem(path: string): string {
  const name = path.split(/[\\/]/u).at(-1) ?? path
  return name.replace(/\.[^.]*$/u, '').toLowerCase()
}

function extractBashCommand(command: readonly string[]): { mode: string; script: string } | undefined {
  if (command.length !== 3 || !['bash', 'zsh', 'sh'].includes(shellStem(command[0] ?? ''))) return undefined
  const mode = command[1]
  return mode === '-lc' || mode === '-c' ? { mode, script: command[2] ?? '' } : undefined
}

function extractPowerShellCommand(command: readonly string[]): string | undefined {
  if (command.length < 3 || !['pwsh', 'powershell'].includes(shellStem(command[0] ?? ''))) return undefined
  const allowed = new Set(['-nologo', '-noprofile', '-command', '-c'])
  for (let index = 1; index + 1 < command.length; index += 1) {
    const flag = command[index]?.toLowerCase() ?? ''
    if (!allowed.has(flag)) return undefined
    if (flag === '-command' || flag === '-c') return command[index + 1]
  }
  return undefined
}

function literalWord(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== 'word' && node.type !== 'number') return undefined
  if (node.namedChildren.length > 0) return undefined
  const word = node.text
  if (word.startsWith('=') || /[{}*?\[\]\\~^#$`]/u.test(word)) return undefined
  return word
}

function doubleQuoted(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== 'string' || node.namedChildren.some(part => part.type !== 'string_content')) return undefined
  const raw = node.text
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined
  const stripped = raw.slice(1, -1)
  return /\\[$`"\\\n]/u.test(stripped) ? undefined : stripped
}

function rawString(node: Parser.SyntaxNode): string | undefined {
  const raw = node.text
  return node.type === 'raw_string' && raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : undefined
}

function literalPart(node: Parser.SyntaxNode): string | undefined {
  if (node.type === 'word' || node.type === 'number') return literalWord(node)
  if (node.type === 'string') return doubleQuoted(node)
  if (node.type === 'raw_string') return rawString(node)
  if (node.type !== 'concatenation') return undefined
  let value = ''
  for (const part of node.namedChildren) {
    const parsed = literalPart(part)
    if (parsed === undefined) return undefined
    value += parsed
  }
  return value.length === 0 ? undefined : value
}

function parsePlainCommand(node: Parser.SyntaxNode): string[] | undefined {
  if (node.type !== 'command') return undefined
  const words: string[] = []
  for (const child of node.namedChildren) {
    if (child.type === 'command_name') {
      const name = child.namedChildren[0]
      if (name?.type !== 'word') return undefined
      const parsed = literalWord(name)
      if (parsed === undefined) return undefined
      words.push(parsed)
    } else {
      const parsed = literalPart(child)
      if (parsed === undefined) return undefined
      words.push(parsed)
    }
  }
  return words
}

/** Direct tree-sitter-bash port of Codex parse_shell_lc_plain_commands. */
export function parseShellLcPlainCommands(command: readonly string[]): string[][] | undefined {
  const extracted = extractBashCommand(command)
  if (extracted === undefined) return undefined
  const tree = parser.parse(extracted.script)
  if (tree.rootNode.hasError) return undefined
  const stack = [tree.rootNode]
  const commandNodes: Parser.SyntaxNode[] = []
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) break
    if (node.isNamed) {
      if (!ALLOWED_KINDS.has(node.type)) return undefined
      if ((node.type === 'word' || node.type === 'number') && literalWord(node) === undefined) return undefined
      if (node.type === 'command') commandNodes.push(node)
    } else {
      if (/[&;|]/u.test(node.type) && !ALLOWED_PUNCT.has(node.type)) return undefined
      if (!ALLOWED_PUNCT.has(node.type) && node.type.trim().length > 0) return undefined
    }
    stack.push(...node.children)
  }
  commandNodes.sort((left, right) => left.startIndex - right.startIndex)
  const commands: string[][] = []
  for (const node of commandNodes) {
    const words = parsePlainCommand(node)
    if (words === undefined) return undefined
    commands.push(words)
  }
  return commands
}

export function canonicalizeCommandForApproval(command: readonly string[]): string[] {
  const commands = parseShellLcPlainCommands(command)
  if (commands?.length === 1) return [...commands[0] ?? []]
  const bash = extractBashCommand(command)
  if (bash !== undefined) return [CANONICAL_BASH_SCRIPT_PREFIX, bash.mode, bash.script]
  const powershell = extractPowerShellCommand(command)
  if (powershell !== undefined) return [CANONICAL_POWERSHELL_SCRIPT_PREFIX, powershell]
  return [...command]
}

const U = 1
const S = 2
const D = 4

function unquotedOk(char: string): boolean {
  return /^[+\-./:@\]_0-9A-Za-z]$/u.test(char)
}

function quoteWord(input: string): string | undefined {
  if (input.length === 0) return "''"
  if (input.includes('\0')) return undefined
  let remaining = input
  let output = ''
  while (remaining.length > 0) {
    const characters = [...remaining]
    let allowed = U | S | D
    let consumed = 0
    if (characters[0] === '^') {
      allowed = S
      consumed = 1
    }
    for (; consumed < characters.length; consumed += 1) {
      const char = characters[consumed] ?? ''
      let current = allowed
      if (!unquotedOk(char) || char.codePointAt(0)! >= 0x80) current &= ~U
      if (char === "'" || char === '^' || char === '\\') current &= ~S
      if (char === '`' || char === '$' || char === '!' || char === '^') current &= ~D
      if (current === 0) break
      allowed = current
    }
    const chunk = characters.slice(0, consumed).join('')
    if (allowed & U) output += chunk
    else if (allowed & S) output += `'${chunk}'`
    else output += `"${chunk.replace(/[\\"$`]/gu, '\\$&')}"`
    remaining = characters.slice(consumed).join('')
  }
  return output
}

/** Codex shlex 1.3 try_join with its exact NUL fallback. */
export function shlexJoin(tokens: readonly string[]): string {
  const quoted = tokens.map(quoteWord)
  return quoted.some(value => value === undefined)
    ? '<command included NUL byte>'
    : (quoted as string[]).join(' ')
}
