# 截图目录 / Screenshots

README 与使用指南里引用的图片都放在这里。文件名必须与下表一致，图片才能在
GitHub 上正确显示。

Screenshots referenced from the README and the usage guide live here. The
filenames must match the table below, or the images will not render on GitHub.

| 文件名 / Filename           | 用途 / Used for | 建议内容 / Suggested content |
| ------------------------ | ------------- | ------------------------ |
| `hero.png`               | README 顶部主图   | 一张笔记以导图打开的完整截图，深色或浅色主题皆可 |
| `inline-edit.png`        | 就地编辑          | 某张卡片处于编辑态：背景不透明、圆角边框     |
| `annotation.png`         | 注解            | 卡片下方挂着灰色注解文字条            |
| `card-styles.png`        | 卡片样式          | 三种卡片样式对比（边框 / 圆角卡片 / 极简） |
| `drag-ghost.png`         | 拖拽预览          | 拖动中的半透明副本跟随指针，目标卡片高亮     |
| `shortcuts-settings.png` | 快捷键设置页        | 设置窗口的「快捷键」页，含录制/清除/恢复按钮  |
| `settings-window.png`    | 设置窗口          | 设置独立窗口整体外观（可拖动）          |
| `search.png`             | 查找栏           | 画布上的查找栏与高亮的匹配卡片          |
| `export.png`             | 导出            | 导出按钮展开的二级菜单              |
| `edge-styles.png`        | 连线样式          | 曲线与直角两种连线对比              |
| `screenshots.png`        | README 截图拼图（英） | 下面六张单图合成的整版，宽 2400px      |
| `screenshots-zh.png`     | README 截图拼图（中） | 同上，快捷键页换成中文版             |

## 拼图的排法 / The sheet

`screenshots.png` 与 `screenshots-zh.png` 就是把上面六张单图排成一张，README 里只引用这张
拼图（表格里的图太小，看不清）。顺序：

1. `inline-edit.png` —— 通栏
2. `annotation.png` + `drag-ghost.png` —— 左右两栏，等高
3. `search.png` + `shortcuts-settings.png`（中文版用 `shortcuts-settings-zh.png`）—— 左右两栏，等高
4. `card-styles.png` —— 通栏

画布底色 `#121419`，每张图圆角 16px、1px 描边，下方一行灰色说明文字。

The two sheets are the same six screenshots laid out in one image; the README only
references the sheet. Edit a single screenshot and the sheet has to be rebuilt.

## 添加方式 / How to add

1. 把图片按上表命名后放进本目录。
2. 提交并推送到 GitHub。
3. README 里的 `![...](assets/xxx.png)` 会自动生效，无需再改文档。

> 建议用 PNG，宽度 1600px 左右。GitHub 会等比缩放，文件太大加载会慢。
