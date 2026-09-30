import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';

describe('ConnectionBanner', () => {
  it('tells the player the link is down without clearing the board', () => {
    render(<ConnectionBanner link="reconnecting" />);
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);
    expect(screen.getByRole('status').textContent).toMatch(/stays on screen/);
  });

  it('stays quiet while the link is live', () => {
    const { container } = render(<ConnectionBanner link="live" />);
    expect(container).toBeEmptyDOMElement();
  });
});
