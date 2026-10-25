## LexiFlow 0.2.4

修正词头里的拼写变体标记，并继续完善《刘晓燕英语四级核心词汇》。

### 修复：带变体标记的词拼不出来

原书里有些词写成 `hono(u)r`、`program(me)`、`realise/-ize` 这种形式，
把可选拼写直接写在词里。

拿这些词做拼写练习时，输入 `honour` 会被判错——因为答案里带着括号。

现在词头只保留一种拼法，另一种放进释义：

```
honour    n. 荣誉；荣幸 v. 尊敬（亦作 honor）
programme n. 计划；程序；节目；项目（亦作 program）
realise   v. 实现；理解，意识到（亦作 realize）
```

拼写时**两种写法都算对**。

涉及的词有 30 个，包括 honour / favour / labour / humour / fibre /
programme / catalogue / dialogue / realise / organise / analyse 等。

### 顺带调整

拼写判定现在会忽略标点符号，所以 `up-to-date` 输入成 `up to date` 也算对。

### 词书顺序

维持上一版修正过来的原书顺序：Unit 1 从 `space / universe / unite` 开始。

### 怎么升级

软件会提示更新，点「下载并安装」即可。
学习记录、生词本、自己导入的词书都会保留。

> **关于版权**：这份词表整理自刘晓燕《英语四级核心词》，
> 版权归原作者与出版方所有，想系统学习建议购买原书。
