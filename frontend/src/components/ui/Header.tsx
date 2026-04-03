'use client';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header() {
  const pathname = usePathname();

  return (
    <AppBar position="static" sx={{ bgcolor: '#2b2b2b' }}>
      <Toolbar>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{ fontWeight: 700, color: 'inherit', textDecoration: 'none', flexGrow: 1 }}
        >
          Transit Tracker
        </Typography>
        <Button
          component={Link}
          href="/"
          color="inherit"
          sx={{ fontWeight: pathname === '/' ? 700 : 400 }}
        >
          Routes
        </Button>
        <Button
          component={Link}
          href="/stops"
          color="inherit"
          sx={{ fontWeight: pathname === '/stops' ? 700 : 400 }}
        >
          Stops
        </Button>
      </Toolbar>
    </AppBar>
  );
}
