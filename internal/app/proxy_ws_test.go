package app

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// TestIsBlockedIP_CGNAT CGNAT 共享地址段 100.64.0.0/10 必须整段拦截，
// 且段外相邻地址不误伤（原 80 行前缀黑名单的收敛回归锚点）。
func TestIsBlockedIP_CGNAT(t *testing.T) {
	tests := []struct {
		host    string
		blocked bool
	}{
		{"100.64.0.1", true},
		{"100.100.100.100", true}, // Tailscale 常见 IP
		{"100.127.255.254", true},
		{"100.63.255.255", false}, // 段前界
		{"100.128.0.1", false},    // 段后界
	}
	for _, tt := range tests {
		if got := isBlockedIP(tt.host); got != tt.blocked {
			t.Errorf("isBlockedIP(%q) = %v, want %v", tt.host, got, tt.blocked)
		}
	}
}

// TestProxyWebSocketBidirectional 验证 WS 代理双向拷贝：
// 客户端→上游（请求体穿透）与 上游→客户端（回包穿透）都必须送达，
// 且任一方向结束后代理关闭两侧连接、两个拷贝 goroutine 均退出
// （原实现 <-done 只等一个方向，另一 goroutine 靠 defer 间接退出）。
func TestProxyWebSocketBidirectional(t *testing.T) {
	// 假上游 WS 服务：握手回 101，之后回显收到的字节
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	go func() {
		for {
			conn, err := upstream.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 4096)
				// 读握手请求（读满一次足够，测试报文小于缓冲）
				if _, err := c.Read(buf); err != nil {
					return
				}
				resp := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
				if _, err := c.Write([]byte(resp)); err != nil {
					return
				}
				for {
					n, err := c.Read(buf)
					if err != nil {
						return
					}
					if _, err := c.Write(buf[:n]); err != nil {
						return
					}
				}
			}(conn)
		}
	}()

	// ssrfGuardDial 拦截回环地址——测试通过注入 dial 钩子直连假上游
	origDial := getSSRFDial()
	setSSRFDial(func(ctx context.Context, network, addr string) (net.Conn, error) {
		return net.Dial(network, upstream.Addr().String())
	})
	defer setSSRFDial(origDial)

	handlerErr := make(chan error, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target, _ := url.Parse("ws://upstream.test/ws")
		handlerErr <- proxyWebSocket(context.Background(), target, w, r)
	}))
	defer ts.Close()

	clientConn, err := net.Dial("tcp", strings.TrimPrefix(ts.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer clientConn.Close()
	clientConn.SetDeadline(time.Now().Add(5 * time.Second))

	// 发起升级握手
	req := "GET /ws HTTP/1.1\r\nHost: proxy\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
	if _, err := clientConn.Write([]byte(req)); err != nil {
		t.Fatal(err)
	}

	// 读响应头（直到空行）
	header := make([]byte, 0, 4096)
	one := make([]byte, 1)
	for !strings.Contains(string(header), "\r\n\r\n") {
		n, err := clientConn.Read(one)
		if err != nil {
			t.Fatalf("读握手响应头失败: %v", err)
		}
		if n > 0 {
			header = append(header, one[0])
		}
	}
	if !strings.Contains(string(header), "101") {
		t.Fatalf("期望 101 响应, got %q", string(header))
	}

	// 上行：客户端 → 上游（经代理转发，上游回显）
	if _, err := clientConn.Write([]byte("hello-ws")); err != nil {
		t.Fatal(err)
	}
	echo := make([]byte, len("hello-ws"))
	if _, err := io.ReadFull(clientConn, echo); err != nil {
		t.Fatalf("读回显失败（上行/下行任一方向未穿透）: %v", err)
	}
	if string(echo) != "hello-ws" {
		t.Fatalf("回显内容不符: %q", string(echo))
	}

	// 下行收尾：客户端断开 → 代理两个方向都应结束（goroutine 泄漏即挂测试 deadline）
	if err := clientConn.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-handlerErr:
		if err != nil {
			t.Fatalf("proxyWebSocket 返回错误: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("proxyWebSocket 未在双向结束后返回（存在方向未等待/连接未关闭）")
	}
}
