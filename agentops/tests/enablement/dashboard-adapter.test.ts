import { describe, it, expect } from 'vitest';
import { getDashboardPanels, getDashboardHeader } from '../../src/enablement/dashboard-adapter';
import { generateConfigForLevel, ALL_SKILLS } from '../../src/enablement/engine';

// ---------------------------------------------------------------------------
// getDashboardPanels
// ---------------------------------------------------------------------------

describe('getDashboardPanels', () => {
  it('returns a panel for every skill', () => {
    const panels = getDashboardPanels(generateConfigForLevel(1));
    expect(panels).toHaveLength(ALL_SKILLS.length);
  });

  it('level 1: save_points enabled, rest have upgrade messages', () => {
    const panels = getDashboardPanels(generateConfigForLevel(1));

    const sp = panels.find((p) => p.skill === 'save_points')!;
    expect(sp.enabled).toBe(true);
    expect(sp.mode).toBe('full');
    expect(sp.upgradeMessage).toBeUndefined();

    const ch = panels.find((p) => p.skill === 'context_health')!;
    expect(ch.enabled).toBe(false);
    expect(ch.mode).toBe('off');
    expect(ch.upgradeMessage).toBe('Enable Level 2 to unlock');
  });

  it('level 5: all panels enabled, no upgrade messages', () => {
    const panels = getDashboardPanels(generateConfigForLevel(5));
    for (const panel of panels) {
      expect(panel.enabled).toBe(true);
      expect(panel.mode).toBe('full');
      expect(panel.upgradeMessage).toBeUndefined();
    }
  });

  it('upgrade messages reference correct levels', () => {
    const panels = getDashboardPanels(generateConfigForLevel(1));

    const expected: Record<string, string> = {
      context_health: 'Enable Level 2 to unlock',
      standing_orders: 'Enable Level 3 to unlock',
      small_bets: 'Enable Level 4 to unlock',
      proactive_safety: 'Enable Level 5 to unlock',
    };

    for (const [skill, msg] of Object.entries(expected)) {
      const panel = panels.find((p) => p.skill === skill)!;
      expect(panel.upgradeMessage).toBe(msg);
    }
  });

  it('panels have human-readable titles', () => {
    const panels = getDashboardPanels(generateConfigForLevel(3));
    const titles = panels.map((p) => p.title);
    expect(titles).toContain('Save Points');
    expect(titles).toContain('Context Health');
    expect(titles).toContain('Standing Orders');
    expect(titles).toContain('Small Bets');
    expect(titles).toContain('Proactive Safety');
  });

  it('level 3: standing_orders is basic mode', () => {
    const panels = getDashboardPanels(generateConfigForLevel(3));
    const so = panels.find((p) => p.skill === 'standing_orders')!;
    expect(so.enabled).toBe(true);
    expect(so.mode).toBe('basic');
  });

  it('level 4: standing_orders upgraded to full', () => {
    const panels = getDashboardPanels(generateConfigForLevel(4));
    const so = panels.find((p) => p.skill === 'standing_orders')!;
    expect(so.mode).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// getDashboardHeader
// ---------------------------------------------------------------------------

describe('getDashboardHeader', () => {
  it('level 1: correct header', () => {
    const header = getDashboardHeader(generateConfigForLevel(1));
    expect(header.level).toBe(1);
    expect(header.name).toBe('Safe Ground');
    expect(header.activeCount).toBe(1);
    expect(header.totalCount).toBe(5);
  });

  it('level 3: three active', () => {
    const header = getDashboardHeader(generateConfigForLevel(3));
    expect(header.level).toBe(3);
    expect(header.name).toBe('House Rules');
    expect(header.activeCount).toBe(3);
  });

  it('level 5: all active', () => {
    const header = getDashboardHeader(generateConfigForLevel(5));
    expect(header.level).toBe(5);
    expect(header.name).toBe('Full Guard');
    expect(header.activeCount).toBe(5);
    expect(header.totalCount).toBe(5);
  });

  it('totalCount is always 5', () => {
    for (let i = 1; i <= 5; i++) {
      expect(getDashboardHeader(generateConfigForLevel(i)).totalCount).toBe(5);
    }
  });

  it('activeCount increases with each level', () => {
    let prev = 0;
    for (let i = 1; i <= 5; i++) {
      const count = getDashboardHeader(generateConfigForLevel(i)).activeCount;
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
  });
});
