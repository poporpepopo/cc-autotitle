import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { pickTitle } from '../hooks/register'

type World = { title: string; prompts: number; env?: Record<string, string> }

// セッション・ccs・モデル・/rename を差し替える。renamed に /rename の引数が溜まる
function world(on: On, w: World) {
  const renamed: string[] = []
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', async () => ({ value: 'sid-1' }))
  on('session.cwd', async () => ({ value: '/Users/me/Developer' }))
  on('session.messages', async () => ({
    value: Array.from({ length: w.prompts }, (_, i) => [
      { role: 'user', text: `お願い ${i + 1}`, toolUses: [] },
      { role: 'assistant', text: `回答 ${i + 1}`, toolUses: [] },
    ]).flat(),
  }) as never)
  on('env.get', async (_$, e) => ({ value: { HOME: '/Users/me', ...w.env }[e.name] }) as never)
  on('process.run', async () => ({
    value: {
      exitCode: 0, stdout: JSON.stringify([{ id: 'sid-1', title: w.title }]), stderr: '',
      isStdoutTruncated: false, isStderrTruncated: false,
    },
  }))
  on('model.complete', async () => ({
    value: { isAnswered: true, text: `「自動の名前 ${w.prompts}」\n`, usage: { input_tokens: 1, output_tokens: 1 } },
  }) as never)
  on('command.run', async (_$, e) => {
    renamed.push(e.args)
    w.title = e.args
    return { text: `Session renamed to: ${e.args}` }
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }) as never)
  const turn = async (extra: object = {}) => {
    await $turn({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, ...extra })
    await clock.advance(10)
  }
  let $turn: (e: object) => Promise<unknown> = async () => {}
  return { renamed, turn, bind: (f: typeof $turn) => ($turn = f) }
}

test('名前のないセッションに 1 往復目で名前を付け、5 往復目に一度だけ付け直す', async ($, on) => {
  const w: World = { title: '', prompts: 1 }
  const t = world(on, w)
  t.bind(e => $.turn.complete(e as never))

  await t.turn()
  expect(t.renamed).toEqual(['自動の名前 1'])

  w.prompts = 3
  await t.turn()
  expect(t.renamed.length).toBe(1) // 自分の名前のまま、まだ 5 往復未満

  w.prompts = 5
  await t.turn()
  expect(t.renamed).toEqual(['自動の名前 1', '自動の名前 5'])

  w.prompts = 8
  await t.turn()
  expect(t.renamed.length).toBe(2) // 見直しは一度だけ
})

test('手で付けた名前には触らない', async ($, on) => {
  const w: World = { title: '自分で付けた名前', prompts: 6 }
  const t = world(on, w)
  t.bind(e => $.turn.complete(e as never))
  await t.turn()
  expect(t.renamed).toEqual([])
})

test('CC_AUTOTITLE=0 なら何もしない', async ($, on) => {
  const t = world(on, { title: '', prompts: 2, env: { CC_AUTOTITLE: '0' } })
  t.bind(e => $.turn.complete(e as never))
  await t.turn()
  expect(t.renamed).toEqual([])
})

test('別セッションから起動された子プロセスでは親の名前を変えない', async ($, on) => {
  const t = world(on, { title: '', prompts: 2, env: { CLAUDE_CODE_CHILD_SESSION: '1' } })
  t.bind(e => $.turn.complete(e as never))
  await t.turn()
  expect(t.renamed).toEqual([])
})

test('サブエージェントのターンや中断では何もしない', async ($, on) => {
  const t = world(on, { title: '', prompts: 2 })
  t.bind(e => $.turn.complete(e as never))
  await t.turn({ agentId: 'agent-1' })
  await t.turn({ reason: 'aborted' })
  expect(t.renamed).toEqual([])
})

test('モデルの返答から名前だけを取り出す', () => {
  expect(pickTitle('「Pixel 10 のADB接続」\n補足')).toBe('Pixel 10 のADB接続')
  expect(pickTitle('名前: メニューバーのリソースモニター')).toBe('メニューバーのリソースモニター')
  expect(pickTitle('\n\n')).toBe('')
})
