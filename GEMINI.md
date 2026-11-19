# Workspace Rules (Web Reverse Inspector)

1. 语言与沟通：始终使用简体中文进行内部推理、Implementation Plan 编写与聊天回复。
2. 架构红线：本项目为纯客户端 Chrome 扩展（Manifest V3），严禁引入任何自建后端服务器、数据库或商业计费接口。
3. 技术栈约束：使用原生 ES Modules (Vanilla JS) + HTML5 + CSS3 构建，无需配置复杂的 Webpack/Vite 打包链路，确保源码文件夹可直接通过 Chrome `Load unpacked` 加载运行与调试。
4. 样式隔离：注入目标网页的所有 UI 组件（高亮吸管框、截图裁剪遮罩、状态提示条）必须挂载在独立的 `Shadow DOM` 内，严禁污染宿主网页样式。
5. 通信容错：所有跨上下文通信（Content Script 与 Service Worker、SidePanel）必须包含异常捕获与超时回退机制。
6. 计划书同步：每次修改项目代码前，必须先读取工作区根目录的 `BRIEF.md`；每次更改完成后，必须同步更新 `BRIEF.md` 中的当前规范、变更记录与已知限制，确保项目计划书与实际代码始终保持一致。
