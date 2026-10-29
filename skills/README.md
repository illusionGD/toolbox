# Skills 文件夹

将每个 Skill 放在一个子文件夹中，例如：

```text
skills/
  my-skill/
    SKILL.md
    references/
      guide.md
```

在软件「设置 → Skills」中点击刷新即可发现，然后启用。也可以点击「打开文件夹」查看此目录。
在线安装和本地导入的 Skill 同样保存在这里。手动修改内容后，下一次发送对话时会重新读取；移出 Skill 子文件夹后不再加载。

`SKILL.md` 必须使用 UTF-8，并包含元数据和正文：

```markdown
---
name: my-skill
description: 说明 Skill 的用途和使用场景。
---

# 操作步骤

按照任务需要列出步骤。
```

管理列表中的「删除」会删除本目录下对应的 Skill 文件夹及文件。
