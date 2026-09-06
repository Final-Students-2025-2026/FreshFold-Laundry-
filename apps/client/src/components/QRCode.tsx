/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import QR from 'qrcode';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, radius } from '../theme';

/**
 * A QR code, drawn with `react-native-svg`.
 *
 * `qrcode` is used only as an encoder — its own renderers target canvas and
 * the DOM, neither of which exists here. What comes back from `create` is a
 * bitmap of modules, and this walks it into SVG rects.
 *
 * Runs of adjacent dark modules are merged into a single rect per row. A
 * 25×25 code is 625 potential nodes; merging typically cuts that by three
 * quarters, which matters because every one of them is a real native view.
 */

interface QRCodeProps {
  value: string;
  size?: number;
  /** Quiet zone in modules. The spec asks for 4; 2 is enough on a bright card. */
  quietZone?: number;
  color?: string;
  backgroundColor?: string;
}

export default function QRCode({
  value,
  size = 160,
  quietZone = 2,
  color = colors.textCharcoal,
  backgroundColor = '#FFFFFF',
}: QRCodeProps) {
  const bars = useMemo(() => {
    try {
      const { modules } = QR.create(value, { errorCorrectionLevel: 'M' });
      const count = modules.size;
      const data = modules.data;
      const total = count + quietZone * 2;
      const rows: { x: number; y: number; width: number }[] = [];

      for (let y = 0; y < count; y++) {
        let runStart = -1;

        for (let x = 0; x <= count; x++) {
          const dark = x < count && data[y * count + x] === 1;

          if (dark && runStart < 0) runStart = x;
          else if (!dark && runStart >= 0) {
            rows.push({
              x: runStart + quietZone,
              y: y + quietZone,
              width: x - runStart,
            });
            runStart = -1;
          }
        }
      }

      return { rows, total };
    } catch {
      // An input too long for any QR version, or an encoder failure. The card
      // around this still shows the digits, which is the fallback anyway.
      return null;
    }
  }, [value, quietZone]);

  if (!bars) {
    return (
      <View style={[styles.fallback, { width: size, height: size }]}>
        <Text style={styles.fallbackText}>QR unavailable</Text>
      </View>
    );
  }

  const { rows, total } = bars;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
      <Rect x={0} y={0} width={total} height={total} fill={backgroundColor} />
      {rows.map((run, index) => (
        <Rect
          key={index}
          x={run.x}
          y={run.y}
          width={run.width}
          height={1}
          fill={color}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brandStone,
    backgroundColor: colors.bgLinen,
  },
  fallbackText: { fontSize: 10, color: colors.textMuted },
});
