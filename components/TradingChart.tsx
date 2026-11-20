"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/market";

interface TradingChartProps {
  candles: Candle[];
  entry?: number;
  takeProfit?: number;
  stopLoss?: number;
  theme: string;
}

export default function TradingChart({ candles, entry, takeProfit, stopLoss, theme }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const styles = getComputedStyle(document.querySelector(".app-shell") ?? document.documentElement);
    const accent = styles.getPropertyValue("--lime").trim() || "#b1f26a";
    const background = styles.getPropertyValue("--panel").trim() || "#101310";
    const border = styles.getPropertyValue("--border").trim() || "#1d221e";
    const muted = styles.getPropertyValue("--muted").trim() || "#89918b";
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: background }, textColor: muted, fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#5c695f", labelBackgroundColor: "#303a32" }, horzLine: { color: "#5c695f", labelBackgroundColor: "#303a32" } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: accent,
      downColor: "#fa7268",
      borderUpColor: accent,
      borderDownColor: "#fa7268",
      wickUpColor: accent,
      wickDownColor: "#fa7268",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !candles.length) return;
    series.setData(candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));
    series.priceScale().applyOptions({ autoScale: true });
    for (const priceLine of series.priceLines()) series.removePriceLine(priceLine);
    if (entry) series.createPriceLine({ price: entry, color: "#d9deda", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ENTRY" });
    const accent = getComputedStyle(document.querySelector(".app-shell") ?? document.documentElement).getPropertyValue("--lime").trim() || "#b1f26a";
    if (takeProfit) series.createPriceLine({ price: takeProfit, color: accent, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TAKE PROFIT" });
    if (stopLoss) series.createPriceLine({ price: stopLoss, color: "#fa7268", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "STOP LOSS" });
    chart.timeScale().fitContent();
  }, [candles, entry, takeProfit, stopLoss, theme]);

  return <div ref={containerRef} className="chart-canvas" aria-label="Interactive market candlestick chart" />;
}
