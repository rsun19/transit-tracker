import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Header } from '../../src/components/ui/Header';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('next/link', () =>
  React.forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(
    function MockLink({ href, children }, ref) {
      return (
        <a href={href} ref={ref}>
          {children}
        </a>
      );
    },
  ),
);

const { usePathname } = jest.requireMock('next/navigation') as { usePathname: jest.Mock };

describe('Header accessibility', () => {
  it('has no axe violations on the routes page', async () => {
    usePathname.mockReturnValue('/');
    const { container } = render(<Header />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on the stops page', async () => {
    usePathname.mockReturnValue('/stops');
    const { container } = render(<Header />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
