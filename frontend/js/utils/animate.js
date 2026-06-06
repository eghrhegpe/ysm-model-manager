// ===== 数字跳动动画 =====
// 用法: animateNumber(el, targetValue, duration)

export function animateNumber(el, to, duration = 300) {
  if (!el) return;
  const from = parseInt(el.textContent.replace(/[^0-9-]/g, ""), 10) || 0;
  if (from === to) return;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    // easeOutBack: 先微超再回弹
    const ease =
      t < 1
        ? 1 + 1.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
        : 1;
    el.textContent = el.textContent.replace(
      /[0-9]+/,
      Math.round(from + (to - from) * ease),
    );
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
