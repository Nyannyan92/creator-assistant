#!/bin/bash

# 创作者AI助手 - 桌面应用启动脚本

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "🚀 正在启动创作者AI助手..."
echo "📁 工作目录: $SCRIPT_DIR"

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败，请检查网络连接"
        read -p "按回车键退出..."
        exit 1
    fi
fi

# 检查是否已构建
if [ ! -d "dist" ]; then
    echo "🔨 正在构建应用..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ 构建失败"
        read -p "按回车键退出..."
        exit 1
    fi
fi

# 检查是否安装了 Electron
if [ ! -d "node_modules/electron" ]; then
    echo "📥 正在安装 Electron..."
    npm install electron --save-dev
    if [ $? -ne 0 ]; then
        echo "❌ Electron 安装失败，请检查网络连接"
        read -p "按回车键退出..."
        exit 1
    fi
fi

# 启动应用（使用npx确保使用本地安装的electron）
echo "✨ 启动桌面应用..."
echo "💡 提示：如果应用没有打开，请查看终端中的错误信息"
echo ""

# 确保使用生产模式
export NODE_ENV=production

# 使用npx运行electron，并保持终端窗口打开
npx electron . || {
    echo ""
    echo "❌ 启动失败！"
    echo "💡 请尝试在终端中运行以下命令："
    echo "   cd \"$SCRIPT_DIR\""
    echo "   npm run build"
    echo "   npx electron ."
    echo ""
    read -p "按回车键退出..."
    exit 1
}
