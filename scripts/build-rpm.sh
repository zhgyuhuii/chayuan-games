#!/usr/bin/env bash
# 察元AI游戏 CentOS/RHEL 系 RPM 打包（绕开 fpm——2015 年的 fpm 1.9.3 与
# rpmbuild 6.x 的 BUILDROOT 新布局不兼容，直接手写 spec 调 rpmbuild）。
# 前置：electron-builder --linux 先产出 release/linux-unpacked 与
#       release/linux-arm64-unpacked；brew install rpm（rpmbuild）。
# 产物：release/chayuan-game-0.1.0-1.{x86_64,aarch64}.rpm
# 兼容性：payload 强制 xz（w2.xzdio），CentOS 7+（rpm 4.11+）均可安装。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
APP_DIR="/opt/察元AI游戏"
ICON_SRC="$ROOT/build/icon.png"

for arch in x86_64 aarch64; do
  if [ "$arch" = "x86_64" ]; then
    src="$ROOT/release/linux-unpacked"
  else
    src="$ROOT/release/linux-arm64-unpacked"
  fi
  [ -d "$src" ] || { echo "缺少 $src —— 先跑 electron-builder --linux"; exit 1; }
  top="/tmp/rpm-top-$arch"
  rm -rf "$top"
  mkdir -p "$top/BUILD" "$top/RPMS" "$top/SPECS" "$top/SOURCES"

  spec="$top/SPECS/chayuan-game.spec"
  cat > "$spec" <<SPEC
%define _topdir $top
%define _tmppath /tmp
%define _binary_payload w2.xzdio
%global debug_package %{nil}
%global __os_install_post %{nil}
%define __brp_mangle_shebangs %{nil}

Name:           chayuan-game
Version:        $VERSION
Release:        1%{?dist}
Summary:        察元竞技场 —— LLM 棋牌竞技场（Chayuan Arena: Chess & Card Arena for LLMs）
License:        MIT
URL:            https://github.com/zhgyuhuii/chayuan-games
BuildArch:      $arch
AutoReqProv:    no
Requires:       gtk3, nss, libnotify, libXScrnSaver, libXtst, libX11, at-spi2-core, libuuid, xdg-utils

%description
察元竞技场（Chayuan Arena）：大模型棋牌竞技场——11 款玩法 × 85 家厂商 ×
TrueSkill 天梯 × 思维链可视化 × 本地优先。出品：北京智灵鸟科技中心。

%install
mkdir -p "%{buildroot}$APP_DIR"
cp -R "$src/" "%{buildroot}$APP_DIR/"
mkdir -p "%{buildroot}/usr/share/applications" "%{buildroot}/usr/share/icons/hicolor/1024x1024/apps"
cat > "%{buildroot}/usr/share/applications/chayuan-game.desktop" <<DESKTOP
[Desktop Entry]
Name=察元AI游戏
Comment=Chayuan Arena — LLM Chess & Card Arena
Exec=$APP_DIR/chayuan-game %U
Terminal=false
Type=Application
Icon=chayuan-game
Categories=Game;
StartupNotify=true
DESKTOP
cp "$ICON_SRC" "%{buildroot}/usr/share/icons/hicolor/1024x1024/apps/chayuan-game.png"

%post
if [ -e "$APP_DIR/chrome-sandbox" ]; then chmod 4755 "$APP_DIR/chrome-sandbox" || true; fi
if [ -e "$APP_DIR/chrome_crashpad_handler" ]; then chmod 4755 "$APP_DIR/chrome_crashpad_handler" || true; fi
update-desktop-database >/dev/null 2>&1 || true

%files
"$APP_DIR"
/usr/share/applications/chayuan-game.desktop
/usr/share/icons/hicolor/1024x1024/apps/chayuan-game.png

%changelog
* $(date "+%a %b %d %Y") Chayuan <cmdbird@163.com> - $VERSION-1
- 察元竞技场 $VERSION 首个 RPM 发布（CentOS/RHEL/Fedora 系）
SPEC

  rpmbuild -bb --define "_topdir $top" --define "_tmppath /tmp" "$spec"
  find "$top/RPMS" -name "*.rpm" -exec cp {} "$ROOT/release/" \;
done

ls -lh "$ROOT/release/"*.rpm
