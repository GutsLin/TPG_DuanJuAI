#!/usr/bin/env bash
# =============================================================
# 调皮狗AI短剧平台 · 云端一键部署脚本
#
# 用法:
#   bash scripts/deploy.sh              部署当前代码到云服务器(构建+重启+验证)
#   bash scripts/deploy.sh --dry-run    只打包+传输+同步代码,不构建不重启
#   bash scripts/deploy.sh --with-infra 同时覆盖服务器上的 Dockerfile / docker-compose.yml(慎用)
#   bash scripts/deploy.sh -y           跳过所有确认
#
# 首次运行会交互式生成 scripts/deploy.config.local.sh(已 gitignore,权限 600)
# 服务器端每次部署前自动备份代码到 ~/deploy-backups(保留最近 5 份)
# 手动回滚:在服务器上 tar -xzf ~/deploy-backups/code-<时间戳>.tar.gz -C ~/ 后重新 bash deploy.sh
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/deploy.config.local.sh"

DRY_RUN=0; WITH_INFRA=0; ASSUME_YES=0
for arg in "$@"; do case "$arg" in
  --dry-run)    DRY_RUN=1 ;;
  --with-infra) WITH_INFRA=1 ;;
  -y|--yes)     ASSUME_YES=1 ;;
  -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
  *) echo "未知参数: $arg(用 -h 看用法)"; exit 1 ;;
esac; done

log()  { echo -e "\033[36m[deploy]\033[0m $*"; }
warn() { echo -e "\033[33m[deploy]\033[0m $*"; }
die()  { echo -e "\033[31m[deploy]\033[0m $*" >&2; exit 1; }

# ---------- 首次运行:生成本地配置 ----------
if [ ! -f "$CONFIG_FILE" ]; then
  log "首次运行,配置部署目标(只写入本地 $CONFIG_FILE,不会进 git)"
  read -rp "  服务器 IP: " _host
  read -rp "  SSH 用户名 [ubuntu]: " _user; _user=${_user:-ubuntu}
  read -rsp "  SSH 密码: " _pass; echo
  read -rp "  服务器项目目录 [/home/$_user/TPG_DuanJuAI]: " _dir; _dir=${_dir:-/home/$_user/TPG_DuanJuAI}
  umask 077
  cat > "$CONFIG_FILE" <<EOF
DEPLOY_HOST='$_host'
DEPLOY_USER='$_user'
DEPLOY_PASS='$_pass'
DEPLOY_DIR='$_dir'
EOF
  log "配置已保存(权限 600)"
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"
: "${DEPLOY_HOST:?配置缺失}" "${DEPLOY_USER:?配置缺失}" "${DEPLOY_PASS:?配置缺失}" "${DEPLOY_DIR:?配置缺失}"

cd "$ROOT_DIR"
[ -d .git ] || die "请在 git 仓库根目录中使用(scripts/deploy.sh)"

# ---------- 准备免交互 SSH(密码落临时文件,askpass 用 cat 读取,任何特殊字符都安全;退出即删) ----------
TMP_DIR="$(mktemp -d)"
printf '%s' "$DEPLOY_PASS" > "$TMP_DIR/.pass"
chmod 600 "$TMP_DIR/.pass"
printf '#!/usr/bin/env bash\ncat "%s/.pass"\n' "$TMP_DIR" > "$TMP_DIR/askpass.sh"
chmod 700 "$TMP_DIR/askpass.sh"
ASKPASS="$TMP_DIR/askpass.sh"
export SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"

SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SCP=(scp -o StrictHostKeyChecking=accept-new -q)

cleanup() {
  "${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" 'rm -rf ~/.deploy-tmp ~/.deploy-askpass.sh ~/.deploy-update.tar.gz' >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ---------- 1. 本地检查 ----------
COMMIT=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then
  warn "工作区有未提交改动,部署将以当前工作区内容为准"
  if [ "$ASSUME_YES" != 1 ]; then read -rp "  继续? [y/N] " _c; [[ "${_c:-}" =~ ^[yY] ]] || { log "已取消"; exit 1; }; fi
fi
log "提交: $COMMIT   目标: $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR"

# ---------- 2. 打包 ----------
PKG="$TMP_DIR/update.tar.gz"
EXCLUDES=(--exclude=./.git --exclude=./data --exclude=./.smoke-infra --exclude=./dump.rdb
          --exclude='*/node_modules' --exclude='*/.nuxt' --exclude='*/.output'
          --exclude=./backend/.env --exclude=./.env --exclude=./scripts/deploy.config.local.sh)
if [ "$WITH_INFRA" = 0 ]; then
  EXCLUDES+=(--exclude=./Dockerfile --exclude=./docker-compose.yml)
  log "打包中(保留服务器定制的 Dockerfile / docker-compose.yml)..."
else
  warn "打包中(含 Dockerfile / docker-compose.yml,将覆盖服务器定制版!)"
fi
tar -czf "$PKG" "${EXCLUDES[@]}" .
log "包大小: $(du -h "$PKG" | cut -f1)"

# ---------- 3. 传输 + 服务器端备份 + 覆盖代码 ----------
log "上传到服务器..."
"${SCP[@]}" "$PKG" "$DEPLOY_USER@$DEPLOY_HOST:~/.deploy-update.tar.gz"
log "服务器端备份当前代码并同步..."
"${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "DEPLOY_DIR='$DEPLOY_DIR' COMMIT='$COMMIT' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p ~/.deploy-tmp ~/deploy-backups
rm -rf ~/.deploy-tmp/* ~/.deploy-tmp/.[!.]* 2>/dev/null || true
tar -xzf ~/.deploy-update.tar.gz -C ~/.deploy-tmp
BK=~/deploy-backups/code-$(date +%Y%m%d-%H%M%S).tar.gz
tar -czf "$BK" --exclude=data --exclude='*.log' -C "$(dirname "$DEPLOY_DIR")" "$(basename "$DEPLOY_DIR")" 2>/dev/null || true
ls -t ~/deploy-backups/code-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
cp -a ~/.deploy-tmp/. "$DEPLOY_DIR/"
echo "$COMMIT" > "$DEPLOY_DIR/.deployed-commit"
echo "  备份: $BK"
REMOTE
log "代码已同步(备份保留最近 5 份于 ~/deploy-backups)"

if [ "$DRY_RUN" = 1 ]; then
  log "--dry-run:不构建不重启,完成。"
  exit 0
fi

# ---------- 4. 服务器端构建镜像并重启 ----------
log "构建镜像并重启服务(实时输出)..."
"${SCP[@]}" "$ASKPASS" "$DEPLOY_USER@$DEPLOY_HOST:~/.deploy-askpass.sh"
"${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "DEPLOY_DIR='$DEPLOY_DIR' bash -s" <<'REMOTE'
set -euo pipefail
chmod 700 ~/.deploy-askpass.sh
cd "$DEPLOY_DIR"
SUDO_ASKPASS=~/.deploy-askpass.sh sudo -A docker compose up -d --build
echo "--- 容器状态 ---"
SUDO_ASKPASS=~/.deploy-askpass.sh sudo -A docker ps --format "  {{.Names}}  {{.Status}}"
rm -f ~/.deploy-askpass.sh
REMOTE

# ---------- 5. 部署后验证 ----------
log "健康检查(最多等 90 秒)..."
OK=0
for i in $(seq 1 30); do
  sleep 3
  if "${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" 'curl -sf http://127.0.0.1:5679/api/v1/health' >/dev/null 2>&1; then OK=1; break; fi
done
if [ "$OK" = 1 ]; then
  log "✅ 部署成功!服务健康。访问: http://$DEPLOY_HOST:5679"
else
  die "健康检查超时,请登录服务器查看: cd $DEPLOY_DIR && sudo docker compose logs --tail=50 huobao-drama"
fi
