@echo off
rem ZeroNote -> Gitee 镜像推送（CRLF，勿转 LF；.cmd 不能带 BOM，否则 cmd.exe 把 BOM 当命令）
rem
rem 前置（只需做一次）：
rem   1. 登录 https://gitee.com ，右上「+」→ 新建仓库 → 名称填 zeronote
rem      仓库路径要与 git remote `gitee` 一致：https://gitee.com/aqua7773/zeronote
rem      **不要**勾「初始化仓库 / 添加 README / .gitignore」—— 空仓库才能直接推
rem   2. 双击本脚本。第一次会弹 Git 凭据窗口，用 Gitee 账号登录即可
rem      （Gitee 密码登录可能被拒，改用「私人令牌」当密码：设置 → 私人令牌，勾 projects）
rem
rem 之后每次同步：双击本脚本，或手动 git push gitee main && git push gitee --tags
setlocal
cd /d "%~dp0.."
set "GIT_TERMINAL_PROMPT=1"

echo [1/2] 推送 main ...
git push gitee main
if errorlevel 1 (
  echo.
  echo [失败] main 没推上去。常见原因：
  echo   · Gitee 上还没建仓库 ^(名称/路径要和 remote 一致^)
  echo   · 凭据被拒：密码登录不行时用「私人令牌」当密码
  echo   · 仓库不是空仓库：先删掉 Gitee 上自动生成的 README
  pause
  exit /b 1
)

echo [2/2] 推送 tags ...
git push gitee --tags
if errorlevel 1 (
  echo [失败] tags 没推上去（main 已经成功，重跑本脚本会补）
  pause
  exit /b 1
)

echo.
echo [完成] Gitee 仓库已同步：https://gitee.com/aqua7773/zeronote
pause
