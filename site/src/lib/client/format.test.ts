import { describe, it, expect } from 'vitest';
import {
  formatScore,
  formatCost,
  formatDuration,
  formatTokens,
  formatRelativeTime,
  formatTaskRatio,
} from './format';

describe('format', () => {
  describe('formatScore', () => {
    it('formats a 0-1 score as 2-decimal', () => {
      expect(formatScore(0.84)).toBe('0.84');
      expect(formatScore(1)).toBe('1.00');
      expect(formatScore(0)).toBe('0.00');
    });
  });

  describe('formatCost', () => {
    it('formats USD with $ prefix', () => {
      expect(formatCost(0.12)).toBe('$0.12');
      expect(formatCost(0.001)).toBe('$0.001');
      expect(formatCost(1.23456)).toBe('$1.23');
    });
    it('shows < $0.001 for tiny values', () => {
      expect(formatCost(0.0001)).toBe('<$0.001');
    });
    it('locks the strict-less-than boundary at 0.001', () => {
      expect(formatCost(0.0009)).toBe('<$0.001');
      expect(formatCost(0.001)).toBe('$0.001');
      expect(formatCost(0.0011)).toBe('$0.001');
    });
  });

  describe('formatDuration', () => {
    it('milliseconds < 1000', () => {
      expect(formatDuration(500)).toBe('500ms');
    });
    it('seconds < 60', () => {
      expect(formatDuration(2400)).toBe('2.4s');
      expect(formatDuration(12400)).toBe('12.4s');
    });
    it('minutes', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });
    it('hours', () => {
      expect(formatDuration(3725000)).toBe('1h 2m');
    });
  });

  describe('formatTokens', () => {
    it('plain integer < 1000', () => {
      expect(formatTokens(480)).toBe('480');
    });
    it('thousands with k', () => {
      expect(formatTokens(2400)).toBe('2.4k');
      expect(formatTokens(12000)).toBe('12k');
    });
    it('millions with M', () => {
      expect(formatTokens(1_500_000)).toBe('1.5M');
    });
  });

  describe('formatRelativeTime', () => {
    it('seconds', () => {
      const now = new Date('2026-04-27T12:00:00Z');
      const ts = '2026-04-27T11:59:30Z';
      expect(formatRelativeTime(ts, now)).toBe('30s ago');
    });
    it('minutes', () => {
      const now = new Date('2026-04-27T12:00:00Z');
      const ts = '2026-04-27T11:55:00Z';
      expect(formatRelativeTime(ts, now)).toBe('5m ago');
    });
    it('hours', () => {
      const now = new Date('2026-04-27T12:00:00Z');
      const ts = '2026-04-27T08:00:00Z';
      expect(formatRelativeTime(ts, now)).toBe('4h ago');
    });
    it('days', () => {
      const now = new Date('2026-04-27T12:00:00Z');
      const ts = '2026-04-25T12:00:00Z';
      expect(formatRelativeTime(ts, now)).toBe('2d ago');
    });
  });

  describe('formatTaskRatio', () => {
    it('formats N/M', () => {
      expect(formatTaskRatio(24, 24)).toBe('24/24');
      expect(formatTaskRatio(0, 24)).toBe('0/24');
    });
  });
});
