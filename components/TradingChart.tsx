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
}

export default function TradingChart({ candles, entry, takeProfit, stopLoss }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#101310" }, textColor: "#89918b", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "#1d221e" }, horzLines: { color: "#1d221e" } },
      rightPriceScale: { borderColor: "#292f2a" },
      timeScale: { borderColor: "#292f2a", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#5c695f", labelBackgroundColor: "#303a32" }, horzLine: { color: "#5c695f", labelBackgroundColor: "#303a32" } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#b1f26a",
      downColor: "#fa7268",
      borderUpColor: "#b1f26a",
      borderDownColor: "#fa7268",
      wickUpColor: "#b1f26a",
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
  }, []);

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
    if (takeProfit) series.createPriceLine({ price: takeProfit, color: "#b1f26a", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TAKE PROFIT" });
    if (stopLoss) series.createPriceLine({ price: stopLoss, color: "#fa7268", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "STOP LOSS" });
    chart.timeScale().fitContent();
  }, [candles, entry, takeProfit, stopLoss]);

  return <div ref={containerRef} className="chart-canvas" aria-label="Interactive market candlestick chart" />;
}
