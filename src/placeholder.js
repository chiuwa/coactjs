export function createPlaceholderSvg(seed) {
  const palettes = [
    ['#ead5dc', '#b95b73', '#d8c7a4', '#fffdfd'],
    ['#e7ddd5', '#a66f7b', '#c7d1c4', '#fffdfd'],
    ['#ded5dc', '#b98577', '#e7cbbb', '#fffdfd'],
    ['#dce4d7', '#9d7c86', '#dfc7ad', '#fffdfd']
  ];
  const palette = palettes[seed % palettes.length];
  let value = seed || 1;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const circleX = 170 + random() * 450;
  const circleY = 80 + random() * 230;
  const circleR = 85 + random() * 105;
  const rectX = 80 + random() * 350;
  const rectY = 100 + random() * 170;
  const rotation = -20 + random() * 40;
  const waveY = 330 + random() * 70;
  const dotX = 590 + random() * 120;
  const dotY = 90 + random() * 260;
  return `<svg viewBox="0 0 800 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="800" height="520" fill="${palette[0]}"/>
      <circle cx="${circleX.toFixed(1)}" cy="${circleY.toFixed(1)}" r="${circleR.toFixed(1)}" fill="${palette[1]}" opacity=".92"/>
      <rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="230" height="300" rx="115" fill="${palette[2]}" opacity=".86" transform="rotate(${rotation.toFixed(1)} ${rectX + 115} ${rectY + 150})"/>
      <path d="M-40 ${waveY.toFixed(1)} C130 245 260 470 430 345 S680 235 850 330 L850 560 L-40 560Z" fill="${palette[1]}" opacity=".64"/>
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="34" fill="${palette[3]}" opacity=".9"/>
      <path d="M92 86H290M92 101H240" stroke="#2b262c" stroke-opacity=".2" stroke-width="4" stroke-linecap="round"/>
      <circle cx="682" cy="420" r="8" fill="#2b262c" opacity=".22"/>
    </svg>`;
}
