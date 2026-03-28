import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#DA291C', // MBTA red
    },
    secondary: {
      main: '#003DA5', // Transit blue
    },
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  spacing: 8,
});
