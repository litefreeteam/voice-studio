# 参与 Voice Studio

欢迎提交问题、文档改进与代码贡献。开始前请先搜索 [已有 Issues](https://github.com/litefreeteam/voice-studio/issues)，较大的功能变更建议先说明使用场景与方案。

## 本地开发

```sh
git clone https://github.com/litefreeteam/voice-studio.git
cd voice-studio
npm ci
npm run resources
npm start
```

使用 Node.js 22.12+；`.nvmrc` 记录开发所用版本。首次安装运行组件与模型需要联网，具体平台要求见 [README](README.md)。

## 提交问题

请附上软件版本、操作系统、芯片架构、内存、使用的声音资源包，以及能够重现问题的最短步骤。如果涉及音频效果，可提供有权公开的短文稿与样例。

提交日志、截图或录音前，请移除私人文稿、设备信息、密钥及客户数据。不要把模型文件、安装包或本机作品目录提交到仓库。

## 提交修改

1. 从自己的分支进行修改，让每个 Pull Request 聚焦一个问题。
2. 说明触发条件、修改后的行为，以及实际执行的验证。
3. 根据修改范围运行已有检查；文档与静态视觉素材修改以链接检查和渲染核对为主。

```sh
npm test
npm run test:security
```

更具体的界面与功能检查见 `package.json` 的 `scripts`。涉及真实模型的脚本可能需要额外下载资源或长时间推理，请先阅读对应脚本，不要默认把它们作为普通文档修改的前置步骤。

## 维护约定

- 当前是免费版。新增内容应与 `shared/edition.json` 和实际功能保持一致。
- 保留用户数据与原始音频；开发和测试使用独立目录，可通过 `VOICE_STUDIO_DATA` 指定。
- 下载资源使用固定版本、大小和 SHA-256；保留第三方许可及来源信息。
- 修改内置声音目录、试听和画像时，使用现有同步流程更新官网，不修改用户已有角色样本。
- 不提交 `.seller/`、`.env`、私钥、支付记录、参考录音等本机或敏感材料。

贡献的源码遵循项目的 [MIT License](LICENSE)。第三方素材和依赖仍遵循其各自许可。
