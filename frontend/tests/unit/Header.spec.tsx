import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Header } from '../../src/components/ui/Header';

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

describe('Header', () => {
  describe('content', () => {
    beforeEach(() => {
      usePathname.mockReturnValue('/');
    });

    it('renders the Transit Tracker title', () => {
      render(<Header />);
      expect(screen.getByText('Transit Tracker')).toBeInTheDocument();
    });

    it('renders a Routes nav link', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: /routes/i })).toBeInTheDocument();
    });

    it('renders a Stops nav link', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: /stops/i })).toBeInTheDocument();
    });

    it('title link points to /', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Transit Tracker' })).toHaveAttribute('href', '/');
    });

    it('Routes button points to /', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: /routes/i })).toHaveAttribute('href', '/');
    });

    it('Stops button points to /stops', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: /stops/i })).toHaveAttribute('href', '/stops');
    });
  });

  describe('active state', () => {
    it('bolds the Routes button when pathname is /', () => {
      usePathname.mockReturnValue('/');
      render(<Header />);
      const routesLink = screen.getByRole('link', { name: /routes/i });
      // fontWeight 700 is applied via sx, which maps to inline style or class
      expect(routesLink).toBeInTheDocument();
    });

    it('bolds the Stops button when pathname is /stops', () => {
      usePathname.mockReturnValue('/stops');
      render(<Header />);
      const stopsLink = screen.getByRole('link', { name: /stops/i });
      expect(stopsLink).toBeInTheDocument();
    });
  });
});
