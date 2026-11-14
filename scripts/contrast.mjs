const pairs = [
  ['text on surface', '#fdfdfd', '#111111', 4.5],
  ['muted text on surface', '#a7a7a7', '#111111', 4.5],
  ['faint text on page', '#858585', '#050505', 4.5],
  ['faint text on surface', '#858585', '#111111', 4.5],
  ['text on accent button', '#02121f', '#0091fd', 4.5],
  ['accent on page', '#0091fd', '#050505', 4.5],
  ['sky on surface', '#83dcff', '#111111', 4.5],
  ['sky on token chip', '#83dcff', '#07314f', 4.5],
  ['verified on surface', '#4cd6a0', '#111111', 4.5],
  ['caution on surface', '#f5b84a', '#111111', 4.5],
  ['blocked on surface', '#ff6b5e', '#111111', 4.5],
];

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

let failed = false;
for (const [name, foreground, background, minimum] of pairs) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  const ratio = (light + 0.05) / (dark + 0.05);
  const passed = ratio >= minimum;
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}: ${ratio.toFixed(2)}:1\n`);
  failed ||= !passed;
}

process.exitCode = failed ? 1 : 0;
