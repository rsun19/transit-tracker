'use client';

import Box from '@mui/material/Box';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { Alert } from '@/lib/api-client';
import { AlertBanner } from './AlertBanner';

interface ServiceAlertsProps {
  alerts: Alert[];
}

/**
 * Shows urgent alerts (disruptions, delays, detours, anything SEVERE) in full,
 * and folds the rest (elevators, parking, general notices) into a collapsed
 * accordion. `urgent` comes from the alerts API; an alert without it (older
 * API) is shown in full so nothing important is hidden.
 */
export function ServiceAlerts({ alerts }: ServiceAlertsProps) {
  if (alerts.length === 0) return null;

  const urgent = alerts.filter((a) => a.urgent !== false);
  const other = alerts.filter((a) => a.urgent === false);

  return (
    <Box sx={{ mb: 2 }}>
      {urgent.map((alert) => (
        <AlertBanner
          key={alert.alertId}
          severity={alert.severityLevel === 'SEVERE' ? 'error' : 'warning'}
          title={alert.headerText}
          message={alert.descriptionText}
        />
      ))}
      {other.length > 0 && (
        <Accordion disableGutters variant="outlined" sx={{ mb: 2 }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="other-notices-content"
            id="other-notices-header"
          >
            <Typography variant="body2">
              Other notices ({other.length}): elevators, facilities and general info
            </Typography>
          </AccordionSummary>
          <AccordionDetails id="other-notices-content">
            {other.map((alert) => (
              <AlertBanner
                key={alert.alertId}
                severity="info"
                title={alert.headerText}
                message={alert.descriptionText}
              />
            ))}
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
