// ===== 里程表滚动进位动画 =====
// 数字像老式汽车里程表：个位先转→十位→百位
// 用法: animateNumber(el, targetValue, duration)

export function animateNumber(el, to, duration = 700) {
  if (!el) return;
  const match = el.textContent.match(/([0-9]+)/);
  if (!match) return;
  const from = parseInt(match[1], 10);
  if (from === to) return;

  const numStr = String(to);
  const fromStr = String(from).padStart(numStr.length, "0");
  const len = numStr.length;

  // 从右到左逐位进位：个位先转→十位→百位
  // 例: from=0, to=141 → [1, 41, 141]（个位→十位→百位）
  const frames = [];
  for (let p = len - 1; p >= 0; p--) {
    // 第 p 位取目标值，右边取目标，左边保留旧值
    let val = "";
    for (let i = 0; i < len; i++) {
      if (i < p)
        val += fromStr[i]; // 左边保留旧值
      else if (i === p)
        val += numStr[i]; // 当前位取目标
      else val += numStr[i]; // 右边取目标
    }
    frames.push(parseInt(val, 10));
  }
  // 去重 + 去头（去掉与 from 相同的）
  const unique = frames.filter((v, i) => v !== (i > 0 ? frames[i - 1] : from));

  // 帧数量不足时直接跳转，防止卡顿
  if (unique.length <= 1) {
    el.textContent = el.textContent.replace(/[0-9]+/, String(to));
    return;
  }
  // 逐帧播放（从右到左逐位进位）
  const stepDuration = duration / unique.length;
  let idx = 0;
  const play = () => {
    el.textContent = el.textContent.replace(/[0-9]+/, String(unique[idx]));
    idx++;
    if (idx < unique.length) {
      setTimeout(play, stepDuration);
    }
  };
  play();
}
