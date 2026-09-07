// ===== ssrfDial 包级变量无并发保护回归测试 =====
// 问题：var ssrfDial = ssrfGuardDial 是包级可写变量，测试替换时无 mutex
// 修复：改为 atomic.Value 保护
package app

import (
	"context"
	"net"
	"sync"
	"testing"
)

// TestSSRFDial_ConcurrentAccess 验证：并发读写 ssrfDial 不 data race。
func TestSSRFDial_ConcurrentAccess(t *testing.T) {
	orig := getSSRFDial()
	defer setSSRFDial(orig)

	dialFn := func(ctx context.Context, network, addr string) (net.Conn, error) {
		return nil, net.ErrClosed
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			setSSRFDial(dialFn)
		}()
		go func() {
			defer wg.Done()
			fn := getSSRFDial()
			_ = fn
		}()
	}
	wg.Wait()
}
