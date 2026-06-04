# safe-edit-service.py
# 放在项目根目录
# 运行: python safe-edit-service.py
import http.server
import socketserver
import os
import shutil
import urllib.parse
import subprocess
import json

PORT = 8765
BASE_DIR = os.getcwd()  # 项目根目录

class BackupHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/backup'):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)

            file_rel_path = params.get('file', [None])[0]

            if not file_rel_path:
                self.send_error(400, "Missing 'file' parameter")
                return

            # 安全校验：防止路径穿越攻击
            abs_path = os.path.abspath(os.path.join(BASE_DIR, file_rel_path))
            if not abs_path.startswith(BASE_DIR):
                self.send_error(403, "Access denied")
                return

            backup_path = abs_path + ".bak"

            try:
                if os.path.exists(abs_path):
                    shutil.copy2(abs_path, backup_path)
                    print(f"[OK] Backed up {abs_path} to {backup_path}")
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"Backup Successful")
                else:
                    self.send_error(404, "File not found")
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404, "Not Found")

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), BackupHandler) as httpd:
        print(f"Safe Edit Service running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()

class BuildHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/build':
            try:
                # 运行构建命令，只捕获 stderr 和 stdout
                # 使用 powershell 确保兼容 Windows
                result = subprocess.run(
                    ['powershell', '-Command', 'npx vite build 2>&1'],
                    capture_output=True,
                    text=True,
                    cwd=BASE_DIR,
                    timeout=120  # 防止卡死
                )

                output = result.stdout + result.stderr

                # 智能提取错误（只取最后 50 行，省 Token）
                lines = output.strip().split('\n')
                errors = [l for l in lines if 'error' in l.lower() or 'failed' in l.lower()]

                response_data = {
                    "success": result.returncode == 0,
                    "returncode": result.returncode,
                    "errors": errors[-10:],  # 只返回最后 10 个错误
                    "full_log_tail": lines[-20:]  # 最后 20 行上下文
                }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response_data).encode())

            except subprocess.TimeoutExpired:
                self.send_response(408)
                self.end_headers()
                self.wfile.write(b'Build Timeout')
        else:
            self.send_error(404)

# 修改启动部分，支持多端口或多 Handler（简化版：用同一个端口，区分 Path）
# 注意：SimpleHTTPRequestHandler 不支持多 Handler 直接共存，我们用一个 Handler 判断路径

class UnifiedHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/backup'):
            # 原来的备份逻辑
            # ... (把原来 BackupHandler 的 do_GET 代码搬到这里)
            pass
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/build':
            # 新增的构建逻辑
            try:
                result = subprocess.run(
                    ['powershell', '-Command', 'npx vite build 2>&1'],
                    capture_output=True,
                    text=True,
                    cwd=BASE_DIR
                )
                errors = [l for l in result.stdout.split('\n') if 'error' in l.lower()][-10:]
                resp = {"ok": result.returncode == 0, "errors": errors}
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(resp).encode())
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404)

# 最后一行改为：
if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), UnifiedHandler) as httpd:
        print(f"Service running at http://localhost:{PORT}")
        httpd.serve_forever()
