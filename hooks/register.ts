import type { EngineInterface, Register } from 'claude-code'

// 名前のないセッションに、ターンが終わるたび AI で名前を付ける。
// 名前は Claude Code 自身の /rename で付ける (実行中セッションのメモリ上の名前も変わり、
// 古い名前で書き戻されない)。手で付けた名前には触らない。
//   1 往復目: 名前がなければ付ける
//   5 往復目: 自分が付けた名前のままなら、育った内容で一度だけ付け直す
// 無効化: 環境変数 CC_AUTOTITLE=0

const FIRST_AT = 1
const REFINE_AT = 5

type Mark = { title: string; refined: boolean }

const busy = new Set<string>()

const realPrompts = (msgs: { role: string; text: string }[]) =>
  msgs.filter(m => m.role === 'user' && m.text.trim() && !m.text.trimStart().startsWith('<')).map(m => m.text)

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

let ccsPath = ''
async function currentTitle($: EngineInterface, id: string): Promise<string> {
  if (!ccsPath) {
    const home = await $.env.get('HOME')
    ccsPath = home ? `${home}/.local/bin/ccs` : 'ccs' // HOME が取れなければ PATH から探す
  }
  const out = await $.process.run([ccsPath, '--json', '-a', id], { timeoutMs: 30000 })
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || `ccs exited ${out.exitCode}`)
  const rows: { id: string; title: string }[] = JSON.parse(out.stdout)
  return rows.find(r => r.id === id)?.title ?? ''
}

export function pickTitle(text: string): string {
  const line = text.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  return line.replace(/^["'「『]+|["'」』]+$/g, '').replace(/^(名前|タイトル)[:：]\s*/, '').slice(0, 40).trim()
}

async function maybeName($: EngineInterface) {
  if ((await $.env.get('CC_AUTOTITLE')) === '0') return
  // セッションの中から起動された claude (Bash から呼んだ claude -p など) は親のセッション ID を
  // 引き継ぐので、ここで /rename すると親セッションの名前を書き換えてしまう
  if ((await $.env.get('CLAUDE_CODE_CHILD_SESSION')) === '1') return
  const id = await $.session.id()
  if (busy.has(id)) return
  busy.add(id)
  try {
    const msgs = await $.session.messages()
    if (!Array.isArray(msgs)) return
    const prompts = realPrompts(msgs)
    const n = prompts.length
    if (n < FIRST_AT) return

    const key = `auto:${id}`
    const mark = (await $.store.get(key)) as Mark | undefined
    const now = await currentTitle($, id)

    let refine = false
    if (now) {
      // 自分が付けた名前のままで、見直しがまだなら 5 往復目に一度だけ付け直す
      if (!mark || mark.title !== now || mark.refined || n < REFINE_AT) return
      refine = true
    }

    const lastAnswer = [...msgs].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? ''
    const context = {
      cwd: await $.session.cwd(),
      first_prompts: prompts.slice(0, 3).map(p => clip(p, 300)),
      recent_prompts: n > 3 ? prompts.slice(-2).map(p => clip(p, 200)) : [],
      last_answer: clip(lastAnswer, 300),
    }
    const res = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 100,
      timeoutMs: 30000,
      system:
        'Claude Code のセッションに名前を付けます。後で一覧を見て何の作業か一目で分かる日本語の名前を ' +
        '15〜25 文字程度で 1 つだけ返してください。名詞止め、具体的な対象 (アプリ名・ツール名など) を含める。' +
        '名前だけを 1 行で出力し、説明や引用符は付けない。',
      prompt: JSON.stringify(context),
    })
    if (!res.isAnswered) return
    const title = pickTitle(res.text)
    if (!title || title === now) return

    await $.command.run({ command: 'rename', args: title })
    await $.store.set(key, { title, refined: refine } satisfies Mark)
  } finally {
    busy.delete(id)
  }
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // メインの会話の、応答で終わったターンだけ。サブエージェントや中断は対象外
    if (e.agentId === undefined && e.reason === 'answer') {
      // /rename はターンの外 (セッションが空いたとき) に流す
      $.clock.after(0, () => void maybeName($).catch(() => {}))
    }
    return done
  })
}
