@echo off
cd /d "%~dp0"
if not exist "node_modules\css-tree\package.json" (
  echo Please run npm ci --omit=dev once, then start again.
  pause
  exit /b 1
)
node scripts/start-native-lab.js
pause
