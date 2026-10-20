# cc-autotitle

名前のない Claude Code のセッションに、ターンが終わったときに AI で名前を付ける mod です。

```
❯ /rename Pythonフィボナッチ関数の1行生成
  ⎿ Session renamed to: Pythonフィボナッチ関数の1行生成
```

- 最初のやり取りが終わった時点で、名前がなければ Haiku が付けた名前で `/rename` します。
- 5 往復目に、まだ自動で付けた名前のままなら、育った内容で一度だけ付け直します。
- 手で付けた名前には触りません。空のセッション、サブエージェント、中断したターンも対象外です。
- セッションの中から起動された `claude` (スクリプトから呼ぶ `claude -p` など) では動きません。親のセッション ID を引き継ぐため、名前を付けると親セッションの名前を書き換えてしまうからです。

名前は Claude Code 自身の `/rename` で付けるので、実行中のセッションが持っている名前も同時に変わります。

## 必要なもの

今の名前を調べるのに [cc-sessions](https://github.com/poporpepopo/cc-sessions) の `ccs` を使います。`~/.local/bin/ccs` に置いてください。

## 入れる

```sh
git clone https://github.com/poporpepopo/cc-autotitle ~/Developer/cc-autotitle
```

`~/.claude/settings.json` に次を追加します。複数のフォルダは `:` で区切ります。

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Developer/cc-sessions:~/Developer/cc-autotitle" }
```

止めるときは、環境変数 `CC_AUTOTITLE=0` を設定します。

## 確認する

```
claude plugin validate .
claude plugin test .
```
