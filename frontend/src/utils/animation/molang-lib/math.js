// Author: JannisX11, License: MIT
const radify = n => (((n + 180) % 360) +180) % 360;

export default {
	clamp(number, min, max) {
		if (number > max) number = max;
		if (number < min || isNaN(number)) number = min;
		return number;
	},
	random(a, b) {
		return a + Math.random() * (b-a)
	},
	randomInt(a, b) {
		a = Math.ceil(a);
		b = Math.floor(b);
		return a + Math.floor(Math.random() * (b - a + 1));
	},
	dieRoll(num, low, high) {
		// 安全预算：clamp 到 1e4 防 WebView2 主线程挂起（手滑 math.die_roll(1e6, 0, 1) 直接卡死）
		num = this.clamp(num, 0, 1e4);
		let sum = 0;
		for (var i = 0; i < num; i++) {
			sum += this.random(low, high);
		}
		return sum;
	},
	dieRollInt(num, low, high) {
		// 安全预算：同上
		num = this.clamp(num, 0, 1e4);
		let sum = 0;
		for (var i = 0; i < num; i++) {
			sum += this.randomInt(low, high);
		}
		return sum;
	},
	lerp(start, end, lerp) {
		return start + (end - start) * lerp;
	},
	inverseLerp(start, end, value) {
		return (value-start) / (end-start)
	},
	lerpRotate(start, end, lerp) {
		let a = radify(start)
		let b = radify(end)

		if (a > b) [a, b] = [b, a];
		var diff = b-a;
		if (diff > 180) {
			return radify(b + lerp * (360-diff));
		} else {
			return a + lerp * diff;
		}
	},
	minAngle(value) {
		let floor = Math.max(4, 4 + Math.round(value/-360)) * 2 + 1;
		return ((value + 180*floor) % 360) - 180;
	},
	inRange(value, min, max) {
		return (value <= max && value >= min) ? 1 : 0;
	},
	all(value, ...to_compare) {
		return (to_compare.findIndex(c => c !== value) === -1) ? 1 : 0;
	},
	any(value, ...to_compare) {
		return to_compare.findIndex(c => c == value) >= 0 ? 1 : 0;
	},
	approxEq(value, ...to_compare) {
		return (to_compare.findIndex(c => Math.abs(value - c) > 0.0000001) === -1) ? 1 : 0;
	},
}
